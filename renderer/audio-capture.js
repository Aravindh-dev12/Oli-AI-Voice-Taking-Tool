const DEFAULTS = {
  sampleRate: 16000,
  chunkSeconds: 6,
  silenceRms: 0.008,
  maxPendingUploads: 2
};

function encodeWav(float32, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + float32.length * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, float32.length * 2, true);
  float32.forEach((sample, i) => {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  });
  return buffer;
}

function rms(float32) {
  if (!float32.length) return 0;
  let total = 0;
  for (const sample of float32) total += sample * sample;
  return Math.sqrt(total / float32.length);
}

export function createTrackCapture({
  stream,
  source,
  meetingId,
  onStatus = () => {},
  options = {}
}) {
  const cfg = { ...DEFAULTS, ...options };
  const context = new AudioContext({ sampleRate: cfg.sampleRate, latencyHint: 'interactive' });
  const processor = context.createScriptProcessor(4096, 1, 1);
  const input = context.createMediaStreamSource(stream);
  const mute = context.createGain();
  mute.gain.value = 0;

  let buffer = [];
  let sampleCount = 0;
  let sequence = 0;
  let stopped = false;
  let pending = 0;
  const requests = new Set();

  const enqueue = (pcm) => {
    if (stopped || pending >= cfg.maxPendingUploads) {
      onStatus('Audio upload queue is full; dropped one chunk to protect the meeting session.');
      return;
    }
    if (rms(pcm) < cfg.silenceRms) return;

    const id = sequence++;
    const controller = new AbortController();
    const request = fetch(
      '/api/meetings/' + encodeURIComponent(meetingId) +
      '/chunk?src=' + encodeURIComponent(source) +
      '&seq=' + id,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Oli-Capture-Version': '1'
        },
        body: encodeWav(pcm, cfg.sampleRate),
        signal: controller.signal
      }
    )
      .catch((error) => {
        if (error.name !== 'AbortError') onStatus('Audio chunk upload failed; Oli will continue with the next chunk.');
      })
      .finally(() => {
        pending -= 1;
        requests.delete(request);
      });

    pending += 1;
    requests.add(request);
  };

  const flush = () => {
    if (!sampleCount) return;
    const pcm = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of buffer) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    buffer = [];
    sampleCount = 0;
    enqueue(pcm);
  };

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const data = new Float32Array(event.inputBuffer.getChannelData(0));
    buffer.push(data);
    sampleCount += data.length;
    if (sampleCount >= cfg.sampleRate * cfg.chunkSeconds) flush();
  };

  input.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  return async () => {
    if (stopped) return;
    stopped = true;
    flush();
    processor.onaudioprocess = null;
    try { processor.disconnect(); } catch {}
    try { mute.disconnect(); } catch {}
    try { input.disconnect(); } catch {}
    await Promise.allSettled([...requests]);
    await context.close().catch(() => {});
    stream.getTracks().forEach((track) => track.stop());
  };
}

export { encodeWav };
