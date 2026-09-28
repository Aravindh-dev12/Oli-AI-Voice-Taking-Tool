import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findBinary() {
  const candidates = [
    path.join(process.resourcesPath, 'native', 'OliHUD'),
    path.join(process.cwd(), 'native', 'macos', '.build', 'release', 'OliHUD')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function createNativeHudManager({ onEvent = () => {}, onError = () => {} }) {
  let child = null;
  let buffer = '';

  function emitError(message) {
    try { onError(String(message)); } catch {}
  }

  function send(payload) {
    if (!child?.stdin?.writable) return false;
    try {
      child.stdin.write(JSON.stringify(payload) + '
');
      return true;
    } catch {
      return false;
    }
  }

  function handleLine(line) {
    const clean = line.trim();
    if (!clean) return;
    try {
      const payload = JSON.parse(clean);
      onEvent(payload);
    } catch {
      emitError('Native HUD emitted invalid IPC data.');
    }
  }

  function start() {
    if (process.platform !== 'darwin') return { active: false, reason: 'unsupported-platform' };
    if (child) return { active: true, alreadyRunning: true };

    const binary = findBinary();
    if (!binary) return { active: false, reason: 'native-hud-not-built' };

    child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('
');
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) emitError(message);
    });
    child.on('error', (error) => {
      emitError('Native HUD process error: ' + error.message);
      child = null;
    });
    child.on('close', () => {
      child = null;
      buffer = '';
    });

    return { active: true, mode: 'swiftui-appkit' };
  }

  async function stop() {
    if (!child) return;
    const current = child;
    try { current.stdin.write(JSON.stringify({ type: 'command', command: 'quit' }) + '
'); } catch {}
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { current.kill('SIGTERM'); } catch {}
        resolve();
      }, 1500);
      current.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    child = null;
  }

  return {
    start,
    stop,
    send,
    available: () => process.platform === 'darwin' && Boolean(findBinary()),
    active: () => Boolean(child)
  };
}
