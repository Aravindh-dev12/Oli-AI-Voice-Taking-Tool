import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findBinary(name) {
  const candidates = [
    path.join(process.resourcesPath, 'native', name),
    path.join(process.cwd(), 'native', 'macos', '.build', 'release', name)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function createNativeCaptureManager({ port, onError = () => {} }) {
  let child = null;
  let buffer = '';
  let stopping = false;
  let pendingPosts = new Set();

  const emitError = (message) => {
    try { onError(String(message)); } catch {}
  };

  async function postChunk(meetingId, event) {
    if (!meetingId || !event?.wav || !event.source || event.seq == null) return;
    try {
      const response = await fetch(
        'http://127.0.0.1:' + port +
        '/api/meetings/' + encodeURIComponent(meetingId) +
        '/chunk?src=' + encodeURIComponent(event.source === 'me' ? 'me' : 'them') +
        '&seq=' + encodeURIComponent(event.seq),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/wav',
            'X-Oli-Native-Capture': '1'
          },
          body: Buffer.from(event.wav, 'base64')
        }
      );
      if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || 'Native audio ingest failed (' + response.status + ')');
      }
    } catch (error) {
      emitError('Native audio ingest failed: ' + error.message);
    }
  }

  function handleLine(meetingId, line) {
    const clean = line.trim();
    if (!clean) return null;
    let event;
    try {
      event = JSON.parse(clean);
    } catch {
      emitError('Native capture emitted invalid IPC data.');
      return null;
    }

    if (event.type === 'audio') {
      const pending = postChunk(meetingId, event);
      pendingPosts.add(pending);
      pending.finally(() => pendingPosts.delete(pending));
      return null;
    }
    if (event.type === 'error') {
      emitError(event.message || 'Native capture failed.');
      return 'error';
    }
    if (event.type === 'ready') return 'ready';
    if (event.type === 'stopped') return 'stopped';
    return null;
  }

  async function start(meetingId) {
    if (process.platform !== 'darwin') return { active: false, reason: 'unsupported-platform' };
    if (child) return { active: true, alreadyRunning: true };

    const binary = findBinary('OliCaptureService');
    if (!binary) return { active: false, reason: 'native-service-not-built' };

    stopping = false;
    buffer = '';

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { child?.kill('SIGTERM'); } catch {}
          child = null;
          reject(new Error('Native capture did not become ready within 8 seconds.'));
        }
      }, 8000);

      child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const result = handleLine(meetingId, line);
          if (result === 'ready' && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ active: true, mode: 'screencapturekit' });
          }
          if (result === 'error' && !settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error('Native capture service reported an error.'));
          }
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const message = String(chunk).trim();
        if (message) emitError(message);
      });

      child.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        } else {
          emitError('Native capture process error: ' + error.message);
        }
        child = null;
      });

      child.on('close', (code) => {
        child = null;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Native capture exited before ready (code ' + code + ').'));
        } else if (!stopping && code !== 0) {
          emitError('Native capture stopped unexpectedly (code ' + code + ').');
        }
      });
    });
  }

  async function stop() {
    if (!child) return;
    stopping = true;
    const current = child;
    try { current.stdin.write('stop\n'); } catch {}
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { current.kill('SIGTERM'); } catch {}
        resolve();
      }, 3000);
      current.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    child = null;
    await Promise.allSettled([...pendingPosts]);
  }

  return {
    start,
    stop,
    active: () => Boolean(child),
    available: () => process.platform === 'darwin' && Boolean(findBinary('OliCaptureService'))
  };
}
