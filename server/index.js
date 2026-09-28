import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { openDb } from './db.js';
import { loadConfig, saveConfig, redact } from './config.js';
import { parseCaptureSequence, parseCaptureSource, validateWavPayload } from './audio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRIGGERS = /competitor|alternative|compare|switch|too expensive|budget|pric(e|ing)|cost|security|complian|soc ?2|hipaa|gdpr|on-?prem|integrat|sla\b/i;
const COMMIT = /\b(i'?ll|i will|we'?ll|we will|let me)\b.{0,40}\b(send|share|email|follow up|get back|schedule|set up|prepare)\b/i;

export function createServer({ dbPath, configPath }) {
  const db = openDb(dbPath);
  const q = (sql) => db.prepare(sql);
  let cfg = loadConfig(configPath);

  async function gemini(parts, json = false) {
    if (!cfg.geminiApiKey) throw new Error('Add a Gemini API key in Settings first.');
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiApiKey },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, ...(json && { responseMimeType: 'application/json' }) }
        })
      }
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Gemini request failed');
    return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  }

  async function copilot(system, user) {
    if (!cfg.nvidiaApiKey) return gemini([{ text: `${system}\n\n${user}` }]);
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.nvidiaApiKey}` },
      body: JSON.stringify({
        model: cfg.nvidiaModel,
        temperature: 0.1,
        max_tokens: 60,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || d.error?.message || 'NVIDIA request failed');
    return d.choices[0].message.content.trim();
  }

  // ---- Live event fan-out (SSE) ----
  const clients = new Map();
  const emit = (id, event, data) => {
    clients.get(id)?.forEach((res) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  async function fireWhisper(id, text) {
    const terms = [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
      .slice(0, 8)
      .map((w) => `"${w}"`)
      .join(' OR ');
    const hit = terms ? q('SELECT title, content FROM kb WHERE kb MATCH ? ORDER BY rank LIMIT 1').get(terms) : null;
    try {
      const tip = await copilot(
        'You are a real-time negotiation copilot. Reply with ONE bullet under 25 words: a killer fact or a sharp pivot question. Use ONLY the verified context if given; otherwise ask a discovery question. No filler, no preamble.',
        `Verified context:\n${hit ? hit.content.slice(0, 600) : 'none'}\n\nProspect said: "${text}"`
      );
      emit(id, 'whisper', { tip, source: hit?.title || null, trigger: text });
    } catch (e) {
      emit(id, 'error', { message: 'Whisper failed: ' + e.message });
    }
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/', express.static(path.join(__dirname, '..', 'renderer')));

  app.get('/api/health', (_, res) => res.json({ ok: true, gemini: !!cfg.geminiApiKey, nvidia: !!cfg.nvidiaApiKey }));

  app.get('/api/settings', (_, res) => res.json(redact(cfg)));
  app.post('/api/settings', (req, res) => {
    cfg = saveConfig(configPath, { ...cfg, ...req.body });
    res.json(redact(cfg));
  });

  app.get('/api/meetings', (_, res) =>
    res.json(q('SELECT id, title, started_at, ended_at FROM meetings ORDER BY started_at DESC LIMIT 200').all())
  );
  app.post('/api/meetings', (req, res) => {
    const id = randomUUID();
    q('INSERT INTO meetings(id, title, started_at) VALUES(?,?,?)').run(
      id,
      String(req.body.title || 'Untitled meeting').slice(0, 200),
      Date.now()
    );
    res.json({ id });
  });
  app.get('/api/meetings/:id', (req, res) => {
    const meeting = q('SELECT * FROM meetings WHERE id=?').get(req.params.id);
    if (!meeting) return res.sendStatus(404);
    res.json({
      meeting,
      segments: q('SELECT speaker, text, ts FROM segments WHERE meeting_id=? ORDER BY ts').all(req.params.id),
      actions: q('SELECT task, assignee, status FROM actions WHERE meeting_id=?').all(req.params.id)
    });
  });
  app.delete('/api/meetings/:id', (req, res) => {
    q('DELETE FROM meetings WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/meetings/:id/stream', (req, res) => {
    const { id } = req.params;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    if (!clients.has(id)) clients.set(id, new Set());
    clients.get(id).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.get(id)?.delete(res);
    });
  });

  app.post('/api/meetings/:id/chunk', express.raw({ type: '*/*', limit: '12mb' }), async (req, res) => {
    const { id } = req.params;
    const speaker = req.query.src === 'me' ? 'You' : 'Them';
    if (!q('SELECT 1 FROM meetings WHERE id=?').get(id)) return res.sendStatus(404);
    try {
      const text = await gemini([
        { text: 'Transcribe this audio verbatim. Output only the spoken words, nothing else. If there is no clear speech, output nothing.' },
        { inline_data: { mime_type: 'audio/wav', data: req.body.toString('base64') } }
      ]);
      if (text.length < 2) return res.json({ ok: true });
      const seg = { speaker, text, ts: Date.now() };
      q('INSERT INTO segments(meeting_id, speaker, text, ts) VALUES(?,?,?,?)').run(id, speaker, text, seg.ts);
      emit(id, 'segment', seg);
      res.json({ ok: true });
      if (speaker === 'Them' && TRIGGERS.test(text)) fireWhisper(id, text);
      if (speaker === 'You' && COMMIT.test(text)) {
        q('INSERT INTO actions(meeting_id, task, assignee) VALUES(?,?,?)').run(id, text, 'You');
        emit(id, 'action', { task: text, assignee: 'You' });
      }
    } catch (e) {
      emit(id, 'error', { message: e.message });
      res.status(502).json({ error: e.message });
    }
  });

  app.post('/api/meetings/:id/end', async (req, res) => {
    const { id } = req.params;
    const segs = q('SELECT speaker, text FROM segments WHERE meeting_id=? ORDER BY ts').all(id);
    let summary = 'No speech was captured.';
    let items = [];
    try {
      if (segs.length) {
        const j = JSON.parse(
          await gemini(
            [
              {
                text:
                  'Summarize this meeting. Return JSON only: {"summary": string (max 120 words), "action_items": [{"task": string, "assignee": string}]}.\n\n' +
                  segs.map((s) => `${s.speaker}: ${s.text}`).join('\n')
              }
            ],
            true
          )
        );
        summary = j.summary || summary;
        items = j.action_items || [];
      }
    } catch (e) {
      summary = 'Summary failed: ' + e.message;
    }
    const ins = q('INSERT INTO actions(meeting_id, task, assignee) VALUES(?,?,?)');
    items.forEach((a) => ins.run(id, a.task, a.assignee || 'Unassigned'));
    q('UPDATE meetings SET ended_at=?, summary=? WHERE id=?').run(Date.now(), summary, id);
    res.json({ summary, items });
  });

  app.get('/api/kb', (_, res) => res.json(q('SELECT rowid AS id, title, content FROM kb').all()));
  app.post('/api/kb', (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
    q('INSERT INTO kb(title, content) VALUES(?,?)').run(title, content);
    res.json({ ok: true });
  });
  app.delete('/api/kb/:id', (req, res) => {
    q('DELETE FROM kb WHERE rowid=?').run(req.params.id);
    res.json({ ok: true });
  });

  return { app, db };
}
