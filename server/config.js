import fs from 'fs';
import path from 'path';

function defaults() {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
    nvidiaModel: process.env.NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct'
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
    nvidiaModel: String(cfg.nvidiaModel || 'meta/llama-3.1-8b-instruct')
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
    nvidiaSet: !!cfg.nvidiaApiKey
  };
}
