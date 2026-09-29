import { randomUUID } from 'node:crypto';
import { runAgent } from './agents.js';

const JOB_STATES = new Set(['pending', 'processing', 'succeeded', 'failed', 'cancelled']);
const JOB_KINDS = new Set(['agent_run', 'handoff']);
const MAX_BATCH_SIZE = 8;

const DEFAULT_FAMILIES = [
  { id: 'meeting-operations', name: 'Meeting Operations', description: 'Meeting capture, debrief and follow-up workflows.', agents: ['meeting-analyst','follow-up-planner'] },
  { id: 'research', name: 'Research', description: 'Local evidence and account research workflows.', agents: ['researcher'] }
];

function clean(value, max = 8000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function initOrchestrationStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_family_members (
      family_id TEXT NOT NULL REFERENCES agent_families(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(family_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_family_members_agent ON agent_family_members(agent_id);
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT UNIQUE,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      available_at INTEGER NOT NULL,
      lease_until INTEGER,
      last_error TEXT,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_due ON agent_jobs(status, available_at);
    CREATE TABLE IF NOT EXISTS agent_handoffs (
      id TEXT PRIMARY KEY,
      from_agent_id TEXT,
      to_agent_id TEXT NOT NULL REFERENCES agent_profiles(id),
      parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      job_id TEXT REFERENCES agent_jobs(id) ON DELETE SET NULL,
      request TEXT NOT NULL,
      context_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_handoffs_status ON agent_handoffs(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_batches (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      total_count INTEGER NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_batch_items (
      batch_id TEXT NOT NULL REFERENCES agent_batches(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      job_id TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result_json TEXT,
      error TEXT,
      PRIMARY KEY(batch_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_batch_items_job ON agent_batch_items(job_id);
  `);

  const insertFamily = db.prepare(
    'INSERT OR IGNORE INTO agent_families(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)'
  );
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO agent_family_members(family_id,agent_id,position) VALUES(?,?,?)'
  );
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const family of DEFAULT_FAMILIES) {
      insertFamily.run(family.id, family.name, family.description, now, now);
      family.agents.forEach((agentId, position) => insertMember.run(family.id, agentId, position));
    }
  });
  tx();
  return db;
}

function listFamilies(db) {
  return db.prepare(
    `SELECT f.id, f.name, f.description, f.created_at, f.updated_at,
            COALESCE(json_group_array(m.agent_id) FILTER (WHERE m.agent_id IS NOT NULL), json('[]')) AS agents_json
       FROM agent_families f
       LEFT JOIN agent_family_members m ON m.family_id=f.id
      GROUP BY f.id
      ORDER BY f.name`
  ).all().map((row) => ({
    ...row,
    agents: JSON.parse(row.agents_json || '[]')
  }));
}

function setFamilyMembers(db, familyId, agentIds = []) {
  const family = db.prepare('SELECT * FROM agent_families WHERE id=?').get(String(familyId));
  if (!family) throw new Error('Agent family not found.');
  const members = [...new Set(agentIds.map(String))].slice(0, 16);
  for (const agentId of members) {
    if (!db.prepare('SELECT 1 FROM agent_profiles WHERE id=?').get(agentId)) throw new Error('Unknown agent: ' + agentId);
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM agent_family_members WHERE family_id=?').run(family.id);
    const insert = db.prepare('INSERT INTO agent_family_members(family_id,agent_id,position) VALUES(?,?,?)');
    members.forEach((agentId, position) => insert.run(family.id, agentId, position));
    db.prepare('UPDATE agent_families SET updated_at=? WHERE id=?').run(Date.now(), family.id);
  });
  tx();
  return listFamilies(db).find((item) => item.id === family.id);
}

function enqueueJob(db, { kind = 'agent_run', payload, idempotencyKey = null, maxAttempts = 3, availableAt = Date.now() }) {
  if (!JOB_KINDS.has(String(kind))) throw new Error('Unsupported job kind.');
  const normalizedMax = Math.min(Math.max(Number(maxAttempts) || 3, 1), 5);
  const id = randomUUID();
  const normalizedKey = idempotencyKey ? clean(idempotencyKey, 200) : null;
  const now = Date.now();

  if (normalizedKey) {
    const existing = db.prepare('SELECT * FROM agent_jobs WHERE idempotency_key=?').get(normalizedKey);
    if (existing) return existing;
  }

  db.prepare(
    'INSERT INTO agent_jobs(id,kind,status,idempotency_key,payload_json,attempts,max_attempts,available_at,created_at,updated_at) VALUES(?,?,\'pending\',?,?,?,?,?,?)'
  ).run(id, String(kind), normalizedKey, JSON.stringify(payload || {}), 0, normalizedMax, Math.max(Date.now(), Number(availableAt) || now), now, now);

  return db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(id);
}

function listJobs(db, { status = '', limit = 100 } = {}) {
  const statuses = status && JOB_STATES.has(String(status)) ? [String(status)] : null;
  const params = [];
  let sql = 'SELECT * FROM agent_jobs WHERE 1=1';
  if (statuses) { sql += ' AND status=?'; params.push(statuses[0]); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  return db.prepare(sql).all(...params);
}

function getJob(db, jobId) {
  const job = db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(String(jobId));
  if (!job) throw new Error('Job not found.');
  return job;
}

function cancelJob(db, jobId) {
  const result = db.prepare(
    'UPDATE agent_jobs SET status="cancelled",updated_at=? WHERE id=? AND status IN ("pending","processing")'
  ).run(Date.now(), String(jobId));
  if (!result.changes) throw new Error('Job not found or already completed.');
  return getJob(db, jobId);
}

function retryJob(db, jobId) {
  const result = db.prepare(
    'UPDATE agent_jobs SET status="pending",available_at=?,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND status="failed"'
  ).run(Date.now(), Date.now(), String(jobId));
  if (!result.changes) throw new Error('Only failed jobs can be retried.');
  return getJob(db, jobId);
}

function createHandoff(db, { fromAgentId = null, toAgentId, parentRunId = null, request, context = {} }) {
  if (!db.prepare('SELECT 1 FROM agent_profiles WHERE id=? AND enabled=1').get(String(toAgentId))) throw new Error('Target agent not found or disabled.');
  const id = randomUUID();
  const now = Date.now();
  const job = enqueueJob(db, {
    kind: 'handoff',
    payload: { handoffId: id, toAgentId: String(toAgentId), request: clean(request, 4000), context },
    idempotencyKey: 'handoff:' + id
  });
  db.prepare(
    'INSERT INTO agent_handoffs(id,from_agent_id,to_agent_id,parent_run_id,job_id,request,context_json,status,created_at) VALUES(?,?,?,?,?,?,?,"queued",?)'
  ).run(id, fromAgentId || null, String(toAgentId), parentRunId || null, job.id, clean(request, 4000), JSON.stringify(context || {}), now);
  return db.prepare('SELECT * FROM agent_handoffs WHERE id=?').get(id);
}

function listHandoffs(db, status = '', limit = 100) {
  const params = [];
  let sql = 'SELECT h.*, a.name AS to_agent_name FROM agent_handoffs h JOIN agent_profiles a ON a.id=h.to_agent_id WHERE 1=1';
  if (status && ['queued','running','succeeded','failed'].includes(String(status))) { sql += ' AND h.status=?'; params.push(String(status)); }
  sql += ' ORDER BY h.created_at DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  return db.prepare(sql).all(...params);
}

function createBatch(db, { title = 'Parallel agent run', items = [] }) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_BATCH_SIZE) throw new Error('Batch must contain 1-8 items.');
  for (const item of items) {
    if (!item || !item.agentId || !item.request) throw new Error('Each batch item needs agentId and request.');
    if (!db.prepare('SELECT 1 FROM agent_profiles WHERE id=? AND enabled=1').get(String(item.agentId))) throw new Error('Unknown agent: ' + item.agentId);
  }
  const batchId = randomUUID();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO agent_batches(id,title,status,total_count,created_at,updated_at) VALUES(?,?,\'queued\',?,?,?)')
      .run(batchId, clean(title, 240) || 'Parallel agent run', items.length, now, now);
    const insertItem = db.prepare('INSERT INTO agent_batch_items(batch_id,position,job_id,agent_id,request,status) VALUES(?,?,?,?,?,?)');
    items.forEach((item, index) => {
      const job = enqueueJob(db, {
        kind: 'agent_run',
        payload: { agentId: String(item.agentId), request: clean(item.request, 4000), meetingId: item.meetingId || null, skillId: item.skillId || null, batchId, batchPosition: index },
        idempotencyKey: 'batch:' + batchId + ':' + index
      });
      insertItem.run(batchId, index, job.id, String(item.agentId), clean(item.request, 4000), 'queued');
    });
  });
  tx();
  return db.prepare('SELECT * FROM agent_batches WHERE id=?').get(batchId);
}

function listBatches(db, limit = 100) {
  return db.prepare('SELECT * FROM agent_batches ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 100, 1), 200));
}

function getBatch(db, batchId) {
  const batch = db.prepare('SELECT * FROM agent_batches WHERE id=?').get(String(batchId));
  if (!batch) throw new Error('Batch not found.');
  const items = db.prepare('SELECT * FROM agent_batch_items WHERE batch_id=? ORDER BY position').all(batch.id);
  return { ...batch, items };
}

function updateBatchFromJob(db, job, result, error = null) {
  const payload = JSON.parse(job.payload_json || '{}');
  if (!payload.batchId) return;
  const item = db.prepare('SELECT * FROM agent_batch_items WHERE batch_id=? AND job_id=?').get(payload.batchId, job.id);
  if (!item) return;
  const status = job.status === 'succeeded' ? 'succeeded' : job.status === 'failed' ? 'failed' : job.status;
  db.prepare('UPDATE agent_batch_items SET status=?,result_json=?,error=? WHERE batch_id=? AND job_id=?')
    .run(status, result ? JSON.stringify(result) : null, error ? clean(error, 2000) : null, payload.batchId, job.id);
  const counts = db.prepare(
    'SELECT COUNT(*) AS total, SUM(status="succeeded") AS succeeded, SUM(status="failed") AS failed FROM agent_batch_items WHERE batch_id=?'
  ).get(payload.batchId);
  const done = Number(counts.succeeded || 0) + Number(counts.failed || 0);
  const batchStatus = done === Number(counts.total) ? (Number(counts.failed || 0) ? 'failed' : 'succeeded') : 'running';
  db.prepare(
    'UPDATE agent_batches SET status=?,completed_count=?,failed_count=?,updated_at=? WHERE id=?'
  ).run(batchStatus, Number(counts.succeeded || 0), Number(counts.failed || 0), Date.now(), payload.batchId);

  if (batchStatus === 'succeeded' || batchStatus === 'failed') {
    const existing = db.prepare('SELECT id FROM agent_inbox WHERE kind="batch-result" AND body LIKE ? LIMIT 1').get('%"batchId":"' + payload.batchId + '"%');
    if (!existing) {
      const rows = db.prepare(
        'SELECT i.position, i.agent_id, i.request, i.status, i.result_json, i.error FROM agent_batch_items i WHERE i.batch_id=? ORDER BY i.position'
      ).all(payload.batchId);
      const body = JSON.stringify({ batchId: payload.batchId, status: batchStatus, results: rows });
      db.prepare(
        'INSERT INTO agent_inbox(id,agent_run_id,kind,title,body,status,created_at) VALUES(?,?,?,?,?,"unread",?)'
      ).run(randomUUID(), null, 'batch-result', 'Parallel agent batch: ' + batchStatus, body.slice(0, 12000), Date.now());
    }
  }
}

async function executeJob({ db, ai, cfg, jobId }) {
  const job = getJob(db, jobId);
  if (job.status !== 'processing') throw new Error('Job must be processing.');
  const payload = JSON.parse(job.payload_json || '{}');

  if (job.kind === 'handoff') {
    const handoff = db.prepare('SELECT * FROM agent_handoffs WHERE id=?').get(payload.handoffId);
    if (!handoff) throw new Error('Handoff not found.');
    db.prepare('UPDATE agent_handoffs SET status="running" WHERE id=?').run(handoff.id);
    try {
      const result = await runAgent({
        db, ai, cfg,
        agentId: payload.toAgentId,
        request: payload.request + '\n\nHandoff context:\n' + JSON.stringify(payload.context || {}).slice(0, 12000),
        meetingId: payload.context?.meetingId || null
      });
      db.prepare('UPDATE agent_handoffs SET status="succeeded",result_run_id=?,completed_at=? WHERE id=?').run(result.id, Date.now(), handoff.id);
      return result;
    } catch (error) {
      db.prepare('UPDATE agent_handoffs SET status="failed",error=?,completed_at=? WHERE id=?').run(clean(error.message,2000), Date.now(), handoff.id);
      throw error;
    }
  }

  return runAgent({
    db, ai, cfg,
    agentId: payload.agentId,
    request: payload.request,
    meetingId: payload.meetingId || null,
    skillId: payload.skillId || null,
    idempotencyKey: 'job:' + job.id
  });
}

function claimJob(db, leaseMs = 120000) {
  const now = Date.now();
  const job = db.transaction(() => {
    const found = db.prepare(
      'SELECT * FROM agent_jobs WHERE (status="pending" AND available_at<=?) OR (status="processing" AND lease_until<?) ORDER BY created_at LIMIT 1'
    ).get(now, now);
    if (!found) return null;
    const result = db.prepare(
      'UPDATE agent_jobs SET status="processing",attempts=attempts+1,lease_until=?,updated_at=? WHERE id=?'
    ).run(now + leaseMs, now, found.id);
    return result.changes ? db.prepare('SELECT * FROM agent_jobs WHERE id=?').get(found.id) : null;
  })();
  return job;
}

async function processOneJob({ db, ai, cfg }) {
  const job = claimJob(db);
  if (!job) return null;
  try {
    const result = await executeJob({ db, ai, cfg, jobId: job.id });
    db.prepare('UPDATE agent_jobs SET status="succeeded",result_json=?,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?')
      .run(JSON.stringify(result || {}), Date.now(), job.id);
    updateBatchFromJob(db, { ...job, status: 'succeeded' }, result);
    return { ...job, status: 'succeeded', result };
  } catch (error) {
    const current = getJob(db, job.id);
    const exhausted = current.attempts >= current.max_attempts;
    const next = Date.now() + Math.min(15 * 60 * 1000, 1000 * 2 ** Math.max(current.attempts - 1, 0));
    db.prepare(
      'UPDATE agent_jobs SET status=?,available_at=?,lease_until=NULL,last_error=?,updated_at=? WHERE id=?'
    ).run(exhausted ? 'failed' : 'pending', next, clean(error.message,2000), Date.now(), job.id);
    updateBatchFromJob(db, { ...current, status: exhausted ? 'failed' : 'pending' }, null, error.message);
    return { ...current, status: exhausted ? 'failed' : 'pending', error: error.message };
  }
}

function enqueueDueSchedules(db) {
  const now = Date.now();
  const schedules = db.prepare(
    'SELECT * FROM agent_schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 20'
  ).all(now);
  const created = [];
  const tx = db.transaction(() => {
    for (const schedule of schedules) {
      const slot = schedule.next_run_at;
      const job = enqueueJob(db, {
        kind: 'agent_run',
        payload: {
          agentId: schedule.agent_id,
          request: schedule.prompt,
          scheduleId: schedule.id
        },
        idempotencyKey: 'schedule:' + schedule.id + ':' + slot,
        maxAttempts: 3
      });
      const next = Math.max(now, slot) + schedule.interval_ms;
      db.prepare('UPDATE agent_schedules SET next_run_at=?,last_run_id=COALESCE(last_run_id,?),updated_at=? WHERE id=?')
        .run(next, job.id, now, schedule.id);
      created.push(job);
    }
  });
  tx();
  return created;
}

function startJobScheduler({ db, getAi, getCfg, tickMs = 1000, concurrency = 3 }) {
  const running = new Set();
  const timer = setInterval(() => {
    enqueueDueSchedules(db);\n    while (running.size < concurrency) {
      const job = claimJob(db);
      if (!job) break;
      running.add(job.id);
      void executeJob({ db, ai: getAi(), cfg: getCfg(), jobId: job.id })
        .then((result) => {
          db.prepare('UPDATE agent_jobs SET status="succeeded",result_json=?,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?').run(JSON.stringify(result || {}), Date.now(), job.id);
          updateBatchFromJob(db, { ...job, status: 'succeeded' }, result);
        })
        .catch((error) => {
          const current = getJob(db, job.id);
          const exhausted = current.attempts >= current.max_attempts;
          const next = Date.now() + Math.min(15 * 60 * 1000, 1000 * 2 ** Math.max(current.attempts - 1, 0));
          db.prepare('UPDATE agent_jobs SET status=?,available_at=?,lease_until=NULL,last_error=?,updated_at=? WHERE id=?')
            .run(exhausted ? 'failed' : 'pending', next, clean(error.message, 2000), Date.now(), job.id);
          updateBatchFromJob(db, { ...current, status: exhausted ? 'failed' : 'pending' }, null, error.message);
        })
        .finally(() => running.delete(job.id));
    }
  }, tickMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export {
  JOB_STATES, JOB_KINDS, initOrchestrationStore, listFamilies, setFamilyMembers,
  enqueueJob, listJobs, getJob, cancelJob, retryJob, createHandoff, listHandoffs,
  createBatch, listBatches, getBatch, processOneJob, enqueueDueSchedules, startJobScheduler
};
