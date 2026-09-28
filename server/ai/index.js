import { createGeminiProvider } from './gemini.js';
import { createLocalProvider } from './local.js';
import { createNvidiaProvider } from './nvidia.js';
import { createNativeWhisperProvider } from './whisper.js';

export function createAiRuntime(cfg) {
  const providers = {
    whisper: createNativeWhisperProvider({
      binaryPath: cfg.whisperBinaryPath,
      modelPath: cfg.whisperModelPath,
      language: cfg.whisperLanguage,
      threads: cfg.whisperThreads,
      timeoutMs: cfg.aiTimeoutMs
    }),
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
  const localComplete = providers.whisper.ready && providers.local.chatReady;
  const localHttpComplete = providers.local.ready;
  const geminiComplete = providers.gemini.ready;

  let active = null;
  if (requested === 'auto') {
    if (localComplete) active = 'local-native';
    else if (localHttpComplete) active = 'local-http';
    else if (geminiComplete) active = 'gemini';
  } else if (requested === 'local') {
    if (localComplete) active = 'local-native';
    else if (localHttpComplete) active = 'local-http';
  } else if (requested === 'gemini' && geminiComplete) {
    active = 'gemini';
  } else if (requested === 'nvidia' && providers.nvidia.ready) {
    active = 'nvidia';
  }

  const transcriber =
    (active === 'local-native' && providers.whisper.ready) ? providers.whisper :
    (active === 'local-http' && providers.local.transcriptionReady) ? providers.local :
    (active === 'gemini' && providers.gemini.ready) ? providers.gemini :
    (providers.whisper.ready && requested !== 'nvidia') ? providers.whisper :
    (providers.local.transcriptionReady && requested !== 'nvidia') ? providers.local :
    providers.gemini.ready ? providers.gemini :
    null;

  const copilot =
    (active === 'local-native' || active === 'local-http') && providers.local.chatReady ? providers.local :
    (active === 'nvidia' && providers.nvidia.ready) ? providers.nvidia :
    providers.gemini.ready ? providers.gemini :
    null;

  const summarizer =
    (active === 'local-native' || active === 'local-http') && providers.local.chatReady ? providers.local :
    providers.gemini.ready ? providers.gemini :
    null;

  return {
    status() {
      return {
        requested,
        active,
        ready: Boolean(transcriber && copilot && summarizer),
        whisper: providers.whisper.describe(),
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
    },
    close() {
      providers.whisper.close();
    }
  };
}
