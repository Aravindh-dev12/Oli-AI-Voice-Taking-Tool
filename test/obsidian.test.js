import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { syncMeetingToObsidian } from '../server/obsidian.js';

test('Obsidian sync writes a local Markdown meeting note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-obsidian-'));
  const vault = path.join(dir, 'vault');
  const db = openDb(path.join(dir, 'oli.db'));
  db.prepare('INSERT INTO meetings(id, title, started_at, ended_at, summary) VALUES(?,?,?,?,?)')
    .run('m1', 'Customer / Security', Date.now(), Date.now(), 'Summary');
  db.prepare('INSERT INTO agenda_items(meeting_id, item, checked, position) VALUES(?,?,?,?)')
    .run('m1', 'Agenda', 1, 0);
  db.prepare('INSERT INTO actions(meeting_id, task, assignee, status) VALUES(?,?,?,?)')
    .run('m1', 'Send report', 'You', 'pending');
  db.prepare('INSERT INTO meeting_intelligence(meeting_id, metrics, champion, updated_at) VALUES(?,?,?,?)')
    .run('m1', '$100k', 'Alex', Date.now());
  db.prepare('INSERT INTO segments(meeting_id, speaker, text, ts) VALUES(?,?,?,?)')
    .run('m1', 'Them', 'We need the report.', Date.now());

  const target = syncMeetingToObsidian(db, 'm1', vault);
  assert.equal(fs.existsSync(target), true);
  const content = fs.readFileSync(target, 'utf8');
  assert.match(content, /MEDDPICC/);
  assert.match(content, /Send report/);
  assert.match(content, /We need the report/);
  db.close();
});
