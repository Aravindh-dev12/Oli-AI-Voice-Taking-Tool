import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('MCP server responds to initialize and tools/list over stdio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-mcp-'));
  const db = path.join(dir, 'oli.db');
  const child = spawn(process.execPath, ['mcp/server.js', '--db', db], { stdio: ['pipe', 'pipe', 'pipe'] });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) responses.push(JSON.parse(line));
  });

  const waitForId = (id) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP response timeout')), 3000);
    const check = () => {
      const value = responses.find((item) => item.id === id);
      if (value) { clearTimeout(timer); resolve(value); } else setTimeout(check, 20);
    };
    check();
  });

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
  const init = await waitForId(1);
  assert.equal(init.result.serverInfo.name, 'oli-local-mcp');

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitForId(2);
  assert.ok(listed.result.tools.some((tool) => tool.name === 'oli_search_knowledge'));

  child.kill('SIGTERM');
});
