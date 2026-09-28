import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { openDb } from './db.js';
import { loadConfig, saveConfig, redact } from './config.js';
import { parseCaptureSequence, parseCaptureSource, validateWavPayload } from './audio.js';
import { createAiRuntime } from './ai/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRIGGERS = /competitor|alternative|compare|switch|too expensive|budget|pric(e|ing)|cost|security|complian|soc ?2|hipaa|gdpr|on-?prem|integrat|sla\b/i;
const COMMIT = /\b(i'?ll|i will|we'?ll|we will|let me)\b.{0,40}\b(send|share|email|follow up|get back|schedule|set up|prepare)\b/i;

function safeActionItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      task: String(item.task || '').trim().slice(0, 500),
      assignee: String(item.assignee || 'Unassigned').trim().slice(0, 120)
    }))
    .filter((item) => item.task);
}

export function createServer({ dbPath, configPath }) {
  const db = openDb(dbPath);
  const q = (sql) => db.prepare(sql);
  let cfg = loadConfig(configPath);
  let ai = createAiRuntime(cfg);
  const clients = new Map();

  const emit = (id, event, data) => {
    clients.get(id)?.forEach((res) => {
      try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch {}
    });
  };

  const meetingExists = (id) => Boolean(q('SELECT 1 FROM meetings WHERE id=?').get(id));

  async function fireWhisper(id, text) {
    const terms = [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
      .slice(0, 8)
      .map((word) => '"' + word.replace(/"/g, '') + '"')
      .join(' OR ');
    const hit = terms
      ? q('SELECT rowid AS id, title, content FROM kb WHERE kb MATCH ? ORDER BY rank LIMIT 1').get(terms)
      : null;

    try {
      const tip = await ai.copilot(
        'You are a real-time meeting copilot. Reply with one concise bullet under 25 words. Use only verified context when supplied. Otherwise ask one useful discovery question. No filler or preamble.',
        'Verified context:\n' + (hit ? hit.content.slice(0, 800) : 'none') +
        '\n\nParticipant said: "' + text.slice(0, 2000) + '"'
      );
      if (tip) emit(id, 'whisper', { tip, source: hit?.title || null, sourceId: hit?.id || null, trigger: text });
    } catch (error) {
      emit(id, 'error', { message: 'Whisper unavailable: ' + error.message });
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'renderer')));

  app.get('/api/health', (_, res) => {
    const status = ai.status();
    res.json({ ok: true, aiReady: status.ready, ai: status });
  });

  app.get('/api/settings', (_, res) => res.json(redact(cfg)));

  app.post('/api/settings', (req, res) => {
    cfg = saveConfig(configPath, { ...cfg, ...req.body });
    ai = createAiRuntime(cfg);
    res.json(redact(cfg));
  });

  app.get('/api/meetings', (_, res) => {
    res.json(q(
      'SELECT id, title, started_at, ended_at, summary FROM meetings ORDER BY started_at DESC LIMIT 200'
    ).all());
  });

  app.post('/api/meetings', (req, res) => {
    if (!ai.status().ready) {
      return res.status(503).json({ error: 'No complete AI runtime is configured. Configure local or development AI in Settings.' });
    }
    const id = randomUUID();
    q('INSERT INTO meetings(id, title, started_at) VALUES(?,?,?)').run(
      id,
      String(req.body.title || 'Untitled meeting').trim().slice(0, 200),
      Date.now()
    );
    res.status(201).json({ id });
  });

  app.get('/api/meetings/:id', (req, res) => {
    const meeting = q('SELECT * FROM meetings WHERE id=?').get(req.params.id);
    if (!meeting) return res.sendStatus(404);
    res.json({
      meeting,
      segments: q('SELECT speaker, text, ts FROM segments WHERE meeting_id=? ORDER BY ts').all(req.params.id),
      actions: q('SELECT task, assignee, status FROM actions WHERE meeting_id=? ORDER BY id').all(req.params.id)
    });
  });

  app.delete('/api/meetings/:id', (req, res) => {
    const result = q('DELETE FROM meetings WHERE id=?').run(req.params.id);
    if (!result.changes) return res.sendStatus(404);
    clients.get(req.params.id)?.forEach((client) => {
      try { client.end(); } catch {}
    });
    clients.delete(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/meetings/:id/stream', (req, res) => {
    const { id } = req.params;
    if (!meetingExists(id)) return res.sendStatus(404);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    if (!clients.has(id)) clients.set(id, new Set());
    clients.get(id).add(res);
    res.write('retry: 2000\n\n');
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.get(id)?.delete(res);
      if (!clients.get(id)?.size) clients.delete(id);
    });
  });

  app.post('/api/meetings/:id/chunk', express.raw({ type: 'audio/wav', limit: '12mb' }), async (req, res) => {
    const { id } = req.params;
    if (!meetingExists(id)) return res.sendStatus(404);

    let source;
    let sequence;
    try {
      source = parseCaptureSource(req.query.src);
      sequence = parseCaptureSequence(req.query.seq);
      validateWavPayload(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const speaker = source === 'me' ? 'You' : 'Them';
    const claim = q(
      'INSERT OR IGNORE INTO capture_chunks(meeting_id, speaker, sequence, created_at) VALUES(?,?,?,?)'
    ).run(id, speaker, sequence, Date.now());

    if (!claim.changes) return res.json({ ok: true, deduplicated: true });

    try {
      const text = await ai.transcribe(req.body);
      if (!text || text.length < 2) return res.json({ ok: true, speech: false });

      const segment = {
        speaker,
        text: text.slice(0, 12000),
        ts: Date.now()
      };
      q('INSERT INTO segments(meeting_id, speaker, text, ts) VALUES(?,?,?,?)').run(
        id,
        segment.speaker,
        segment.text,
        segment.ts
      );
      emit(id, 'segment', segment);
      res.json({ ok: true, speech: true });

      if (speaker === 'Them' && TRIGGERS.test(text)) void fireWhisper(id, text);
      if (speaker === 'You' && COMMIT.test(text)) {
        const task = text.slice(0, 500);
        q('INSERT INTO actions(meeting_id, task, assignee) VALUES(?,?,?)').run(id, task, 'You');
        emit(id, 'action', { task, assignee: 'You' });
      }
    } catch (error) {
      emit(id, 'error', { message: 'Transcription failed: ' + error.message });
      res.status(502).json({ error: 'Transcription failed. The meeting remains saved locally.' });
    }
  });

  app.post('/api/meetings/:id/end', async (req, res) => {
    const { id } = req.params;
    const meeting = q('SELECT id, ended_at FROM meetings WHERE id=?').get(id);
    if (!meeting) return res.sendStatus(404);
    if (meeting.ended_at) {
      const existing = q('SELECT summary FROM meetings WHERE id=?').get(id);
      return res.json({ summary: existing?.summary || 'Meeting already ended.', items: [] });
    }

    const segments = q('SELECT speaker, text FROM segments WHERE meeting_id=? ORDER BY ts').all(id);
    let summary = 'No speech was captured.';
    let items = [];
    if (segments.length) {
      try {
        const result = await ai.summarize(segments);
        summary = String(result.summary || summary).trim().slice(0, 4000);
        items = safeActionItems(result.action_items);
      } catch (error) {
        summary = 'Summary unavailable: ' + error.message;
      }
    }

    const insertAction = q('INSERT INTO actions(meeting_id, task, assignee) VALUES(?,?,?)');
    const tx = db.transaction(() => {
      for (const item of items) insertAction.run(id, item.task, item.assignee);
      q('UPDATE meetings SET ended_at=?, summary=? WHERE id=?').run(Date.now(), summary, id);
    });
    tx();
    emit(id, 'meeting-ended', { summary });
    res.json({ summary, items });
  });

  app.get('/api/kb', (_, res) => res.json(
    q('SELECT rowid AS id, title, content FROM kb ORDER BY rowid DESC').all()
  ));

  app.get('/api/kb/search', (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json([]);
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 12).map((word) => '"' + word.replace(/"/g, '') + '"').join(' OR ');
    res.json(q('SELECT rowid AS id, title, content, rank FROM kb WHERE kb MATCH ? ORDER BY rank LIMIT 10').all(terms));
  });

  app.post('/api/kb', (req, res) => {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
    q('INSERT INTO kb(title, content) VALUES(?,?)').run(title.slice(0, 200), content.slice(0, 20000));
    res.status(201).json({ ok: true });
  });

  app.delete('/api/kb/:id', (req, res) => {
    const result = q('DELETE FROM kb WHERE rowid=?').run(req.params.id);
    if (!result.changes) return res.sendStatus(404);
    res.json({ ok: true });
  });

  return {
    app,
    db,
    close() {
      clients.forEach((connections) => connections.forEach((res) => { try { res.end(); } catch {} }));
      clients.clear();
      db.close();
    }
  };
}
