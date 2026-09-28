import { fetchJson, normalizeText } from './utils.js';

function createClient({ apiKey, model, timeoutMs }) {
  const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
  return {
    ready: Boolean(apiKey),
    async chat(system, user) {
      if (!apiKey) throw new Error('NVIDIA API key is not configured.');
      const data = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 80,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      }, timeoutMs);
      return normalizeText(data.choices?.[0]?.message?.content);
    }
  };
}

export { createClient as createNvidiaProvider };
