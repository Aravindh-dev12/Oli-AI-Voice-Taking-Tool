import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createCtaAction, initCtaStore, settleCtaAction, verifyCtaWebhook } from '../server/cta.js';

process.env.OLI_CTA_SECRET = 'test-secret-that-is-at-least-32-characters-long';

test('creates and settles a signed CTA exactly once', () => {
  const db = new Database(':memory:');
  initCtaStore(db);
  const action = createCtaAction(db, { meetingId: 'meeting-1', label: 'Pilot deposit', amountCents: 500000, currency: 'usd' });
  assert.equal(action.amountCents, 500000);
  const settled = settleCtaAction(db, { actionId: action.actionId, nonce: action.nonce, signature: action.signature, settlementRef: 'provider-event-1' });
  assert.equal(settled.status, 'settlement_requested');
  assert.equal(settleCtaAction(db, { actionId: action.actionId, nonce: action.nonce, signature: action.signature }).status, 'settlement_requested');
  assert.throws(() => settleCtaAction(db, { actionId: action.actionId, nonce: 'wrong', signature: action.signature }));
  db.close();
});

test('rejects forged webhook signatures', () => {
  assert.equal(verifyCtaWebhook({ event: 'settled' }, '00'), false);
});

test('rejects unsafe amounts and missing secret', () => {
  const db = new Database(':memory:');
  initCtaStore(db);
  assert.throws(() => createCtaAction(db, { amountCents: 0 }));
  const previous = process.env.OLI_CTA_SECRET;
  delete process.env.OLI_CTA_SECRET;
  assert.throws(() => createCtaAction(db, { amountCents: 100 }));
  process.env.OLI_CTA_SECRET = previous;
  db.close();
});
