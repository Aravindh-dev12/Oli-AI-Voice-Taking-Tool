import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.js';

test('meeting API returns structured MEDDPICC and commitment IDs', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-med-'));
  const server = createServer({
    dbPath: path.join(dir, 'oli.db'),
    configPath: path.join(dir, 'config.json')
  });
  const http = await new Promise((resolve) => {
    const s = server.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => { server.close(); http.close(); });

  const db = server.db;
  db.prepare('INSERT INTO meetings(id, title, started_at) VALUES(?,?,?)').run('m1', 'MEDDPICC test', Date.now());
  db.prepare('INSERT INTO actions(meeting_id, task, assignee) VALUES(?,?,?)').run('m1', 'Send report', 'You');
  db.prepare('INSERT INTO meeting_intelligence(meeting_id, metrics, champion, updated_at) VALUES(?,?,?,?)')
    .run('m1', '$100k savings', 'Alex', Date.now());

  const payload = await fetch(base(http) + '/api/meetings/m1').then((r) => r.json());
  assert.equal(payload.actions[0].id > 0, true);
  assert.equal(payload.meddpicc.metrics, '$100k savings');
  assert.equal(payload.meddpicc.champion, 'Alex');
});

function base(server) {
  return 'http://127.0.0.1:' + server.address().port;
}
