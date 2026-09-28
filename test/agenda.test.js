import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.js';

test('meeting agenda lifecycle supports create/check/delete', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-agenda-'));
  const app = createServer({
    dbPath: path.join(dir, 'oli.db'),
    configPath: path.join(dir, 'config.json')
  });
  const http = await new Promise((resolve) => {
    const server = app.app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => { app.close(); http.close(); });

  app.db.prepare('INSERT INTO meetings(id, title, started_at) VALUES(?,?,?)').run('agenda-1', 'Agenda test', Date.now());
  const base = 'http://127.0.0.1:' + http.address().port;

  const created = await fetch(base + '/api/meetings/agenda-1/agenda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: 'Pricing' })
  }).then((r) => r.json());

  assert.equal(created.item, 'Pricing');
  assert.equal(created.checked, 0);

  const checked = await fetch(base + '/api/agenda/' + created.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checked: true })
  }).then((r) => r.json());

  assert.equal(checked.checked, 1);

  const del = await fetch(base + '/api/agenda/' + created.id, { method: 'DELETE' });
  assert.equal(del.status, 200);
});
