import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import {
  initAgentStore, runAgent, listApprovals, resolveApproval,
  listInbox, createSchedule, listSchedules, updateAgent, searchBrain
} from '../server/agents.js';
import { seedMeetingBrain, purgeBrainForMeeting, upsertBrainMemory } from '../server/brain.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-agent-'));
  return { dir, db: openDb(path.join(dir, 'oli.db')) };
}

test('shared Brain, approvals and Inbox work entirely on local SQLite', async (t) => {
  const { db } = tempDb();
  initAgentStore(db);
  t.after(() => db.close());

  db.prepare('INSERT INTO meetings(id,title,started_at,ended_at,summary) VALUES(?,?,?,?,?)')
    .run('meeting-1', 'Acme planning', Date.now(), Date.now(), 'Agreed on migration timeline.');
  db.prepare('INSERT INTO meeting_intelligence(meeting_id,identify_pain,decision_process,updated_at) VALUES(?,?,?,?)')
    .run('meeting-1', 'Manual reporting is slow.', 'Security review then procurement.', Date.now());
  db.prepare('INSERT INTO actions(meeting_id,task,assignee) VALUES(?,?,?)')
    .run('meeting-1', 'Send migration plan', 'You');

  seedMeetingBrain(db, 'meeting-1');
  assert.ok(searchBrain(db, 'migration').length >= 1);

  const ai = {
    async copilot() {
      return JSON.stringify({
        answer: 'Acme is evaluating a migration with a security and procurement gate.',
        memories: [{
          kind: 'project',
          title: 'Acme migration',
          content: 'Migration requires security review before procurement.',
          tags: ['acme', 'migration'],
          confidence: 0.95
        }],
        actions: [
          {
            type: 'brain_memory_upsert',
            reason: 'Persist the project context for future agent work.',
            payload: {
              kind: 'project',
              title: 'Acme migration',
              content: 'Migration requires security review before procurement.',
              tags: ['acme', 'migration'],
              sourceType: 'agent',
              sourceId: 'follow-up-planner:meeting-1'
            }
          },
          {
            type: 'create_commitment',
            reason: 'The team agreed to send the migration plan.',
            payload: { meetingId: 'meeting-1', task: 'Send migration plan', assignee: 'You' }
          },
          {
            type: 'followup_draft',
            payload: { title: 'Acme follow-up', body: 'Thanks for the discussion. Next step: send the migration plan.' }
          }
        ],
        inbox: { title: 'Acme follow-up plan', body: 'Review the proposed migration follow-up.' }
      });
    }
  };
  const cfg = {
    aiTimeoutMs: 1000,
    obsidianVaultPath: '',
    crmWebhookUrl: '',
    crmWebhookToken: ''
  };

  const run = await runAgent({
    db, ai, cfg, agentId: 'follow-up-planner',
    meetingId: 'meeting-1',
    request: 'Prepare evidence-backed follow-up work for the Acme migration.'
  });
  assert.equal(run.agent, 'follow-up-planner');
  assert.equal(listApprovals(db).length, 2);
  assert.ok(listInbox(db).length >= 2);
  assert.ok(searchBrain(db, 'Acme migration').some((row) => row.title === 'Acme migration'));

  await resolveApproval({ db, cfg, approvalId: listApprovals(db)[0].id, decision: 'approved' });
  await resolveApproval({ db, cfg, approvalId: listApprovals(db)[0].id, decision: 'approved' });
  assert.ok(db.prepare('SELECT 1 FROM actions WHERE meeting_id=? AND task=?').get('meeting-1', 'Send migration plan'));

  const schedule = createSchedule(db, {
    agentId: 'researcher',
    prompt: 'Review recent migration knowledge.',
    intervalMs: 60000
  });
  assert.equal(listSchedules(db).length, 1);
  assert.equal(updateAgent(db, 'researcher', { permissionMode: 'read_only' }).permission_mode, 'read_only');
  db.prepare('DELETE FROM agent_schedules WHERE id=?').run(schedule.id);
});

test('meeting-derived Brain data can be purged without touching unrelated shared memory', () => {
  const { db } = tempDb();
  try {
    initAgentStore(db);
    const now = Date.now();
    db.prepare('INSERT INTO meetings(id,title,started_at,ended_at,summary) VALUES(?,?,?,?,?)')
      .run('meeting-2', 'Privacy review', now, now, 'Local only.');
    seedMeetingBrain(db, 'meeting-2');
    const before = searchBrain(db, 'Privacy review').length;
    db.prepare('INSERT INTO brain_memories(kind,namespace,title,content,source_type,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('topic', 'shared', 'Keep local', 'Unrelated durable memory', 'manual', null, now, now);
    const removed = purgeBrainForMeeting(db, 'meeting-2');
    assert.ok(before >= 1);
    assert.ok(removed >= 1);
    assert.equal(searchBrain(db, 'Privacy review').filter((row) => row.source_id === 'meeting-2').length, 0);
    assert.equal(searchBrain(db, 'Keep local').length, 0);
  } finally {
    db.close();
  }
});
