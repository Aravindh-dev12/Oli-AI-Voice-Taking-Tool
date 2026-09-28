import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../renderer/audio-capture.js';
import { parseCaptureSequence, parseCaptureSource, validateWavPayload } from '../server/audio.js';

test('encodeWav emits canonical PCM WAV', () => {
  const buffer = Buffer.from(encodeWav(new Float32Array([0, 0.5, -0.5]), 16000));
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buffer.readUInt16LE(22), 1);
  assert.equal(buffer.readUInt32LE(24), 16000);
  assert.equal(buffer.readUInt16LE(34), 16);
  assert.equal(validateWavPayload(buffer), buffer);
});

test('capture inputs reject ambiguous sources and sequences', () => {
  assert.equal(parseCaptureSource('me'), 'me');
  assert.equal(parseCaptureSource('them'), 'them');
  assert.throws(() => parseCaptureSource('other'));
  assert.equal(parseCaptureSequence('4'), 4);
  assert.throws(() => parseCaptureSequence('-1'));
  assert.throws(() => parseCaptureSequence('abc'));
});
