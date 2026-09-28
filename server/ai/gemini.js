import { fetchJson, normalizeText, parseJsonObject } from './utils.js';

function createClient({ apiKey, model, timeoutMs }) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const call = (parts, json = false) => fetchJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, ...(json ? { responseMimeType: 'application/json' } : {}) }
    })
  }, timeoutMs);

  return {
    ready: Boolean(apiKey),
    async transcribe(wav) {
      if (!apiKey) throw new Error('Gemini API key is not configured.');
      const data = await call([
        { text: 'Transcribe this audio verbatim. Output only the spoken words. If there is no clear speech, output nothing.' },
        { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } }
      ]);
      return normalizeText((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    },
    async chat(system, user) {
      if (!apiKey) throw new Error('Gemini API key is not configured.');
      const data = await call([{ text: system + '\n\n' + user }]);
      return normalizeText((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    },
    async summarize(segments) {
      const data = await call([{
        text: 'Summarize this meeting. Return JSON only: {"summary": string (max 120 words), "action_items": [{"task": string, "assignee": string}]}.\
\
' + segments.map((s) => s.speaker + ': ' + s.text).join('\n')
      }], true);
      return parseJsonObject((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    }
  };
}

export { createClient as createGeminiProvider };
