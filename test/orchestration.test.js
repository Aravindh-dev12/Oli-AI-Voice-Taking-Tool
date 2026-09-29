import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { initAgentStore } from '../server/agents.js';
import { listSkills, getSkill, upsertSkill } from '../server/skills.js';
import { initSourceRegistry, registerSource, syncRegisteredSource, listRegisteredSources, deleteSource } from '../server/knowledge.js';
import {
  initOrchestrationStore, createHandoff, listHandoffs, createBatch, getBatch,
  processOneJob, listJobs, enqueueDueSchedules
} from '../server/orchestration.js';
import { createSchedule } from '../server/agents.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-orch-'));
  return { dir, db: openDb(path.join(dir, 'oli.db')) };
}

const fakeAi = {
  async copilot() {
    return JSON.stringify({
      answer: 'Local result with no unsupported claims.',
      memories: [],
      actions: [],
      inbox: { title: 'Result', body: 'Completed from local context.' }
    });
  }
};

const cfg = { aiTimeoutMs: 1000, obsidianVaultPath: '', crmWebhookUrl: '', crmWebhookToken: '' };

test('skills are versioned, local and reusable by agent configuration', () => {
  const { db } = tempDb();
  try {
    initAgentStore(db);
    assert.ok(listSkills(db).length >= 4);
    assert.equal(getSkill(db, 'meeting-follow-up').version, 1);
    const skill = upsertSkill(db, {
      id: 'customer-review',
      name: 'Customer Review',
      description: 'Reusable customer review workflow',
      version: 2,
      prompt: 'Review local customer context and summarize evidence.'
    });
    assert.equal(skill.version, 2);
    assert.equal(getSkill(db, 'customer-review').prompt, 'Review local customer context and summarize evidence.');
  } finally {
    db.close();
  }
});

test('multiple local Markdown sources can sync independently and be removed cleanly', () => {
  const { dir, db } = tempDb();
  try {
    initSourceRegistry(db);
    const a = path.join(dir, 'sales');
    const b = path.join(dir, 'product');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, 'account.md'), '# Account\nAcme procurement context');
    fs.writeFileSync(path.join(b, 'product.md'), '# Product\nLocal product facts');

    registerSource(db, { id: 'sales', name: 'Sales', rootPath: a });
    registerSource(db, { id: 'product', name: 'Product', rootPath: b });
    const first = syncRegisteredSource(db, 'sales');
    const second = syncRegisteredSource(db, 'product');
    assert.equal(first.added, 1);
    assert.equal(second.added, 1);
    assert.equal(listRegisteredSources(db).length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM kb_sources WHERE source_id=?').get('sales').count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM kb_sources WHERE source_id=?').get('product').count, 1);

    fs.unlinkSync(path.join(a, 'account.md'));
    const removed = syncRegisteredSource(db, 'sales');
    assert.equal(removed.removed, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM kb_sources WHERE source_id=?').get('sales').count, 0);

    const deleted = deleteSource(db, 'product');
    assert.equal(deleted.removedEntries, 1);
    assert.equal(listRegisteredSources(db).length, 0);
  } finally {
    db.close();
  }
});

test('handoff and durable job execution persist across the local database lifecycle', async () => {
  const { db } = tempDb();
  try {
    initAgentStore(db);
    initOrchestrationStore(db);

    const handoff = createHandoff(db, {
      fromAgentId: 'meeting-analyst',
      toAgentId: 'researcher',
      request: 'Check the local Brain for account context.',
      context: { meetingId: null, note: 'handoff test' }
    });
    assert.equal(handoff.status, 'queued');
    assert.equal(listHandoffs(db).length, 1);

    const processed = await processOneJob({ db, ai: fakeAi, cfg });
    assert.equal(processed.status, 'succeeded');
    assert.equal(listHandoffs(db)[0].status, 'succeeded');

    const jobs = listJobs(db);
    assert.ok(jobs.some((job) => job.kind === 'handoff' && job.status === 'succeeded'));
  } finally {
    db.close();
  }
});

test('parallel batches fan out to durable jobs and produce an aggregated result', async () => {
  const { db } = tempDb();
  try {
    initAgentStore(db);
    initOrchestrationStore(db);
    const batch = createBatch(db, {
      title: 'Parallel evidence review',
      items: [
        { agentId: 'researcher', request: 'Review project context.' },
        { agentId: 'researcher', request: 'Review meeting context.', skillId: 'meeting-brief' }
      ]
    });
    assert.equal(batch.total_count, 2);
    assert.equal(getBatch(db, batch.id).items.length, 2);

    await processOneJob({ db, ai: fakeAi, cfg });
    await processOneJob({ db, ai: fakeAi, cfg });

    const completed = getBatch(db, batch.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.completed_count, 2);
    assert.ok(db.prepare('SELECT 1 FROM agent_inbox WHERE kind="batch-result"').get());
  } finally {
    db.close();
  }
});

test('due schedules are converted into durable jobs instead of executing work inline', () => {
  const { db } = tempDb();
  try {
    initAgentStore(db);
    initOrchestrationStore(db);
    const schedule = createSchedule(db, { agentId: 'researcher', prompt: 'Scheduled local review', intervalMs: 60000 });
    db.prepare('UPDATE agent_schedules SET next_run_at=? WHERE id=?').run(Date.now() - 1, schedule.id);
    const jobs = enqueueDueSchedules(db);
    assert.equal(jobs.length, 1);
    assert.equal(listJobs(db).filter((job) => job.status === 'pending').length, 1);
    assert.ok(db.prepare('SELECT 1 FROM agent_schedules WHERE id=? AND next_run_at>?').get(schedule.id, Date.now() - 1));
  } finally {
    db.close();
  }
});
