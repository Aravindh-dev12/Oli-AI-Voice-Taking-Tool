import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as sqliteVec from 'sqlite-vec';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try { sqliteVec.load(db); } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
      speaker TEXT,   -- 'You' or 'Them'
      text TEXT,
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS agenda_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
      item TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agenda_meeting_position ON agenda_items(meeting_id, position);
    CREATE TABLE IF NOT EXISTS meeting_intelligence (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
      metrics TEXT,
      economic_buyer TEXT,
      decision_criteria TEXT,
      decision_process TEXT,
      paper_process TEXT,
      identify_pain TEXT,
      champion TEXT,
      competition TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
      task TEXT,
      assignee TEXT,
      status TEXT DEFAULT 'pending'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS kb USING fts5(title, content);
    CREATE TABLE IF NOT EXISTS kb_sources (
      file_path TEXT PRIMARY KEY,
      kb_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      modified_at INTEGER NOT NULL,
      source_id TEXT NOT NULL DEFAULT 'legacy'
    );
  `);
  const kbSourceColumns = db.prepare('PRAGMA table_info(kb_sources)').all();
  if (!kbSourceColumns.some((column) => column.name === 'source_id')) {
    db.exec("ALTER TABLE kb_sources ADD COLUMN source_id TEXT NOT NULL DEFAULT 'legacy'");
  }
  return db;
}
