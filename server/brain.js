import { randomUUID } from 'node:crypto';

const KINDS = new Set(['person', 'project', 'decision', 'company', 'topic', 'meeting', 'commitment', 'fact']);

function clean(value, max=4000) {
  return String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
}

function initBrainStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      namespace TEXT NOT NULL DEFAULT 'shared',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brain_kind_namespace ON brain_memories(kind, namespace);
    CREATE INDEX IF NOT EXISTS idx_brain_source ON brain_memories(source_type, source_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
      title,
      content,
      tags,
      kind UNINDEXED,
      namespace UNINDEXED,
      source_type UNINDEXED,
      source_id UNINDEXED,
      content='',
      tokenize='unicode61'
    );
  `);
  return db;
}

function parseTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => clean(tag, 60)).filter(Boolean))].slice(0, 20);
}

function upsertBrainMemory(db, input = {}) {
  const kind = KINDS.has(String(input.kind || '')) ? String(input.kind) : 'fact';
  const namespace = clean(input.namespace || 'shared', 80) || 'shared';
  const title = clean(input.title, 240);
  const content = clean(input.content, 8000);
  const sourceType = clean(input.sourceType || 'manual', 80) || 'manual';
  const sourceId = input.sourceId == null ? null : clean(input.sourceId, 160);
  const confidence = Math.min(Math.max(Number(input.confidence ?? 1), 0), 1);
  const tags = parseTags(input.tags);
  if (!title || !content) throw new Error('title and content are required');

  const now = Date.now();
  const existing = db.prepare(
    'SELECT * FROM brain_memories WHERE kind=? AND namespace=? AND title=? AND ((source_id IS NULL AND ? IS NULL) OR source_id=?) LIMIT 1'
  ).get(kind, namespace, title, sourceId, sourceId);

  let id;
  if (existing) {
    id = existing.id;
    db.prepare(
      'UPDATE brain_memories SET content=?, source_type=?, source_id=?, confidence=?, tags_json=?, updated_at=? WHERE id=?'
    ).run(content, sourceType, sourceId, confidence, JSON.stringify(tags), now, id);
    db.prepare('DELETE FROM brain_fts WHERE rowid=?').run(id);
  } else {
    const result = db.prepare(
      'INSERT INTO brain_memories(kind, namespace, title, content, source_type, source_id, confidence, tags_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).run(kind, namespace, title, content, sourceType, sourceId, confidence, JSON.stringify(tags), now, now);
    id = Number(result.lastInsertRowid);
  }

  db.prepare(
    'INSERT INTO brain_fts(rowid, title, content, tags, kind, namespace, source_type, source_id) VALUES(?,?,?,?,?,?,?,?)'
  ).run(id, title, content, tags.join(' '), kind, namespace, sourceType, sourceId || '');
  return db.prepare('SELECT * FROM brain_memories WHERE id=?').get(id);
}

function deleteBrainMemory(db, id) {
  const result = db.prepare('DELETE FROM brain_memories WHERE id=?').run(Number(id));
  db.prepare('DELETE FROM brain_fts WHERE rowid=?').run(Number(id));
  return Boolean(result.changes);
}

function listBrainMemories(db, { kind, namespace, limit = 100 } = {}) {
  const params = [];
  let sql = 'SELECT * FROM brain_memories WHERE 1=1';
  if (kind && KINDS.has(String(kind))) { sql += ' AND kind=?'; params.push(String(kind)); }
  if (namespace) { sql += ' AND namespace=?'; params.push(clean(namespace, 80) || 'shared'); }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  return db.prepare(sql).all(...params);
}

function searchBrain(db, query, limit = 20) {
  const cleanQuery = clean(query, 500);
  if (!cleanQuery) return [];
  const terms = cleanQuery.split(/\\s+/).filter(Boolean).slice(0, 12)
    .map((term) => '"' + term.replace(/"/g, '""') + '"').join(' OR ');
  return db.prepare(
    'SELECT b.*, f.rank FROM brain_fts f JOIN brain_memories b ON b.id=f.rowid WHERE brain_fts MATCH ? ORDER BY f.rank LIMIT ?'
  ).all(terms, Math.min(Math.max(Number(limit) || 20, 1), 100));
}

function seedMeetingBrain(db, meetingId) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(String(meetingId));
  if (!meeting) throw new Error('Meeting not found');

  upsertBrainMemory(db, {
    kind: 'meeting',
    title: meeting.title || 'Meeting',
    content: [
      meeting.summary || 'Summary unavailable.',
      'Meeting ID: ' + meeting.id,
      meeting.ended_at ? 'Ended: ' + new Date(meeting.ended_at).toISOString() : ''
    ].filter(Boolean).join('\\n'),
    sourceType: 'meeting',
    sourceId: meeting.id,
    tags: ['meeting', 'oli']
  });

  const meddpicc = db.prepare(
    'SELECT metrics, economic_buyer, decision_criteria, decision_process, paper_process, identify_pain, champion, competition FROM meeting_intelligence WHERE meeting_id=?'
  ).get(meeting.id);
  if (meddpicc) {
    upsertBrainMemory(db, {
      kind: 'fact',
      title: 'MEDDPICC — ' + (meeting.title || meeting.id),
      content: JSON.stringify(meddpicc),
      sourceType: 'meeting',
      sourceId: meeting.id,
      tags: ['meddpicc', 'sales', 'meeting']
    });
  }

  const actions = db.prepare(
    'SELECT task, assignee, status FROM actions WHERE meeting_id=? ORDER BY id'
  ).all(meeting.id);
  for (const action of actions) {
    upsertBrainMemory(db, {
      kind: 'commitment',
      title: action.task,
      content: 'Assignee: ' + action.assignee + '\\nStatus: ' + action.status + '\\nMeeting: ' + meeting.id,
      sourceType: 'meeting',
      sourceId: meeting.id + ':' + action.task,
      tags: ['commitment', 'follow-up']
    });
  }
}

function serializeBrainContext(rows) {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    namespace: row.namespace,
    title: row.title,
    content: row.content,
    source_type: row.source_type,
    source_id: row.source_id,
    confidence: row.confidence,
    tags: JSON.parse(row.tags_json || '[]'),
    updated_at: row.updated_at
  }));
}

export {
  KINDS,
  initBrainStore,
  upsertBrainMemory,
  deleteBrainMemory,
  listBrainMemories,
  searchBrain,
  seedMeetingBrain,
  serializeBrainContext
};
