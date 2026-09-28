import { createGeminiProvider } from './gemini.js';
import { createLocalProvider } from './local.js';
import { createNvidiaProvider } from './nvidia.js';

export function createAiRuntime(cfg) {
  const providers = {
    local: createLocalProvider({
      chatUrl: cfg.localChatUrl,
      transcriptionUrl: cfg.localTranscriptionUrl,
      chatModel: cfg.localChatModel,
      transcriptionModel: cfg.localTranscriptionModel,
      timeoutMs: cfg.aiTimeoutMs
    }),
    gemini: createGeminiProvider({
      apiKey: cfg.geminiApiKey,
      model: cfg.geminiModel,
      timeoutMs: cfg.aiTimeoutMs
    }),
    nvidia: createNvidiaProvider({
      apiKey: cfg.nvidiaApiKey,
      model: cfg.nvidiaModel,
      timeoutMs: cfg.aiTimeoutMs
    })
  };

  const requested = cfg.aiProvider || 'auto';
  const preferred = requested === 'auto' ? ['local', 'gemini'] : [requested];

  let active = null;
  for (const name of preferred) {
    if (providers[name]?.ready) {
      active = name;
      break;
    }
  }

  const transcriber =
    active === 'local' && providers.local.transcriptionReady ? providers.local :
    active === 'gemini' && providers.gemini.ready ? providers.gemini :
    providers.gemini.ready ? providers.gemini :
    active === 'local' && providers.local.transcriptionReady ? providers.local :
    null;

  const copilot =
    active === 'local' && providers.local.chatReady ? providers.local :
    active === 'nvidia' && providers.nvidia.ready ? providers.nvidia :
    providers.gemini.ready ? providers.gemini :
    null;

  const summarizer =
    active === 'local' && providers.local.chatReady ? providers.local :
    providers.gemini.ready ? providers.gemini :
    null;

  return {
    status() {
      return {
        requested,
        active,
        ready: Boolean(transcriber && copilot && summarizer),
        local: {
          chat: providers.local.chatReady,
          transcription: providers.local.transcriptionReady
        },
        gemini: providers.gemini.ready,
        nvidia: providers.nvidia.ready
      };
    },
    async transcribe(wav) {
      if (!transcriber) throw new Error('No transcription engine is configured.');
      return transcriber.transcribe(wav);
    },
    async copilot(system, user) {
      if (!copilot) throw new Error('No copilot engine is configured.');
      return copilot.chat(system, user);
    },
    async summarize(segments) {
      if (!summarizer) throw new Error('No summary engine is configured.');
      return summarizer.summarize(segments);
    }
  };
}
