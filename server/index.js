import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { openDb } from './db.js';
import { loadConfig, saveConfig, redact } from './config.js';
import { parseCaptureSequence, parseCaptureSource, validateWavPayload } from './audio.js';
import { createAiRuntime } from './ai/index.js';
import { createLogger } from './logger.js';
import { syncKnowledge, listKnowledgeSources, initSourceRegistry, listRegisteredSources, registerSource, setSourceEnabled, deleteSource, syncRegisteredSource, syncAllRegisteredSources } from './knowledge.js';
import { syncMeetingToObsidian } from './obsidian.js';
import { createVectorStore } from './vector.js';
import {
  initAgentStore, listAgents, updateAgent, runAgent, listInbox, markInbox,
  listApprovals, createApproval, resolveApproval, listSchedules, createSchedule,
  updateSchedule, deleteSchedule, searchBrain, listBrainMemories,
  deleteBrainMemory, seedMeetingBrain
} from './agents.js';
import { initSkillsStore, listSkills, upsertSkill, setSkillEnabled } from './skills.js';
import {
  initOrchestrationStore, listFamilies, setFamilyMembers, enqueueJob, listJobs, getJob, cancelJob,
  retryJob, createHandoff, listHandoffs, createBatch, listBatches, getBatch, startJobScheduler
} from './orchestration.js';
import { purgeBrainForMeeting, upsertBrainMemory } from './brain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRIGGERS = /competitor|alternative|compare|switch|too expensive|budget|pric(e|ing)|cost|security|complian|soc ?2|hipaa|gdpr|on-?prem|integrat|sla\b/i;
const COMMIT = /\b(i'?ll|i will|we'?ll|we will|let me)\b.{0,40}\b(send|share|email|follow up|get back|schedule|set up|prepare)\b/i;

function applyRetentionPolicy(db, retentionDays) {
  if (!retentionDays) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return db.prepare('DELETE FROM meetings WHERE ended_at IS NOT NULL AND ended_at < ?').run(cutoff).changes;
}


