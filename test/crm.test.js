import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { syncMeetingToCrm } from '../server/crm.js';

test('CRM webhook receives structured completed meeting payload', async (t) => {
  let body = null;
  let auth = null;
  const webhook = createServer((req, res) => {
    auth = req.headers.authorization;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => webhook.listen(0, '127.0.0.1', resolve));
  t.after(() => webhook.close());

  const port = webhook.address().port;
  const result = await syncMeetingToCrm({
    webhookUrl: 'http://127.0.0.1:' + port + '/hook',
    token: 'secret-token',
    timeoutMs: 3000,
    meeting: { id: 'm1', title: 'Test meeting' },
    meddpicc: { champion: 'Alex' },
    actions: [{ task: 'Send report', assignee: 'You', status: 'pending' }]
  });

  assert.equal(result.synced, true);
  assert.equal(auth, 'Bearer secret-token');
  assert.equal(body.source, 'oli');
  assert.equal(body.event, 'meeting.completed');
  assert.equal(body.meddpicc.champion, 'Alex');
  assert.equal(body.commitments[0].task, 'Send report');
});
