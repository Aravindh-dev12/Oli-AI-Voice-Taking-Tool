import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { openDb } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { createAiRuntime } from '../server/ai/index.js';
import { searchKnowledge, searchTranscript, getMeetingContext } from '../server/rag.js';
import { initAgentStore, listAgents, runAgent, listInbox, listApprovals, resolveApproval, listSchedules, searchBrain, createSchedule } from '../server/agents.js';
import { initSkillsStore, listSkills, getSkill } from '../server/skills.js';
import { initSourceRegistry, listRegisteredSources, syncRegisteredSource } from '../server/knowledge.js';
import { initOrchestrationStore, listFamilies, listJobs, getJob, retryJob, cancelJob, createHandoff, listHandoffs, createBatch, getBatch } from '../server/orchestration.js';

const PROTOCOL_VERSION = '2026-07-28';
const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');
const configFlag = args.indexOf('--config');
const dbPath = dbFlag >= 0 && args[dbFlag + 1]
  ? path.resolve(args[dbFlag + 1])
  : path.resolve(process.env.OLI_DB_PATH || 'data/oli.db');
const configPath = configFlag >= 0 && args[configFlag + 1]
  ? path.resolve(args[configFlag + 1])
  : path.resolve(process.env.OLI_CONFIG_PATH || 'data/config.json');
const cfg = loadConfig(configPath);
const ai = createAiRuntime(cfg);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
initAgentStore(db);
initSkillsStore(db);
initSourceRegistry(db);
initOrchestrationStore(db);

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
    name: 'oli_list_agents',
    description: 'List built-in local agents and their permission modes.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oli_run_agent',
    description: 'Run a local agent using shared Brain context and optional meeting context.',
    inputSchema: {
      type: 'object',
      required: ['agentId', 'request'],
      properties: {
        agentId: { type: 'string' },
        request: { type: 'string', maxLength: 4000 },
        meetingId: { type: 'string' },
        skillId: { type: 'string' }
      }
    }
  },
  {
    name: 'oli_search_brain',
    description: 'Search shared local Brain memories.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
    }
  },
  {
    name: 'oli_list_inbox',
    description: 'List local agent Inbox results.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }
    }
  },
  {
    name: 'oli_list_approvals',
    description: 'List pending or resolved agent approvals.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }
    }
  },
  {
    name: 'oli_resolve_approval',
    description: 'Approve or reject an agent side effect.',
    inputSchema: {
      type: 'object',
      required: ['approvalId', 'decision'],
      properties: {
        approvalId: { type: 'string' },
        decision: { type: 'string', enum: ['approved', 'rejected'] }
      }
    }
  },
  {
    name: 'oli_list_schedules',
    description: 'List persisted local agent schedules.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oli_list_skills',
    description: 'List reusable local agent skills.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oli_list_sources',
    description: 'List registered local knowledge sources.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oli_sync_source',
    description: 'Sync one registered local Markdown source.',
    inputSchema: { type: 'object', required: ['sourceId'], properties: { sourceId: { type: 'string' } } }
  },
  {
    name: 'oli_list_families',
    description: 'List local agent families.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oli_list_jobs',
    description: 'List durable local agent jobs.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }
  },
  {
    name: 'oli_get_job',
    description: 'Get one durable local agent job.',
    inputSchema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } }
  },
  {
    name: 'oli_retry_job',
    description: 'Retry a failed durable local agent job.',
    inputSchema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } }
  },
  {
    name: 'oli_cancel_job',
    description: 'Cancel a queued or processing local agent job.',
    inputSchema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } }
  },
  {
    name: 'oli_list_handoffs',
    description: 'List durable agent handoffs.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }
  },
  {
    name: 'oli_create_handoff',
    description: 'Queue a durable handoff to another local agent.',
    inputSchema: {
      type: 'object', required: ['toAgentId','request'],
      properties: { fromAgentId: { type: 'string' }, toAgentId: { type: 'string' }, parentRunId: { type: 'string' }, request: { type: 'string' }, context: { type: 'object' } }
    }
  },
  {
    name: 'oli_get_batch',
    description: 'Get one parallel agent batch and its child jobs.',
    inputSchema: { type: 'object', required: ['batchId'], properties: { batchId: { type: 'string' } } }
  },
  {
    name: 'oli_create_batch',
    description: 'Queue up to eight independent local agents as a durable parallel batch.',
    inputSchema: {
      type: 'object', required: ['items'],
      properties: { title: { type: 'string' }, items: { type: 'array', maxItems: 8 } }
    }
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
        ai,
        cfg,
        agentId: String(input.agentId || ''),
        request: String(input.request || ''),
        meetingId: input.meetingId ? String(input.meetingId) : null,
        skillId: input.skillId ? String(input.skillId) : null
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
        cfg,
        approvalId: String(input.approvalId || ''),
        decision: String(input.decision || '')
      });

    case 'oli_list_schedules':
      return listSchedules(db);

    case 'oli_list_skills':
      return listSkills(db);

    case 'oli_list_sources':
      return listRegisteredSources(db);

    case 'oli_sync_source':
      return syncRegisteredSource(db, String(input.sourceId || ''));

    case 'oli_list_families':
      return listFamilies(db);

    case 'oli_list_jobs':
      return listJobs(db, { status: String(input.status || ''), limit: input.limit });

    case 'oli_get_job':
      return getJob(db, String(input.jobId || ''));

    case 'oli_retry_job':
      return retryJob(db, String(input.jobId || ''));

    case 'oli_cancel_job':
      return cancelJob(db, String(input.jobId || ''));

    case 'oli_list_handoffs':
      return listHandoffs(db, String(input.status || ''), input.limit);

    case 'oli_create_handoff':
      return createHandoff(db, {
        fromAgentId: input.fromAgentId ? String(input.fromAgentId) : null,
        toAgentId: String(input.toAgentId || ''),
        parentRunId: input.parentRunId ? String(input.parentRunId) : null,
        request: String(input.request || ''),
        context: input.context || {}
      });

    case 'oli_get_batch':
      return getBatch(db, String(input.batchId || ''));

    case 'oli_create_batch':
      return createBatch(db, { title: input.title, items: input.items || [] });

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
  ai.close();
  db.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
