function quoteTerm(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

export function searchKnowledge(db, query, limit = 10) {
  const clean = String(query || '').trim();
  if (!clean) return [];
  const terms = clean.split(/\s+/).filter(Boolean).slice(0, 12).map(quoteTerm).join(' OR ');
  return db.prepare(
    'SELECT rowid AS id, title, content, rank FROM kb WHERE kb MATCH ? ORDER BY rank LIMIT ?'
  ).all(terms, Math.min(Math.max(Number(limit) || 10, 1), 50));
}

export function searchTranscript(db, query, limit = 20) {
  const clean = String(query || '').trim();
  if (!clean) return [];
  return db.prepare(
    'SELECT s.id, s.meeting_id, s.speaker, s.text, s.ts FROM segments s JOIN meetings m ON m.id = s.meeting_id WHERE s.text LIKE ? ORDER BY s.ts DESC LIMIT ?'
  ).all('%' + clean.slice(0, 120) + '%', Math.min(Math.max(Number(limit) || 20, 1), 100));
}

export function getMeetingContext(db, meetingId) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) return null;
  const segments = db.prepare('SELECT speaker, text, ts FROM segments WHERE meeting_id=? ORDER BY ts').all(meetingId);
  const actions = db.prepare('SELECT task, assignee, status FROM actions WHERE meeting_id=? ORDER BY id').all(meetingId);
  return { meeting, segments, actions };
}
