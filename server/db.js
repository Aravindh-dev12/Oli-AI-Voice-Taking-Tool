import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
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
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
      task TEXT,
      assignee TEXT,
      status TEXT DEFAULT 'pending'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS kb USING fts5(title, content);
  `);
  return db;
}
