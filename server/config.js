import fs from 'fs';
import path from 'path';

function defaults() {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    nvidiaModel: process.env.NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct',
    aiProvider: process.env.OLI_AI_PROVIDER || 'auto',
    localChatUrl: process.env.OLI_LOCAL_CHAT_URL || '',
    localTranscriptionUrl: process.env.OLI_LOCAL_TRANSCRIPTION_URL || '',
    localChatModel: process.env.OLI_LOCAL_CHAT_MODEL || 'llama-3.2-3b',
    localTranscriptionModel: process.env.OLI_LOCAL_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo',
    aiTimeoutMs: Number(process.env.OLI_AI_TIMEOUT_MS || 15000)
  };
}

export function loadConfig(configPath) {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...defaults(), ...saved };
  } catch {
    return defaults();
  }
}

export function saveConfig(configPath, cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const clean = {
    geminiApiKey: String(cfg.geminiApiKey || ''),
    geminiModel: String(cfg.geminiModel || 'gemini-2.5-flash'),
    nvidiaApiKey: String(cfg.nvidiaApiKey || ''),
    nvidiaModel: String(cfg.nvidiaModel || 'meta/llama-3.1-8b-instruct'),
    aiProvider: ['auto', 'local', 'gemini', 'nvidia'].includes(cfg.aiProvider) ? cfg.aiProvider : 'auto',
    localChatUrl: String(cfg.localChatUrl || ''),
    localTranscriptionUrl: String(cfg.localTranscriptionUrl || ''),
    localChatModel: String(cfg.localChatModel || 'llama-3.2-3b'),
    localTranscriptionModel: String(cfg.localTranscriptionModel || 'whisper-large-v3-turbo'),
    aiTimeoutMs: Math.min(Math.max(Number(cfg.aiTimeoutMs) || 15000, 1000), 120000)
  };
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return clean;
}

// Never send raw keys back to the renderer — only whether they're set.
export function redact(cfg) {
  return {
    geminiApiKey: cfg.geminiApiKey ? '••••••••' + cfg.geminiApiKey.slice(-4) : '',
    geminiModel: cfg.geminiModel,
    nvidiaApiKey: cfg.nvidiaApiKey ? '••••••••' + cfg.nvidiaApiKey.slice(-4) : '',
    nvidiaModel: cfg.nvidiaModel,
    geminiSet: !!cfg.geminiApiKey,
    nvidiaSet: !!cfg.nvidiaApiKey,
    aiProvider: cfg.aiProvider,
    localChatUrl: cfg.localChatUrl,
    localTranscriptionUrl: cfg.localTranscriptionUrl,
    localChatModel: cfg.localChatModel,
    localTranscriptionModel: cfg.localTranscriptionModel,
    aiTimeoutMs: cfg.aiTimeoutMs
  };
}
