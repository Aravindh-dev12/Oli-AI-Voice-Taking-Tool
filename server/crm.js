function safeWebhookUrl(value) {
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('CRM webhook must use HTTP or HTTPS.');
  return url.toString();
}

export async function syncMeetingToCrm({ meeting, meddpicc, actions, webhookUrl, token = '', timeoutMs = 10000 }) {
  if (!webhookUrl) return { synced: false, reason: 'not-configured' };
  const url = safeWebhookUrl(webhookUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'oli',
        version: '1.4.0',
        event: 'meeting.completed',
        meeting,
        meddpicc: meddpicc || null,
        commitments: actions || []
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error('CRM webhook returned HTTP ' + response.status + (body ? ': ' + body.slice(0, 200) : ''));
    }
    return { synced: true };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('CRM webhook timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
