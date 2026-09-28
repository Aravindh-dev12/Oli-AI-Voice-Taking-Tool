import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncKnowledge, listKnowledgeSources } from '../server/knowledge.js';
import { openDb } from '../server/db.js';

test('Markdown knowledge sync indexes, updates, and removes sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oli-kb-'));
  const root = path.join(dir, 'kb');
  fs.mkdirSync(root);
  const file = path.join(root, 'Battlecard.md');
  fs.writeFileSync(file, '# Competitor X\n\nSOC2 and pricing facts.');

  const db = openDb(path.join(dir, 'oli.db'));
  const first = syncKnowledge(db, root);
  assert.equal(first.added, 1);
  assert.equal(listKnowledgeSources(db).length, 1);

  fs.writeFileSync(file, '# Competitor X\n\nUpdated SOC2 facts.');
  const second = syncKnowledge(db, root);
  assert.equal(second.updated, 1);

  fs.unlinkSync(file);
  const third = syncKnowledge(db, root);
  assert.equal(third.removed, 1);
  db.close();
});
