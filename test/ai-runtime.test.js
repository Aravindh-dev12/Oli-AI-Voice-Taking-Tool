import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAiRuntime } from '../server/ai/index.js';

test('AI auto mode selects native Whisper plus local chat when both are available', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-ai-runtime-'));
  const binary = path.join(dir, 'oli-whisper');
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(binary, '');
  fs.writeFileSync(model, '');

  const runtime = createAiRuntime({
    aiProvider: 'auto',
    whisperBinaryPath: binary,
    whisperModelPath: model,
    whisperLanguage: 'en',
    whisperThreads: 4,
    localChatUrl: 'http://127.0.0.1:1234/v1/chat/completions',
    localTranscriptionUrl: '',
    localChatModel: 'llama-3.2-3b',
    localTranscriptionModel: 'whisper-large-v3-turbo',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    nvidiaApiKey: '',
    nvidiaModel: 'meta/llama-3.1-8b-instruct',
    aiTimeoutMs: 5000
  });

  const status = runtime.status();
  assert.equal(status.active, 'local-native');
  assert.equal(status.ready, true);
  assert.equal(status.whisper.ready, true);
  runtime.close();
});
