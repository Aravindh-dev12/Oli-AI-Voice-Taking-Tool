import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.js';

test('server exposes health and local CRUD without external AI', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-server-'));
  const instance = createServer({ dbPath: path.join(dir, 'oli.db'), configPath: path.join(dir, 'config.json') });
  const http = await new Promise((resolve) => {
    const server = instance.app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => {
    instance.close();
    http.close();
  });
  const base = 'http://127.0.0.1:' + http.address().port;

  const health = await fetch(base + '/api/health').then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.aiReady, false);

  const meeting = await fetch(base + '/api/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Smoke meeting' })
  });
  assert.equal(meeting.status, 503);

  const kb = await fetch(base + '/api/kb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test', content: 'SOC2 and pricing facts' })
  });
  assert.equal(kb.status, 201);

  const search = await fetch(base + '/api/kb/search?q=SOC2').then((r) => r.json());
  assert.equal(search.length, 1);
});
