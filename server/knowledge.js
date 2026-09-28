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

export function syncKnowledge(db, rootPath) {
  const root = rootPath ? path.resolve(rootPath) : '';
  if (!root || !fs.existsSync(root)) {
    return { added: 0, updated: 0, removed: 0, skipped: 0, root, missing: Boolean(root) };
  }

  db.exec('CREATE TABLE IF NOT EXISTS kb_sources (file_path TEXT PRIMARY KEY, kb_id INTEGER NOT NULL, content_hash TEXT NOT NULL, modified_at INTEGER NOT NULL)');
  const existing = new Map(
    db.prepare('SELECT file_path, kb_id, content_hash FROM kb_sources').all().map((row) => [row.file_path, row])
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
        'INSERT OR REPLACE INTO kb_sources(file_path, kb_id, content_hash, modified_at) VALUES(?,?,?,?)'
      ).run(filePath, Number(result.lastInsertRowid), hash, Math.round(stat.mtimeMs));
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
      'SELECT file_path, kb_id, modified_at FROM kb_sources ORDER BY file_path'
    ).all();
  } catch {
    return [];
  }
}
