import { fetchJson, localUrlReady, normalizeText, parseJsonObject } from './utils.js';

function createClient({ chatUrl, transcriptionUrl, chatModel, transcriptionModel, timeoutMs }) {
  const chatReady = localUrlReady(chatUrl);
  const transcriptionReady = localUrlReady(transcriptionUrl);
  return {
    ready: chatReady && transcriptionReady,
    chatReady,
    transcriptionReady,
    async transcribe(wav) {
      if (!transcriptionReady) throw new Error('Local transcription endpoint is not configured.');
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'oli-chunk.wav');
      form.append('model', transcriptionModel);
      const data = await fetchJson(transcriptionUrl, { method: 'POST', body: form }, timeoutMs);
      return normalizeText(data.text || data.output || data.transcript);
    },
    async chat(system, user) {
      if (!chatReady) throw new Error('Local chat endpoint is not configured.');
      const data = await fetchJson(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          temperature: 0.1,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      }, timeoutMs);
      return normalizeText(data.choices?.[0]?.message?.content || data.output || data.response);
    },
    async summarize(segments) {
      const raw = await this.chat(
        'Return only valid JSON. Schema: {"summary": string, "action_items": [{"task": string, "assignee": string}], "meddpicc": {"metrics": string, "economic_buyer": string, "decision_criteria": string, "decision_process": string, "paper_process": string, "identify_pain": string, "champion": string, "competition": string}}. Leave unsupported fields empty and never invent facts.',
        segments.map((s) => s.speaker + ': ' + s.text).join('\n')
      );
      return parseJsonObject(raw);
    }
  };
}

export { createClient as createLocalProvider };
