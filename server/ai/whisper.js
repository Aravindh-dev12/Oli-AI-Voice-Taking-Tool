import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

function defaultBinaryCandidates() {
  return [
    process.env.OLI_WHISPER_BINARY_PATH,
    process.env.OLI_WHISPER_BIN,
    process.resourcesPath ? path.join(process.resourcesPath, 'native', 'oli-whisper') : null,
    path.join(process.cwd(), 'native', 'rust', 'whisper-core', 'target', 'release', process.platform === 'win32' ? 'oli-whisper.exe' : 'oli-whisper')
  ].filter(Boolean);
}

function createNativeWhisperProvider({
  binaryPath,
  modelPath,
  language = 'en',
  threads = Math.min(4, os.cpus().length || 4),
  startupTimeoutMs = 15000,
  maxQueue = 4
}) {
  const binary = binaryPath || defaultBinaryCandidates().find((candidate) => fs.existsSync(candidate));
  const ready = Boolean(binary && modelPath && fs.existsSync(binary) && fs.existsSync(modelPath));

  let child = null;
  let reader = null;
  let stdoutBuffer = '';
  let starting = null;
  let sequence = 0;
  const queue = [];

  function rejectQueue(error) {
    while (queue.length) queue.shift().reject(error);
  }

  function stopProcess() {
    if (!child) return;
    const current = child;
    child = null;
    try { current.stdin.end(); } catch {}
    try { current.kill('SIGTERM'); } catch {}
    reader?.close();
    reader = null;
    stdoutBuffer = '';
  }

  function startProcess() {
    if (child) return Promise.resolve();
    if (starting) return starting;
    if (!ready) return Promise.reject(new Error(
      'Local Whisper is not configured. Set OLI_WHISPER_MODEL_PATH and build/provide oli-whisper.'
    ));

    starting = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stopProcess();
        starting = null;
        reject(new Error('Local Whisper process startup timed out.'));
      }, startupTimeoutMs);

      child = spawn(binary, [
        '--model', modelPath,
        '--language', language || '',
        '--threads', String(Math.max(1, Math.min(64, Number(threads) || 4))),
        '--stdio'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const failStartup = (error) => {
        clearTimeout(timer);
        starting = null;
        stopProcess();
        reject(error);
      };

      child.on('error', failStartup);

      child.on('close', (code) => {
        if (starting) {
          failStartup(new Error('Local Whisper exited during startup (code ' + code + ').'));
          return;
        }
        child = null;
        reader?.close();
        reader = null;
        stdoutBuffer = '';
        if (queue.length) rejectQueue(new Error('Local Whisper exited (code ' + code + ').'));
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', () => {});

      child.stdout.setEncoding('utf8');
      reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      reader.on('line', (line) => {
        const clean = line.trim();
        if (!clean) return;

        let response;
        try {
          response = JSON.parse(clean);
        } catch {
          if (starting) return failStartup(new Error('Local Whisper emitted invalid startup JSON.'));
          if (queue.length) queue[0].reject(new Error('Local Whisper returned invalid JSON.'));
          return;
        }

        if (response.ready === true) {
          if (starting) {
            clearTimeout(timer);
            starting = null;
            resolve();
          }
          return;
        }

        const pending = queue.shift();
        if (!pending) return;
        if (response.ok === false) pending.reject(new Error(String(response.error || 'Local Whisper failed.')));
        else pending.resolve(response);
      });
    });

    return starting;
  }

  async function transcribe(wav) {
    if (!ready) throw new Error(
      'Local Whisper is not configured. Set OLI_WHISPER_MODEL_PATH to a local quantized Whisper model.'
    );
    if (queue.length >= maxQueue) throw new Error('Local Whisper queue is full.');

    await startProcess();

    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      sequence += 1;
      try {
        child.stdin.write(JSON.stringify({
          id: sequence,
          audio_base64: Buffer.from(wav).toString('base64'),
          language: language || null,
          threads: Number(threads) || 4
        }) + '\n');
      } catch (error) {
        queue.pop();
        reject(error);
      }
    });
  }

  return {
    ready,
    async transcribe(wav) {
      const result = await transcribe(wav);
      return String(result.text || '').replace(/\s+/g, ' ').trim();
    },
    close() {
      stopProcess();
      rejectQueue(new Error('Local Whisper provider closed.'));
    },
    describe() {
      return {
        ready,
        binaryPath: binary || '',
        modelPath: modelPath || '',
        language: language || null,
        threads: Number(threads) || 4
      };
    }
  };
}

export { createNativeWhisperProvider };
