const DEFAULT_SKILLS = [
  {
    id: 'meeting-brief',
    name: 'Meeting Brief',
    description: 'Produce a concise pre-meeting brief from local Brain and trusted knowledge.',
    version: 1,
    prompt: 'Create a concise meeting brief. Surface relevant people, project context, prior decisions, open commitments, risks, and trusted knowledge. Distinguish known facts from missing context.'
  },
  {
    id: 'meeting-follow-up',
    name: 'Meeting Follow-up',
    description: 'Turn a completed meeting into reviewable next steps and a draft follow-up.',
    version: 1,
    prompt: 'Prepare a factual follow-up from the completed meeting. Separate commitments already stated from suggested next steps. Draft text for human review; never claim that an email or CRM update was sent.'
  },
  {
    id: 'account-research',
    name: 'Account Research',
    description: 'Research a customer/project using only Oli’s local Brain and connected local sources.',
    version: 1,
    prompt: 'Research the requested account or project from local context only. Identify evidence, unresolved questions, recent decisions, stakeholders, and useful next actions. Cite source titles/ids from supplied context.'
  },
  {
    id: 'risk-review',
    name: 'Risk Review',
    description: 'Inspect local meeting intelligence for risks, blockers, compliance and decision gaps.',
    version: 1,
    prompt: 'Review the supplied meeting/context for explicit risks, blockers, compliance concerns, missing decision evidence, and unresolved commitments. Do not infer facts not present in the evidence.'
  }
];

function initSkillsStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      version INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled ON agent_skills(enabled, name);
  `);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO agent_skills(id,name,description,version,prompt,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)'
  );
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const skill of DEFAULT_SKILLS) {
      insert.run(skill.id, skill.name, skill.description, skill.version, skill.prompt, now, now);
    }
  });
  tx();
  return db;
}

function listSkills(db) {
  return db.prepare(
    'SELECT id,name,description,version,prompt,enabled,created_at,updated_at FROM agent_skills ORDER BY name'
  ).all();
}

function getSkill(db, skillId) {
  const skill = db.prepare('SELECT * FROM agent_skills WHERE id=? AND enabled=1').get(String(skillId || ''));
  if (!skill) throw new Error('Skill not found or disabled.');
  return skill;
}

function upsertSkill(db, input = {}) {
  const id = String(input.id || '').trim().slice(0, 100);
  const name = String(input.name || '').trim().slice(0, 200);
  const description = String(input.description || '').trim().slice(0, 1000);
  const prompt = String(input.prompt || '').trim().slice(0, 8000);
  const version = Math.max(1, Math.min(999, Number(input.version) || 1));
  if (!id || !name || !prompt) throw new Error('id, name and prompt are required.');
  const now = Date.now();
  db.prepare(
    'INSERT INTO agent_skills(id,name,description,version,prompt,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,version=excluded.version,prompt=excluded.prompt,enabled=1,updated_at=excluded.updated_at'
  ).run(id, name, description, version, prompt, now, now);
  return getSkill(db, id);
}

function setSkillEnabled(db, skillId, enabled) {
  const result = db.prepare('UPDATE agent_skills SET enabled=?,updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), String(skillId));
  if (!result.changes) throw new Error('Skill not found.');
  return db.prepare('SELECT id,name,description,version,prompt,enabled,created_at,updated_at FROM agent_skills WHERE id=?').get(String(skillId));
}

export { DEFAULT_SKILLS, initSkillsStore, listSkills, getSkill, upsertSkill, setSkillEnabled };
