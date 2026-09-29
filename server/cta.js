import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_AMOUNT_CENTS = 100_000_000;
const NONCE_TTL_MS = 15 * 60 * 1000;

function text(value, max) { return String(value ?? '').trim().slice(0, max); }
function amountCents(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_CENTS) throw new Error('amountCents must be a positive integer within the supported limit.');
  return amount;
}
function secret() {
  const value = process.env.OLI_CTA_SECRET;
  if (!value || value.length < 32) throw new Error('OLI_CTA_SECRET must be configured with at least 32 characters.');
  return value;
}
function sign(payload) {
  return createHmac('sha256', secret()).update(JSON.stringify(payload)).digest('hex');
}
function verify(payload, signature) {
  const expected = sign(payload);
  const received = Buffer.from(String(signature || ''), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

export function initCtaStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cta_actions (
      id TEXT PRIMARY KEY, meeting_id TEXT, label TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL, nonce_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'created',
      provider TEXT NOT NULL DEFAULT 'external_checkout', checkout_url TEXT, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, settled_at INTEGER, settlement_ref TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cta_actions_meeting ON cta_actions(meeting_id, created_at DESC);
  `);
}

export function createCtaAction(db, { meetingId, label, amountCents: rawAmount, currency = 'USD', provider = 'external_checkout', checkoutUrl = null }) {
  const amount = amountCents(rawAmount);
  const normalizedCurrency = text(currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error('currency must be a 3-letter ISO code.');
  const id = randomUUID();
  const nonce = randomBytes(24).toString('base64url');
  const now = Date.now();
  const payload = { actionId: id, meetingId: text(meetingId, 120) || null, amountCents: amount, currency: normalizedCurrency, nonce };
  const signature = sign(payload);
  db.prepare(`INSERT INTO cta_actions(id,meeting_id,label,amount_cents,currency,nonce_hash,status,provider,checkout_url,created_at,expires_at)
    VALUES(?,?,?,?,?,?, 'created',?,?,?,?)`).run(id, payload.meetingId, text(label || 'Secure commitment', 240), amount, normalizedCurrency, createHash('sha256').update(nonce).digest('hex'), provider, checkoutUrl ? text(checkoutUrl, 2000) : null, now, now + NONCE_TTL_MS);
  return { ...payload, label: text(label || 'Secure commitment', 240), provider, checkoutUrl: checkoutUrl ? text(checkoutUrl, 2000) : null, signature, expiresAt: now + NONCE_TTL_MS };
}

export function settleCtaAction(db, payload) {
  const action = db.prepare('SELECT * FROM cta_actions WHERE id=?').get(text(payload?.actionId, 120));
  if (!action) throw new Error('CTA action not found.');
  const nonce = text(payload?.nonce, 200);
  if (Date.now() > action.expires_at || createHash('sha256').update(nonce).digest('hex') !== action.nonce_hash) throw new Error('CTA action is invalid or expired.');
  const signed = { actionId: action.id, meetingId: action.meeting_id, amountCents: action.amount_cents, currency: action.currency, nonce };
  if (!verify(signed, payload?.signature)) throw new Error('CTA signature verification failed.');
  const settlementRef = text(payload?.settlementRef || `pending-${randomUUID()}`, 160);
  const result = db.prepare(`UPDATE cta_actions SET status='settlement_requested', settled_at=?, settlement_ref=? WHERE id=? AND status='created'`).run(Date.now(), settlementRef, action.id);
  if (!result.changes) return db.prepare('SELECT id,status,settlement_ref FROM cta_actions WHERE id=?').get(action.id);
  return { id: action.id, meetingId: action.meeting_id, status: 'settlement_requested', settlementRef, provider: action.provider, amountCents: action.amount_cents, currency: action.currency };
}

export function verifyCtaWebhook(body, signature) { return verify(body, signature); }
export { NONCE_TTL_MS };
