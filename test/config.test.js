import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, redact } from '../server/config.js';

test('config persists bounded runtime settings and redacts secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-config-'));
  const file = path.join(dir, 'config.json');
  const saved = saveConfig(file, {
    geminiApiKey: 'secret-gemini',
    nvidiaApiKey: 'secret-nvidia',
    aiProvider: 'local',
    localChatUrl: 'http://127.0.0.1:1234/v1/chat/completions',
    localTranscriptionUrl: 'http://localhost:8000/v1/audio/transcriptions',
    aiTimeoutMs: 999999,
    retentionDays: -10
  });
  assert.equal(saved.aiTimeoutMs, 120000);
  assert.equal(saved.retentionDays, 0);
  const loaded = loadConfig(file);
  assert.equal(loaded.aiProvider, 'local');
  const publicConfig = redact(loaded);
  assert.equal(publicConfig.geminiSet, true);
  assert.equal(publicConfig.nvidiaSet, true);
  assert.equal(publicConfig.geminiApiKey.endsWith('hash'), false);
  assert.match(publicConfig.geminiApiKey, /••••/);
  assert.match(publicConfig.nvidiaApiKey, /••••/);
});