function safeMeddpicc(value) {
  const source = value && typeof value === 'object' ? value : {};
  const clean = {};
  for (const key of ['metrics','economic_buyer','decision_criteria','decision_process','paper_process','identify_pain','champion','competition']) {
    clean[key] = String(source[key] || '').trim().slice(0, 1000);
  }
  return clean;
}

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
  const logger = createLogger('server');
  let vector = createVectorStore(db, {
    embeddingUrl: cfg.localEmbeddingUrl,
    embeddingModel: cfg.localEmbeddingModel,
    dimensions: cfg.embeddingDimensions,
    timeoutMs: cfg.aiTimeoutMs
  });
  applyRetentionPolicy(db, cfg.retentionDays);
  initSourceRegistry(db);
  if (cfg.knowledgeDir) {
    try {
      registerSource(db, { id: 'default-knowledge', name: 'Default knowledge folder', rootPath: cfg.knowledgeDir });
      syncRegisteredSource(db, 'default-knowledge');
    } catch (error) { logger.warn('knowledge sync failed', { reason: error.message }); }
  }
  if (vector.enabled && cfg.localEmbeddingUrl) void vector.reindexAll().catch((error) => logger.warn('vector reindex failed', { reason: error.message }));
  initAgentStore(db);
  initSkillsStore(db);
  initOrchestrationStore(db);
  const clients = new Map();
  const stopAgentScheduler = startJobScheduler({
    db,
    getAi: () => ai,
    getCfg: () => cfg,
    onError: (error) => logger.warn('agent scheduler error', { reason: error.message })
  });

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
    const brainHit = searchBrain(text, 3)[0] || null;

    try {
      const semantic = await vector.search(text, 3);
      const contextEntry = semantic[0] || hit || brainHit;
      const tip = await ai.copilot(
        'You are a real-time meeting copilot. Reply with one concise bullet under 25 words. Use only verified local context when supplied. Never invent facts. Otherwise ask one useful discovery question. No filler or preamble.',
        'Verified local context:\n' + (contextEntry ? contextEntry.content.slice(0, 1200) : 'none') +
        '\n\nParticipant said: "' + text.slice(0, 2000) + '"'
      );
      if (tip) emit(id, 'whisper', { tip, source: contextEntry?.title || null, sourceId: contextEntry?.id || null, trigger: text });
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
    const pendingApprovals = q('SELECT COUNT(*) AS count FROM agent_approvals WHERE status="pending"').get().count;
    const unreadInbox = q('SELECT COUNT(*) AS count FROM agent_inbox WHERE status="unread"').get().count;
    res.json({
      ok: true,
      aiReady: status.ready,
      ai: status,
      vector: vector.status(),
      knowledgeSources: listKnowledgeSources(db).length,
      agents: listAgents(db).length,
      pendingApprovals,
      unreadInbox
    });
  });

  app.get('/api/settings', (_, res) => res.json(redact(cfg)));

  app.get('/api/kb/sources', (_, res) => res.json(listKnowledgeSources(db)));

  app.post('/api/kb/sync', async (_, res) => {
    try {
      registerSource(db, { id: 'default-knowledge', name: 'Default knowledge folder', rootPath: cfg.knowledgeDir }); const result = syncRegisteredSource(db, 'default-knowledge');
      const vectorResult = vector.enabled && cfg.localEmbeddingUrl ? await vector.reindexAll() : null;
      res.json({ ...result, vector: vectorResult });
    } catch (error) {
      res.status(500).json({ error: 'Knowledge sync failed: ' + error.message });
    }
  });

  app.get('/api/privacy', (_, res) => {
    const meetingCount = db.prepare('SELECT COUNT(*) AS count FROM meetings').get().count;
    const transcriptCount = db.prepare('SELECT COUNT(*) AS count FROM segments').get().count;
    const kbCount = db.prepare('SELECT COUNT(*) AS count FROM kb').get().count;
    const brainCount = db.prepare('SELECT COUNT(*) AS count FROM brain_memories').get().count;
    const status = ai.status();
    const localOnly = status.active === 'local-native' || status.active === 'local-http';
    res.json({ retentionDays: cfg.retentionDays, localOnly, activeProvider: status.active, meetingCount, transcriptCount, kbCount, brainCount });
  });

  app.post('/api/privacy', (req, res) => {
    cfg = saveConfig(configPath, { ...cfg, retentionDays: req.body.retentionDays });
    const deleted = applyRetentionPolicy(db, cfg.retentionDays);
    res.json({ retentionDays: cfg.retentionDays, deleted });
  });

  app.post('/api/privacy/cleanup', (_, res) => {
    const deleted = applyRetentionPolicy(db, cfg.retentionDays);
    res.json({ ok: true, deleted, retentionDays: cfg.retentionDays });
  });

  app.post('/api/settings', (req, res) => {
    cfg = saveConfig(configPath, { ...cfg, ...req.body });
    const previousAi = ai;
    ai = createAiRuntime(cfg);
    previousAi.close();
    vector = createVectorStore(db, {
      embeddingUrl: cfg.localEmbeddingUrl,
      embeddingModel: cfg.localEmbeddingModel,
      dimensions: cfg.embeddingDimensions,
      timeoutMs: cfg.aiTimeoutMs
    });
    if (cfg.knowledgeDir) {
      try {
        registerSource(db, { id: 'default-knowledge', name: 'Default knowledge folder', rootPath: cfg.knowledgeDir });
        syncRegisteredSource(db, 'default-knowledge');
      } catch (error) { logger.warn('knowledge sync failed', { reason: error.message }); }
    }
    if (vector.enabled && cfg.localEmbeddingUrl) void vector.reindexAll().catch((error) => logger.warn('vector reindex failed', { reason: error.message }));
    res.json(redact(cfg));
  });

  app.get('/api/skills', (_, res) => res.json(listSkills(db)));

  app.post('/api/skills', (req, res) => {
    try { return res.status(201).json(upsertSkill(db, req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.patch('/api/skills/:id', (req, res) => {
    try { return res.json(setSkillEnabled(db, req.params.id, req.body?.enabled)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/sources', (_, res) => res.json(listRegisteredSources(db)));

  app.post('/api/sources', (req, res) => {
    try { return res.status(201).json(registerSource(db, req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.post('/api/sources/:id/sync', async (req, res) => {
    try {
      const result = syncRegisteredSource(db, req.params.id);
      const vectorResult = vector.enabled && cfg.localEmbeddingUrl ? await vector.reindexAll() : null;
      return res.json({ ...result, vector: vectorResult });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.post('/api/sources/sync-all', async (_, res) => {
    try {
      const results = syncAllRegisteredSources(db);
      const vectorResult = vector.enabled && cfg.localEmbeddingUrl ? await vector.reindexAll() : null;
      return res.json({ results, vector: vectorResult });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  app.patch('/api/sources/:id', (req, res) => {
    try { return res.json(setSourceEnabled(db, req.params.id, req.body?.enabled)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.delete('/api/sources/:id', (req, res) => {
    try { return res.json(deleteSource(db, req.params.id)); }
    catch (error) { return res.status(404).json({ error: error.message }); }
  });

  app.get('/api/agent/families', (_, res) => res.json(listFamilies(db)));

  app.patch('/api/agent/families/:id', (req, res) => {
    try { return res.json(setFamilyMembers(db, req.params.id, req.body?.agentIds || [])); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agent/jobs', (req, res) => res.json(listJobs(db, { status: String(req.query.status || ''), limit: req.query.limit })));

  app.post('/api/agent/jobs', (req, res) => {
    try {
      const job = enqueueJob(db, {
        kind: 'agent_run',
        payload: {
          agentId: String(req.body?.agentId || ''),
          request: String(req.body?.request || ''),
          meetingId: req.body?.meetingId || null,
          skillId: req.body?.skillId || null
        },
        idempotencyKey: req.body?.idempotencyKey || null,
        maxAttempts: req.body?.maxAttempts
      });
      return res.status(201).json(job);
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agent/jobs/:id', (req, res) => {
    try { return res.json(getJob(db, req.params.id)); }
    catch (error) { return res.status(404).json({ error: error.message }); }
  });

  app.post('/api/agent/jobs/:id/retry', (req, res) => {
    try { return res.json(retryJob(db, req.params.id)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.post('/api/agent/jobs/:id/cancel', (req, res) => {
    try { return res.json(cancelJob(db, req.params.id)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agent/handoffs', (req, res) => res.json(listHandoffs(db, String(req.query.status || ''), req.query.limit)));

  app.post('/api/agent/handoffs', (req, res) => {
    try {
      return res.status(201).json(createHandoff(db, {
        fromAgentId: req.body?.fromAgentId || null,
        toAgentId: req.body?.toAgentId,
        parentRunId: req.body?.parentRunId || null,
        request: req.body?.request,
        context: req.body?.context || {}
      }));
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agent/batches', (req, res) => res.json(listBatches(req.query.limit)));

  app.get('/api/agent/batches/:id', (req, res) => {
    try { return res.json(getBatch(db, req.params.id)); }
    catch (error) { return res.status(404).json({ error: error.message }); }
  });

  app.post('/api/agent/batches', (req, res) => {
    try { return res.status(201).json(createBatch(db, { title: req.body?.title, items: req.body?.items || [] })); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agents', (_, res) => res.json(listAgents(db)));

  app.patch('/api/agents/:id', (req, res) => {
    try { return res.json(updateAgent(db, req.params.id, req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.post('/api/agents/:id/run', async (req, res) => {
    try {
      const result = await runAgent({
        db,
        ai,
        cfg,
        agentId: req.params.id,
        request: req.body?.request,
        meetingId: req.body?.meetingId || null,
        skillId: req.body?.skillId || null
      });
      return res.status(201).json(result);
    } catch (error) {
      return res.status(502).json({ error: 'Agent run failed: ' + error.message });
    }
  });

  app.get('/api/agent/inbox', (req, res) => res.json(listInbox(db, {
    status: String(req.query.status || ''),
    limit: req.query.limit
  })));

  app.patch('/api/agent/inbox/:id', (req, res) => {
    try { return res.json(markInbox(db, req.params.id, String(req.body?.status || 'read'))); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agent/approvals', (req, res) => res.json(listApprovals(db, String(req.query.status || 'pending'), req.query.limit)));

  app.post('/api/agent/approvals/:id/resolve', async (req, res) => {
    try {
      const result = await resolveApproval({
        db,
        cfg,
        approvalId: req.params.id,
        decision: String(req.body?.decision || '')
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/agent/brain', (req, res) => res.json(listBrainMemories(db, {
    kind: req.query.kind,
    namespace: req.query.namespace,
    limit: req.query.limit
  })));

  app.get('/api/agent/brain/search', (req, res) => res.json(searchBrain(db, req.query.q, req.query.limit)));

  app.post('/api/agent/brain', (req, res) => {
    try { return res.status(201).json(upsertBrainMemory(db, req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.delete('/api/agent/brain/:id', (req, res) => {
    try {
      if (!deleteBrainMemory(db, req.params.id)) return res.sendStatus(404);
      return res.json({ ok: true });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.get('/api/agent/schedules', (_, res) => res.json(listSchedules(db)));

  app.post('/api/agent/schedules', (req, res) => {
    try { return res.status(201).json(createSchedule(db, req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.patch('/api/agent/schedules/:id', (req, res) => {
    try { return res.json(updateSchedule(db, req.params.id, req.body || {})); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  app.delete('/api/agent/schedules/:id', (req, res) => {
    try { return res.json(deleteSchedule(db, req.params.id)); }
    catch (error) { return res.status(404).json({ error: error.message }); }
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
    logger.info('meeting created', { meetingId: id });
    res.status(201).json({ id });
  });

  app.get('/api/meetings/:id', (req, res) => {
    const meeting = q('SELECT * FROM meetings WHERE id=?').get(req.params.id);
    if (!meeting) return res.sendStatus(404);
    res.json({
      meeting,
      segments: q('SELECT speaker, text, ts FROM segments WHERE meeting_id=? ORDER BY ts').all(req.params.id),
      actions: q('SELECT id, task, assignee, status FROM actions WHERE meeting_id=? ORDER BY id').all(req.params.id),
      agenda: q('SELECT id, item, checked, position FROM agenda_items WHERE meeting_id=? ORDER BY position, id').all(req.params.id),
      meddpicc: q('SELECT metrics, economic_buyer, decision_criteria, decision_process, paper_process, identify_pain, champion, competition, updated_at FROM meeting_intelligence WHERE meeting_id=?').get(req.params.id) || null
    });
  });

  app.get('/api/meetings/:id/export', (req, res) => {
    const context = q('SELECT * FROM meetings WHERE id=?').get(req.params.id);
    if (!context) return res.sendStatus(404);
    const segments = q('SELECT speaker, text, ts FROM segments WHERE meeting_id=? ORDER BY ts').all(req.params.id);
    const actions = q('SELECT task, assignee, status FROM actions WHERE meeting_id=? ORDER BY id').all(req.params.id);
    const document = {
      meeting: context,
      segments,
      actions,
      exported_at: Date.now(),
      privacy: { local_only: ai.status().active === 'local-native' || ai.status().active === 'local-http', active_provider: ai.status().active }
    };
    res.setHeader('Content-Disposition', 'attachment; filename="oli-meeting-' + req.params.id + '.json"');
    res.json(document);
  });

  app.delete('/api/meetings/:id', (req, res) => {
    const result = q('DELETE FROM meetings WHERE id=?').run(req.params.id);
    if (!result.changes) return res.sendStatus(404);
    clients.get(req.params.id)?.forEach((client) => {
      try { client.end(); } catch {}
    });
    clients.delete(req.params.id);
    purgeBrainForMeeting(db, req.params.id);
    q('DELETE FROM agent_inbox WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE meeting_id=?)').run(req.params.id);
    q('DELETE FROM agent_approvals WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE meeting_id=?)').run(req.params.id);
    q('DELETE FROM agent_audit WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE meeting_id=?)').run(req.params.id);
    q('DELETE FROM agent_runs WHERE meeting_id=?').run(req.params.id);
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
      logger.error('transcription failed', { meetingId: id, reason: error.message });
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
        const meddpicc = safeMeddpicc(result.meddpicc);
        q(`INSERT INTO meeting_intelligence(
          meeting_id, metrics, economic_buyer, decision_criteria, decision_process,
          paper_process, identify_pain, champion, competition, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(meeting_id) DO UPDATE SET
          metrics=excluded.metrics, economic_buyer=excluded.economic_buyer,
          decision_criteria=excluded.decision_criteria, decision_process=excluded.decision_process,
          paper_process=excluded.paper_process, identify_pain=excluded.identify_pain,
          champion=excluded.champion, competition=excluded.competition, updated_at=excluded.updated_at`)
          .run(id, meddpicc.metrics, meddpicc.economic_buyer, meddpicc.decision_criteria, meddpicc.decision_process,
            meddpicc.paper_process, meddpicc.identify_pain, meddpicc.champion, meddpicc.competition, Date.now());
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
    logger.info('meeting ended', { meetingId: id, segments: segments.length, actions: items.length });
    try {
      seedMeetingBrain(db, id);
    } catch (error) {
      logger.warn('meeting Brain seed failed', { meetingId: id, reason: error.message });
    }
    if (segments.length && ai.status().ready) {
      try {
        const job = enqueueJob(db, {
          kind: 'agent_run',
          payload: {
            agentId: 'meeting-analyst',
            meetingId: id,
            request: 'Review this completed meeting. Store only durable, evidence-backed people, projects, decisions, risks, facts and commitments in the shared Brain. Create a concise review item for the Inbox. Do not propose external side effects.'
          },
          idempotencyKey: 'meeting-analyst:' + id,
          maxAttempts: 3
        });
        logger.info('meeting analyst job queued', { meetingId: id, jobId: job.id });
      } catch (error) {
        logger.warn('meeting analyst queue failed', { meetingId: id, reason: error.message });
      }
    }
    let obsidianPath = null;
    let crmSynced = false;
    let crmApprovalId = null;
    if (cfg.obsidianVaultPath) {
      try {
        obsidianPath = syncMeetingToObsidian(db, id, cfg.obsidianVaultPath);
      } catch (error) {
        logger.warn('Obsidian sync failed', { meetingId: id, reason: error.message });
      }
    }
    if (cfg.crmWebhookUrl) {
      try {
        const approval = createApproval(db, {
          actionType: 'crm_sync',
          payload: { meetingId: id },
          reason: 'Meeting-complete CRM export requested. Review the structured summary, MEDDPICC and commitments before allowing the external write.'
        });
        crmApprovalId = approval.id;
        logger.info('CRM sync approval queued', { meetingId: id, approvalId: approval.id });
      } catch (error) {
        logger.warn('CRM approval queue failed', { meetingId: id, reason: error.message });
      }
    }
    emit(id, 'meeting-ended', { summary });
    res.json({ summary, items, obsidianPath, crmSynced, crmApprovalId });
  });

  app.get('/api/meetings/:id/agenda', (req, res) => {
    if (!meetingExists(req.params.id)) return res.sendStatus(404);
    res.json(q('SELECT id, item, checked, position FROM agenda_items WHERE meeting_id=? ORDER BY position, id').all(req.params.id));
  });

  app.post('/api/meetings/:id/agenda', (req, res) => {
    if (!meetingExists(req.params.id)) return res.sendStatus(404);
    const item = String(req.body.item || '').trim();
    if (!item) return res.status(400).json({ error: 'item is required' });
    const max = q('SELECT COALESCE(MAX(position), -1) AS position FROM agenda_items WHERE meeting_id=?').get(req.params.id).position;
    const result = q('INSERT INTO agenda_items(meeting_id, item, checked, position) VALUES(?,?,0,?)').run(req.params.id, item.slice(0, 300), Number(max) + 1);
    res.status(201).json(q('SELECT id, item, checked, position FROM agenda_items WHERE id=?').get(result.lastInsertRowid));
  });

  app.patch('/api/agenda/:id', (req, res) => {
    if (req.body.checked == null) return res.status(400).json({ error: 'checked is required' });
    const result = q('UPDATE agenda_items SET checked=? WHERE id=?').run(req.body.checked ? 1 : 0, req.params.id);
    if (!result.changes) return res.sendStatus(404);
    res.json(q('SELECT id, meeting_id, item, checked, position FROM agenda_items WHERE id=?').get(req.params.id));
  });

  app.delete('/api/agenda/:id', (req, res) => {
    const result = q('DELETE FROM agenda_items WHERE id=?').run(req.params.id);
    if (!result.changes) return res.sendStatus(404);
    res.json({ ok: true });
  });

  app.patch('/api/actions/:id', (req, res) => {
    const allowed = new Set(['pending', 'done', 'cancelled']);
    const status = String(req.body.status || '').toLowerCase();
    if (!allowed.has(status)) return res.status(400).json({ error: 'status must be pending, done, or cancelled' });
    const result = q('UPDATE actions SET status=? WHERE id=?').run(status, req.params.id);
    if (!result.changes) return res.sendStatus(404);
    res.json(q('SELECT id, meeting_id, task, assignee, status FROM actions WHERE id=?').get(req.params.id));
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
    const cleanTitle = title.slice(0, 200);
    const cleanContent = content.slice(0, 20000);
    const result = q('INSERT INTO kb(title, content) VALUES(?,?)').run(cleanTitle, cleanContent);
    if (vector.enabled && cfg.localEmbeddingUrl) {
      void vector.upsert(Number(result.lastInsertRowid), cleanTitle + '\n' + cleanContent)
        .catch((error) => logger.warn('vector upsert failed', { reason: error.message }));
    }
    res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
  });

  app.delete('/api/kb/:id', (req, res) => {
    const result = q('DELETE FROM kb WHERE rowid=?').run(req.params.id);
    if (!result.changes) return res.sendStatus(404);
    if (vector.enabled) {
      try { q('DELETE FROM kb_vectors WHERE rowid=?').run(BigInt(req.params.id)); } catch {}
    }
    res.json({ ok: true });
  });

  return {
    app,
    db,
    close() {
      clients.forEach((connections) => connections.forEach((res) => { try { res.end(); } catch {} }));
      clients.clear();
      stopAgentScheduler();
      ai.close();
      db.close();
    }
  };
}
