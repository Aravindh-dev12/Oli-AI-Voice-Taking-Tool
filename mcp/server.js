import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { openDb } from '../server/db.js';
import { searchKnowledge, searchTranscript, getMeetingContext } from '../server/rag.js';
import { listAgents, runAgent, listInbox, listApprovals, resolveApproval, listSchedules, searchBrain, listBrainMemories } from '../server/agents.js';

const PROTOCOL_VERSION = '2026-07-28';
const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');
const dbPath = dbFlag >= 0 && args[dbFlag + 1]
  ? path.resolve(args[dbFlag + 1])
  : path.resolve(process.env.OLI_DB_PATH || 'data/oli.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

const tools = [
  {
    name: 'oli_list_meetings',
    description: 'List recent Oli meetings stored in the local database.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }
  },
  {
    name: 'oli_get_meeting',
    description: 'Get one meeting with transcript and action items.',
    inputSchema: { type: 'object', required: ['meetingId'], properties: { meetingId: { type: 'string' } } }
  },
  {
    name: 'oli_search_knowledge',
    description: 'Search local battlecards, pricing sheets and other trusted knowledge-base entries.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }
    }
  },
  {
    name: 'oli_search_transcript',
    description: 'Search transcript text stored locally.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
    }
  },
  {
    name: 'oli_get_meddpicc',
    description: 'Get persisted MEDDPICC fields for one meeting. Fields are evidence extracted from the local meeting transcript; empty fields mean no evidence was stored.',
    inputSchema: { type: 'object', required: ['meetingId'], properties: { meetingId: { type: 'string' } } }
  },
  {
    name: 'oli_list_commitments',
    description: 'List action items/commitments, optionally scoped to a meeting.',
    inputSchema: {
      type: 'object',
      properties: {
        meetingId: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      }
    }
  }
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function jsonText(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError };
}

function handleTool(name, input = {}) {
  switch (name) {
    case 'oli_list_meetings':
      return db.prepare(
        'SELECT id, title, started_at, ended_at, summary FROM meetings ORDER BY started_at DESC LIMIT ?'
      ).all(Math.min(Math.max(Number(input.limit) || 20, 1), 100));

    case 'oli_get_meeting': {
      const context = getMeetingContext(db, String(input.meetingId || ''));
      if (!context) throw new Error('Meeting not found.');
      return context;
    }

    case 'oli_search_knowledge':
      return searchKnowledge(db, input.query, input.limit);

    case 'oli_search_transcript':
      return searchTranscript(db, input.query, input.limit);

    case 'oli_get_meddpicc': {
      const context = getMeetingContext(db, String(input.meetingId || ''));
      if (!context) throw new Error('Meeting not found.');
      return context.meddpicc || { meetingId: input.meetingId, empty: true };
    }

    case 'oli_list_agents':
      return listAgents(db);

    case 'oli_run_agent':
      return runAgent({
        db,
        ai: globalThis.__oliAiRuntime,
        cfg: globalThis.__oliAgentConfig || { aiTimeoutMs: 15000, obsidianVaultPath: '', crmWebhookUrl: '', crmWebhookToken: '' },
        agentId: String(input.agentId || ''),
        request: String(input.request || ''),
        meetingId: input.meetingId ? String(input.meetingId) : null
      });

    case 'oli_search_brain':
      return searchBrain(db, input.query, input.limit);

    case 'oli_list_inbox':
      return listInbox(db, { status: String(input.status || ''), limit: input.limit });

    case 'oli_list_approvals':
      return listApprovals(db, String(input.status || 'pending'), input.limit);

    case 'oli_resolve_approval':
      return resolveApproval({
        db,
        cfg: globalThis.__oliAgentConfig || { aiTimeoutMs: 15000, obsidianVaultPath: '', crmWebhookUrl: '', crmWebhookToken: '' },
        approvalId: String(input.approvalId || ''),
        decision: String(input.decision || '')
      });

    case 'oli_list_schedules':
      return listSchedules(db);

    case 'oli_list_commitments': {
      const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
      const params = [];
      let sql = 'SELECT id, meeting_id, task, assignee, status FROM actions WHERE 1=1';
      if (input.meetingId) { sql += ' AND meeting_id=?'; params.push(String(input.meetingId)); }
      if (input.status) { sql += ' AND status=?'; params.push(String(input.status)); }
      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);
      return db.prepare(sql).all(...params);
    }

    default:
      throw new Error('Unknown tool: ' + name);
  }
}

function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  switch (message.method) {
    case 'initialize':
      return reply(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'oli-local-mcp', version: '1.0.0' }
      });
    case 'notifications/initialized':
      return;
    case 'ping':
      return message.id != null ? reply(message.id, {}) : undefined;
    case 'tools/list':
      return reply(message.id, { tools });
    case 'tools/call':
      try {
        return reply(message.id, jsonText(handleTool(String(message.params?.name || ''), message.params?.arguments || {})));
      } catch (error) {
        return reply(message.id, jsonText({ error: error.message }, true));
      }
    default:
      if (message.id != null) {
        return reply(message.id, { error: { code: -32601, message: 'Method not found: ' + message.method } });
      }
  }
}

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on('line', (line) => {
  const clean = line.trim();
  if (!clean) return;
  try {
    handleMessage(JSON.parse(clean));
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
  }
});

function shutdown() {
  input.close();
  db.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
