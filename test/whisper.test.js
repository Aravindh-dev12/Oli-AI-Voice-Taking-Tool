import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeWhisperProvider } from '../server/ai/whisper.js';

test('native Whisper provider stays unready without a local model', async () => {
  const provider = createNativeWhisperProvider({
    binaryPath: '/definitely/missing/oli-whisper',
    modelPath: '/definitely/missing/model.bin',
    language: 'en',
    threads: 4
  });

  assert.equal(provider.ready, false);
  assert.equal(provider.describe().ready, false);
  await assert.rejects(
    provider.transcribe(Buffer.from('RIFF')),
    /Local Whisper is not configured/
  );
  provider.close();
});
