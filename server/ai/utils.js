export async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
    if (!response.ok) {
      const message = payload.error?.message || payload.detail || payload.error || raw || ('HTTP ' + response.status);
      throw new Error(String(message));
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonObject(text) {
  const normalized = String(text || '').trim()
    .replace(/^\x60{3}(?:json)?\s*/i, '')
    .replace(/\s*\x60{3}$/i, '');
  const value = JSON.parse(normalized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI response was not a JSON object.');
  }
  return value;
}

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function localUrlReady(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(String(url || ''));
}
