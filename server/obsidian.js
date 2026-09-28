import fs from 'node:fs';
import path from 'node:path';

function safeFileName(value) {
  return String(value || 'meeting')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function yaml(value) {
  return JSON.stringify(String(value || '').slice(0, 500));
}

export function syncMeetingToObsidian(db, meetingId, vaultPath) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id=?').get(meetingId);
  if (!meeting) throw new Error('Meeting not found.');

  const segments = db.prepare(
    'SELECT speaker, text, ts FROM segments WHERE meeting_id=? ORDER BY ts'
  ).all(meetingId);
  const actions = db.prepare(
    'SELECT task, assignee, status FROM actions WHERE meeting_id=? ORDER BY id'
  ).all(meetingId);
  const meddpicc = db.prepare(
    'SELECT metrics, economic_buyer, decision_criteria, decision_process, paper_process, identify_pain, champion, competition FROM meeting_intelligence WHERE meeting_id=?'
  ).get(meetingId);

  const started = new Date(meeting.started_at || Date.now());
  const date = started.toISOString().slice(0, 10);
  const title = safeFileName(meeting.title || 'Meeting');
  const directory = path.join(path.resolve(vaultPath), 'Oli');
  const target = path.join(directory, date + ' — ' + title + '.md');
  const temp = target + '.tmp';

  const lines = [
    '---',
    'oli_meeting_id: ' + yaml(meeting.id),
    'started_at: ' + yaml(started.toISOString()),
    'ended_at: ' + yaml(meeting.ended_at ? new Date(meeting.ended_at).toISOString() : ''),
    '---',
    '',
    '# ' + title,
    '',
    '## Summary',
    '',
    meeting.summary || 'Summary unavailable.',
    '',
    '## MEDDPICC',
    '',
    '### Metrics',
    meddpicc?.metrics || 'Not evidenced',
    '',
    '### Economic Buyer',
    meddpicc?.economic_buyer || 'Not evidenced',
    '',
    '### Decision Criteria',
    meddpicc?.decision_criteria || 'Not evidenced',
    '',
    '### Decision Process',
    meddpicc?.decision_process || 'Not evidenced',
    '',
    '### Paper Process',
    meddpicc?.paper_process || 'Not evidenced',
    '',
    '### Identify Pain',
    meddpicc?.identify_pain || 'Not evidenced',
    '',
    '### Champion',
    meddpicc?.champion || 'Not evidenced',
    '',
    '### Competition',
    meddpicc?.competition || 'Not evidenced',
    '',
    '## Commitments',
    ''
  ];

  if (actions.length) {
    for (const action of actions) {
      lines.push('- [' + (action.status === 'done' ? 'x' : ' ') + '] ' + action.task + ' — ' + action.assignee);
    }
  } else {
    lines.push('No commitments recorded.');
  }

  lines.push('', '## Transcript', '');
  for (const segment of segments) {
    lines.push('**' + segment.speaker + '** · ' + new Date(segment.ts).toLocaleTimeString() + '', segment.text, '');
  }

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temp, lines.join('\n'), { mode: 0o600 });
  fs.renameSync(temp, target);
  return target;
}
