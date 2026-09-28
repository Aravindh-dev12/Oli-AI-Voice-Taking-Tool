const MAX_WAV_BYTES = 12 * 1024 * 1024;
const ALLOWED_SOURCES = new Set(['me', 'them']);

export function parseCaptureSource(value) {
  if (!ALLOWED_SOURCES.has(String(value))) {
    throw new Error('Invalid capture source; expected "me" or "them".');
  }
  return String(value);
}

export function parseCaptureSequence(value) {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 10_000_000) {
    throw new Error('Invalid capture sequence.');
  }
  return sequence;
}

export function validateWavPayload(body) {
  if (!Buffer.isBuffer(body)) throw new Error('Audio payload must be a binary WAV body.');
  if (body.length < 44) throw new Error('Audio payload is too small.');
  if (body.length > MAX_WAV_BYTES) throw new Error('Audio payload is too large.');

  if (body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported audio format; expected RIFF/WAVE.');
  }

  const audioFormat = body.readUInt16LE(20);
  const channels = body.readUInt16LE(22);
  const sampleRate = body.readUInt32LE(24);
  const bitsPerSample = body.readUInt16LE(34);

  if (audioFormat !== 1 || channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 16) {
    throw new Error('Audio must be PCM, mono, 16 kHz, 16-bit.');
  }

  return body;
}
