import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 500_000;

function walkMarkdown(root) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function titleFromMarkdown(filePath, content) {
  const heading = content.match(/^#\s+(.+)$/m);
  return (heading?.[1] || path.basename(filePath, '.md')).trim().slice(0, 200);
}

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function syncKnowledge(db, rootPath, sourceId = 'legacy') {
  const root = rootPath ? path.resolve(rootPath) : '';
  if (!root || !fs.existsSync(root)) {
    return { added: 0, updated: 0, removed: 0, skipped: 0, root, missing: Boolean(root) };
  }

  db.exec('CREATE TABLE IF NOT EXISTS kb_sources (file_path TEXT PRIMARY KEY, kb_id INTEGER NOT NULL, content_hash TEXT NOT NULL, modified_at INTEGER NOT NULL)');
  const columns = db.prepare('PRAGMA table_info(kb_sources)').all();
  if (!columns.some((column) => column.name === 'source_id')) {
    db.exec("ALTER TABLE kb_sources ADD COLUMN source_id TEXT NOT NULL DEFAULT 'legacy'");
  }
  const existing = new Map(
    db.prepare('SELECT file_path, kb_id, content_hash, source_id FROM kb_sources WHERE source_id=?').all(sourceId).map((row) => [row.file_path, row])
  );

  const files = new Set(walkMarkdown(root).map((filePath) => path.resolve(filePath)));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;

  const upsert = db.transaction(() => {
    for (const filePath of files) {
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8').slice(0, MAX_FILE_BYTES);
      const hash = digest(content);
      const prior = existing.get(filePath);
      const owner = db.prepare('SELECT source_id FROM kb_sources WHERE file_path=?').get(filePath);
      if (owner && owner.source_id !== sourceId) {
        throw new Error('Source overlap: ' + filePath + ' is already indexed by source ' + owner.source_id + '. Use one source per file.');
      }

      if (prior && prior.content_hash === hash) {
        skipped += 1;
        existing.delete(filePath);
        continue;
      }

      if (prior) {
        db.prepare('DELETE FROM kb WHERE rowid=?').run(prior.kb_id);
        updated += 1;
      } else {
        added += 1;
      }

      const insert = db.prepare('INSERT INTO kb(title, content) VALUES(?, ?)');
      const result = insert.run(titleFromMarkdown(filePath, content), content);
      db.prepare(
        'INSERT OR REPLACE INTO kb_sources(file_path, kb_id, content_hash, modified_at, source_id) VALUES(?,?,?,?,?)'
      ).run(filePath, Number(result.lastInsertRowid), hash, Math.round(stat.mtimeMs), sourceId);
      existing.delete(filePath);
    }

    for (const stale of existing.values()) {
      db.prepare('DELETE FROM kb WHERE rowid=?').run(stale.kb_id);
      db.prepare('DELETE FROM kb_sources WHERE file_path=?').run(stale.file_path);
      removed += 1;
    }
  });

  upsert();
  return { added, updated, removed, skipped, root, missing: false };
}

export function listKnowledgeSources(db) {
  try {
    return db.prepare(
      'SELECT file_path, kb_id, modified_at, source_id FROM kb_sources ORDER BY file_path'
    ).all();
  } catch {
    return [];
  }
}


export function initSourceRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources_registry (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      root_path TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'markdown',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sync_at INTEGER,
      last_result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_sources_enabled ON knowledge_sources_registry(enabled, name);
  `);
  return db;
}

export function listRegisteredSources(db) {
  initSourceRegistry(db);
  return db.prepare('SELECT * FROM knowledge_sources_registry ORDER BY name').all();
}

export function registerSource(db, { id, name, rootPath, sourceType = 'markdown', enabled = true }) {
  initSourceRegistry(db);
  const cleanId = String(id || '').trim().slice(0, 100);
  const cleanName = String(name || '').trim().slice(0, 200);
  const resolvedRoot = rootPath ? path.resolve(String(rootPath)) : '';
  const type = String(sourceType || 'markdown').toLowerCase();
  if (!cleanId || !cleanName || !resolvedRoot) throw new Error('id, name and rootPath are required.');
  if (type !== 'markdown') throw new Error('Only markdown local sources are supported in this release.');
  const now = Date.now();
  db.prepare(
    'INSERT INTO knowledge_sources_registry(id,name,root_path,source_type,enabled,last_sync_at,last_result_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,root_path=excluded.root_path,source_type=excluded.source_type,enabled=excluded.enabled,updated_at=excluded.updated_at'
  ).run(cleanId, cleanName, resolvedRoot, type, enabled ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM knowledge_sources_registry WHERE id=?').get(cleanId);
}

export function setSourceEnabled(db, sourceId, enabled) {
  initSourceRegistry(db);
  const result = db.prepare('UPDATE knowledge_sources_registry SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), String(sourceId));
  if (!result.changes) throw new Error('Source not found.');
  return db.prepare('SELECT * FROM knowledge_sources_registry WHERE id=?').get(String(sourceId));
}

export function deleteSource(db, sourceId) {
  initSourceRegistry(db);
  const source = db.prepare('SELECT * FROM knowledge_sources_registry WHERE id=?').get(String(sourceId));
  if (!source) throw new Error('Source not found.');
  const rows = db.prepare('SELECT kb_id FROM kb_sources WHERE source_id=?').all(source.id);
  const tx = db.transaction(() => {
    for (const row of rows) db.prepare('DELETE FROM kb WHERE rowid=?').run(row.kb_id);
    db.prepare('DELETE FROM kb_sources WHERE source_id=?').run(source.id);
    db.prepare('DELETE FROM knowledge_sources_registry WHERE id=?').run(source.id);
  });
  tx();
  return { ok: true, removedEntries: rows.length };
}

export function syncRegisteredSource(db, sourceId) {
  initSourceRegistry(db);
  const source = db.prepare('SELECT * FROM knowledge_sources_registry WHERE id=?').get(String(sourceId));
  if (!source) throw new Error('Source not found.');
  if (!source.enabled) return { id: source.id, skipped: true, reason: 'disabled' };
  const result = syncKnowledge(db, source.root_path, source.id);
  db.prepare('UPDATE knowledge_sources_registry SET last_sync_at=?,last_result_json=?,updated_at=? WHERE id=?')
    .run(Date.now(), JSON.stringify(result), Date.now(), source.id);
  return { id: source.id, name: source.name, ...result };
}

export function syncAllRegisteredSources(db) {
  initSourceRegistry(db);
  return db.prepare('SELECT id FROM knowledge_sources_registry WHERE enabled=1 ORDER BY name').all()
    .map((row) => {
      try { return syncRegisteredSource(db, row.id); }
      catch (error) { return { id: row.id, error: error.message }; }
    });
}
