import { randomUUID } from 'node:crypto';
import { parseJsonObject } from './ai/utils.js';
import { getMeetingContext } from './rag.js';
import { upsertBrainMemory, searchBrain, listBrainMemories, deleteBrainMemory, serializeBrainContext } from './brain.js';
import { syncMeetingToObsidian } from './obsidian.js';
import { syncMeetingToCrm } from './crm.js';

const PERMISSIONS = new Set(['read_only', 'ask_first', 'always_allow']);
const ACTIONS = new Set(['brain_memory_upsert', 'create_commitment', 'followup_draft', 'obsidian_sync', 'crm_sync']);

const DEFAULT_AGENTS = [
  { id:'meeting-analyst', name:'Meeting Analyst', description:'Turns completed meetings into durable shared Brain context and a concise reviewable result.', permissionMode:'always_allow', allowedActions:['brain_memory_upsert','followup_draft'], systemPrompt:'You are Oli Meeting Analyst. Use only the supplied meeting transcript and Brain context. Extract durable, factual context that will help future work. Never invent people, projects, decisions, metrics or commitments.' },
  { id:'follow-up-planner', name:'Follow-up Planner', description:'Converts a completed meeting into explicit next steps and reviewable local/external actions.', permissionMode:'ask_first', allowedActions:['brain_memory_upsert','create_commitment','followup_draft','obsidian_sync','crm_sync'], systemPrompt:'You are Oli Follow-up Planner. Produce concrete next steps from meeting evidence. Draft follow-up content for review but never assume that an external message or CRM write has happened.' },
  { id:'researcher', name:'Local Researcher', description:'Answers questions from the shared Brain, trusted knowledge base and meeting records.', permissionMode:'read_only', allowedActions:[], systemPrompt:'You are Oli Local Researcher. Answer from supplied local context only. Clearly state when the local Brain does not contain enough evidence. Do not invent facts and do not propose side effects.' }
];

function clampText(value, max=8000) { return String(value??'').replace(/\s+/g,' ').trim().slice(0,max); }

function initAgentStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
      system_prompt TEXT NOT NULL, permission_mode TEXT NOT NULL DEFAULT 'ask_first',
      allowed_actions_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_profiles(id),
      meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL, request TEXT NOT NULL,
      result TEXT, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_meeting ON agent_runs(meeting_id);
    CREATE TABLE IF NOT EXISTS agent_approvals (
      id TEXT PRIMARY KEY, agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL, payload_json TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
      resolved_at INTEGER, resolution TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON agent_approvals(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_inbox (
      id TEXT PRIMARY KEY, agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread', created_at INTEGER NOT NULL, read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_inbox_status ON agent_inbox(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_schedules (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL, interval_ms INTEGER NOT NULL, next_run_at INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, last_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_schedules_due ON agent_schedules(enabled, next_run_at);
    CREATE TABLE IF NOT EXISTS agent_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent_run_id TEXT, event_type TEXT NOT NULL,
      action_type TEXT, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO agent_profiles(id,name,description,system_prompt,permission_mode,allowed_actions_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)');
  const now=Date.now();
  const tx=db.transaction(()=>{ for(const a of DEFAULT_AGENTS) insert.run(a.id,a.name,a.description,a.systemPrompt,a.permissionMode,JSON.stringify(a.allowedActions),now,now); });
  tx();
  return db;
}

function listAgents(db) {
  return db.prepare('SELECT id,name,description,permission_mode,allowed_actions_json,enabled,created_at,updated_at FROM agent_profiles ORDER BY name')
    .all().map(a=>({...a,allowed_actions:JSON.parse(a.allowed_actions_json||'[]')}));
}
function getAgent(db,agentId) {
  const a=db.prepare('SELECT * FROM agent_profiles WHERE id=? AND enabled=1').get(String(agentId||''));
  if(!a) throw new Error('Agent not found or disabled.');
  return {...a,allowedActions:JSON.parse(a.allowed_actions_json||'[]')};
}
function updateAgent(db,agentId,values={}) {
  const current=db.prepare('SELECT * FROM agent_profiles WHERE id=?').get(String(agentId||''));
  if(!current) throw new Error('Agent not found.');
  const mode=values.permissionMode==null?current.permission_mode:String(values.permissionMode);
  if(!PERMISSIONS.has(mode)) throw new Error('permissionMode must be read_only, ask_first, or always_allow.');
  const enabled=values.enabled==null?current.enabled:(values.enabled?1:0);
  const allowed=values.allowedActions==null?JSON.parse(current.allowed_actions_json||'[]'):values.allowedActions;
  if(!Array.isArray(allowed)||allowed.some(n=>!ACTIONS.has(String(n)))) throw new Error('allowedActions contains an unsupported action.');
  db.prepare('UPDATE agent_profiles SET permission_mode=?,allowed_actions_json=?,enabled=?,updated_at=? WHERE id=?')
    .run(mode,JSON.stringify([...new Set(allowed)]),enabled,Date.now(),current.id);
  return db.prepare('SELECT id,name,description,permission_mode,allowed_actions_json,enabled,created_at,updated_at FROM agent_profiles WHERE id=?').get(current.id);
}
function listInbox(db,{status='',limit=100}={}) {
  const params=[]; let sql='SELECT * FROM agent_inbox WHERE 1=1';
  if(status&&['unread','read','archived'].includes(String(status))){sql+=' AND status=?';params.push(String(status));}
  sql+=' ORDER BY created_at DESC LIMIT ?'; params.push(Math.min(Math.max(Number(limit)||100,1),200));
  return db.prepare(sql).all(...params);
}
function markInbox(db,id,status) {
  if(!['read','unread','archived'].includes(status)) throw new Error('Invalid inbox status.');
  const r=db.prepare('UPDATE agent_inbox SET status=?,read_at=? WHERE id=?').run(status,status==='read'?Date.now():null,String(id));
  if(!r.changes) throw new Error('Inbox item not found.');
  return db.prepare('SELECT * FROM agent_inbox WHERE id=?').get(String(id));
}
function listApprovals(db,status='pending',limit=100) {
  const useStatus=['pending','approved','rejected','failed'].includes(String(status))?String(status):'pending';
  return db.prepare('SELECT * FROM agent_approvals WHERE status=? ORDER BY created_at DESC LIMIT ?').all(useStatus,Math.min(Math.max(Number(limit)||100,1),200));
}
function audit(db,agentRunId,eventType,actionType,payload) {
  db.prepare('INSERT INTO agent_audit(agent_run_id,event_type,action_type,payload_json,created_at) VALUES(?,?,?,?,?)')
    .run(agentRunId||null,String(eventType),actionType||null,JSON.stringify(payload||{}),Date.now());
}
function createApproval(db,{agentRunId=null,actionType,payload,reason}) {
  if(!ACTIONS.has(String(actionType))) throw new Error('Unsupported approval action.');
  const id=randomUUID();
  db.prepare('INSERT INTO agent_approvals(id,agent_run_id,action_type,payload_json,reason,status,created_at) VALUES(?,?,?,?,?,"pending",?)')
    .run(id,agentRunId,String(actionType),JSON.stringify(payload||{}),clampText(reason,1000),Date.now());
  audit(db,agentRunId,'approval_requested',String(actionType),{approvalId:id,reason:clampText(reason,1000)});
  return db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(id);
}

async function executeAction({db,cfg,actionType,payload,agentRunId}) {
  switch(actionType){
    case 'brain_memory_upsert': return upsertBrainMemory(db,payload);
    case 'create_commitment': {
      const meetingId=clampText(payload.meetingId,120);
      if(!meetingId||!db.prepare('SELECT 1 FROM meetings WHERE id=?').get(meetingId)) throw new Error('Meeting not found for commitment.');
      const task=clampText(payload.task,500); if(!task) throw new Error('Commitment task is required.');
      const assignee=clampText(payload.assignee||'Unassigned',120);
      const r=db.prepare('INSERT INTO actions(meeting_id,task,assignee,status) VALUES(?,?,?,"pending")').run(meetingId,task,assignee);
      return db.prepare('SELECT id,meeting_id,task,assignee,status FROM actions WHERE id=?').get(r.lastInsertRowid);
    }
    case 'followup_draft': {
      const id=randomUUID();
      db.prepare('INSERT INTO agent_inbox(id,agent_run_id,kind,title,body,status,created_at) VALUES(?,?,?,?,?,"unread",?)')
        .run(id,agentRunId||null,'followup-draft',clampText(payload.title||'Follow-up draft',240),clampText(payload.body,12000),Date.now());
      return db.prepare('SELECT * FROM agent_inbox WHERE id=?').get(id);
    }
    case 'obsidian_sync': {
      if(!payload.meetingId||!cfg.obsidianVaultPath) throw new Error('Obsidian vault or meetingId is not configured.');
      return {path:syncMeetingToObsidian(db,payload.meetingId,cfg.obsidianVaultPath)};
    }
    case 'crm_sync': {
      if(!payload.meetingId||!cfg.crmWebhookUrl) throw new Error('CRM webhook or meetingId is not configured.');
      const meeting=db.prepare('SELECT * FROM meetings WHERE id=?').get(String(payload.meetingId)); if(!meeting) throw new Error('Meeting not found for CRM sync.');
      const meddpicc=db.prepare('SELECT metrics,economic_buyer,decision_criteria,decision_process,paper_process,identify_pain,champion,competition FROM meeting_intelligence WHERE meeting_id=?').get(meeting.id);
      const actions=db.prepare('SELECT id,task,assignee,status FROM actions WHERE meeting_id=? ORDER BY id').all(meeting.id);
      return syncMeetingToCrm({meeting,meddpicc,actions,webhookUrl:cfg.crmWebhookUrl,token:cfg.crmWebhookToken,timeoutMs:cfg.aiTimeoutMs});
    }
    default: throw new Error('Unsupported action: '+actionType);
  }
}

function buildAgentContext(db,request,meetingId) {
  const brain=searchBrain(db,request,8);
  const meeting=meetingId?getMeetingContext(db,String(meetingId)):null;
  if(meetingId&&!meeting) throw new Error('Meeting not found.');
  const knowledge=db.prepare('SELECT rowid AS id,title,content FROM kb ORDER BY rowid DESC LIMIT 8').all();
  return {
    meeting, brain:serializeBrainContext(brain),
    recentBrain:serializeBrainContext(listBrainMemories(db,{limit:20})),
    knowledge:knowledge.map(r=>({id:r.id,title:r.title,content:r.content.slice(0,1800)}))
  };
}

function parseAgentResponse(raw,agentId,meetingId) {
  try {
    const parsed=parseJsonObject(raw);
    const memories=Array.isArray(parsed.memories)?parsed.memories:[];
    const actions=Array.isArray(parsed.actions)?parsed.actions:[];
    const answer=clampText(parsed.answer||parsed.summary||'',10000)||'Agent completed without a textual answer.';
    const normalizedMemories=memories.filter(x=>x&&typeof x==='object').slice(0,12).map(x=>({
      kind:String(x.kind||'fact'),title:clampText(x.title,240),content:clampText(x.content,8000),
      tags:Array.isArray(x.tags)?x.tags.slice(0,12).map(t=>clampText(t,60)):[],
      sourceType:'agent',sourceId:agentId+':'+String(meetingId||'general'),
      confidence:Number.isFinite(Number(x.confidence))?Number(x.confidence):0.85
    })).filter(x=>x.title&&x.content);
    const normalizedActions=actions.filter(x=>x&&typeof x==='object').slice(0,12).map(x=>({
      type:String(x.type||''),reason:clampText(x.reason||'Agent proposed this action.',800),
      payload:x.payload&&typeof x.payload==='object'?x.payload:{}
    }));
    const inbox=parsed.inbox&&typeof parsed.inbox==='object'
      ?{title:clampText(parsed.inbox.title||'Agent result',240),body:clampText(parsed.inbox.body||answer,12000)}
      :{title:'Agent result',body:answer};
    return {answer,memories:normalizedMemories,actions:normalizedActions,inbox};
  } catch {
    return {answer:clampText(raw,10000),memories:[],actions:[],inbox:{title:'Agent result',body:clampText(raw,10000)}};
  }
}

async function runAgent({db,ai,cfg,agentId,request,meetingId=null}) {
  const agent=getAgent(db,agentId); const prompt=clampText(request,4000);
  if(!prompt) throw new Error('request is required.');
  const runId=randomUUID();
  db.prepare('INSERT INTO agent_runs(id,agent_id,meeting_id,request,status,created_at) VALUES(?,?,?,?,?,?)')
    .run(runId,agent.id,meetingId||null,prompt,'running',Date.now());
  try {
    const context=buildAgentContext(db,prompt,meetingId);
    const contract='Return only valid JSON. Schema: {"answer":"string","memories":[{"kind":"person|project|decision|company|topic|meeting|commitment|fact","title":"string","content":"string","tags":["string"],"confidence":0.0}],"actions":[{"type":"brain_memory_upsert|create_commitment|followup_draft|obsidian_sync|crm_sync","reason":"string","payload":{}}],"inbox":{"title":"string","body":"string"}}. Do not invent evidence. Do not claim an action happened unless it is represented in supplied context.';
    const raw=await ai.copilot(agent.system_prompt+'\n\n'+contract,'User request:\n'+prompt+'\n\nLocal context:\n'+JSON.stringify(context).slice(0,42000));
    const parsed=parseAgentResponse(raw,agent.id,meetingId);
    for(const memory of parsed.memories){
      if(agent.allowedActions.includes('brain_memory_upsert')) { upsertBrainMemory(db,memory); audit(db,runId,'brain_memory_written','brain_memory_upsert',{title:memory.title,kind:memory.kind}); }
      else audit(db,runId,'brain_memory_dropped','brain_memory_upsert',{title:memory.title,reason:'action not allowed'});
    }
    for(const action of parsed.actions){
      if(!ACTIONS.has(action.type)||!agent.allowedActions.includes(action.type)){ audit(db,runId,'action_dropped',action.type||null,{reason:'action not allowed'}); continue; }
      if(action.type==='followup_draft'){
        const result=await executeAction({db,cfg,actionType:action.type,payload:action.payload,agentRunId:runId});
        audit(db,runId,'action_executed',action.type,{inboxId:result.id}); continue;
      }
      if(agent.permission_mode==='always_allow'){
        const result=await executeAction({db,cfg,actionType:action.type,payload:action.payload,agentRunId:runId});
        audit(db,runId,'action_executed',action.type,{result}); continue;
      }
      if(agent.permission_mode==='ask_first'){
        createApproval(db,{agentRunId:runId,actionType:action.type,payload:action.payload,reason:action.reason}); continue;
      }
      audit(db,runId,'action_blocked',action.type,{reason:'read_only'});
    }
    const inboxId=randomUUID();
    db.prepare('INSERT INTO agent_inbox(id,agent_run_id,kind,title,body,status,created_at) VALUES(?,?,?,?,?,"unread",?)')
      .run(inboxId,runId,'agent-result',parsed.inbox.title,parsed.inbox.body,Date.now());
    db.prepare('UPDATE agent_runs SET result=?,status="completed",completed_at=? WHERE id=?')
      .run(JSON.stringify({answer:parsed.answer,inboxId,actions:parsed.actions}),Date.now(),runId);
    return {id:runId,agent:agent.id,answer:parsed.answer,inboxId};
  } catch(error) {
    db.prepare('UPDATE agent_runs SET status="failed",error=?,completed_at=? WHERE id=?').run(clampText(error.message,2000),Date.now(),runId);
    audit(db,runId,'run_failed',null,{reason:clampText(error.message,2000)});
    throw error;
  }
}

async function resolveApproval({db,cfg,approvalId,decision}) {
  const approval=db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(String(approvalId));
  if(!approval) throw new Error('Approval not found.');
  if(approval.status!=='pending') throw new Error('Approval is already resolved.');
  if(!['approved','rejected'].includes(decision)) throw new Error('decision must be approved or rejected.');
  if(decision==='rejected'){
    db.prepare('UPDATE agent_approvals SET status="rejected",resolved_at=?,resolution=? WHERE id=?').run(Date.now(),'rejected',approval.id);
    audit(db,approval.agent_run_id,'approval_rejected',approval.action_type,{approvalId:approval.id});
    return db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(approval.id);
  }
  const payload=JSON.parse(approval.payload_json||'{}');
  try {
    const result=await executeAction({db,cfg,actionType:approval.action_type,payload,agentRunId:approval.agent_run_id});
    db.prepare('UPDATE agent_approvals SET status="approved",resolved_at=?,resolution=? WHERE id=?').run(Date.now(),JSON.stringify({ok:true,result}),approval.id);
    audit(db,approval.agent_run_id,'approval_executed',approval.action_type,{approvalId:approval.id,result});
    return db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(approval.id);
  } catch(error) {
    db.prepare('UPDATE agent_approvals SET status="failed",resolved_at=?,resolution=? WHERE id=?').run(Date.now(),clampText(error.message,2000),approval.id);
    audit(db,approval.agent_run_id,'approval_failed',approval.action_type,{approvalId:approval.id,reason:clampText(error.message,2000)});
    throw error;
  }
}

function listSchedules(db,enabledOnly=false){ return db.prepare(enabledOnly?'SELECT * FROM agent_schedules WHERE enabled=1 ORDER BY next_run_at':'SELECT * FROM agent_schedules ORDER BY next_run_at').all(); }
function createSchedule(db,{agentId,prompt,intervalMs}){
  getAgent(db,agentId); const interval=Math.min(Math.max(Number(intervalMs)||3600000,60000),7*24*60*60*1000);
  const now=Date.now(),id=randomUUID(); db.prepare('INSERT INTO agent_schedules(id,agent_id,prompt,interval_ms,next_run_at,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id,agentId,clampText(prompt,4000),interval,now+interval,now,now);
  return db.prepare('SELECT * FROM agent_schedules WHERE id=?').get(id);
}
function updateSchedule(db,id,values={}){
  const current=db.prepare('SELECT * FROM agent_schedules WHERE id=?').get(String(id)); if(!current) throw new Error('Schedule not found.');
  const interval=values.intervalMs==null?current.interval_ms:Math.min(Math.max(Number(values.intervalMs)||current.interval_ms,60000),7*24*60*60*1000);
  const enabled=values.enabled==null?current.enabled:(values.enabled?1:0); const prompt=values.prompt==null?current.prompt:clampText(values.prompt,4000); const now=Date.now();
  db.prepare('UPDATE agent_schedules SET prompt=?,interval_ms=?,enabled=?,next_run_at=?,updated_at=? WHERE id=?').run(prompt,interval,enabled,now+interval,now,current.id);
  return db.prepare('SELECT * FROM agent_schedules WHERE id=?').get(current.id);
}
function deleteSchedule(db,id){ const r=db.prepare('DELETE FROM agent_schedules WHERE id=?').run(String(id)); if(!r.changes) throw new Error('Schedule not found.'); return {ok:true}; }

function startAgentScheduler({db,ai,cfg,tickMs=5000}){
  const inFlight=new Set();
  const timer=setInterval(async()=>{
    const due=db.prepare('SELECT * FROM agent_schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 5').all(Date.now());
    for(const schedule of due){
      if(inFlight.has(schedule.id)) continue;
      inFlight.add(schedule.id);
      db.prepare('UPDATE agent_schedules SET next_run_at=?,updated_at=? WHERE id=?').run(Date.now()+schedule.interval_ms,Date.now(),schedule.id);
      void runAgent({db,ai,cfg,agentId:schedule.agent_id,request:schedule.prompt})
        .then(run=>db.prepare('UPDATE agent_schedules SET last_run_id=?,updated_at=? WHERE id=?').run(run.id,Date.now(),schedule.id))
        .catch(()=>{}).finally(()=>inFlight.delete(schedule.id));
    }
  },tickMs);
  timer.unref?.();
  return ()=>clearInterval(timer);
}

export {
  PERMISSIONS,ACTIONS,initAgentStore,listAgents,getAgent,updateAgent,runAgent,
  listInbox,markInbox,listApprovals,createApproval,resolveApproval,listSchedules,
  createSchedule,updateSchedule,deleteSchedule,startAgentScheduler,searchBrain,
  listBrainMemories,deleteBrainMemory,seedMeetingBrain
};
