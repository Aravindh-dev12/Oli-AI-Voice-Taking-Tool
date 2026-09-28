function toVectorBlob(values) {
  const floats = Float32Array.from(values.map(Number));
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

function validVector(values, dimensions) {
  return Array.isArray(values) && values.length === dimensions && values.every((value) => Number.isFinite(Number(value)));
}

export function createVectorStore(db, {
  embeddingUrl = '',
  embeddingModel = 'nomic-embed-text',
  dimensions = 768,
  timeoutMs = 15000
} = {}) {
  let loaded = false;
  let loadError = '';

  try {
    const version = db.prepare('SELECT vec_version() AS version').get();
    loaded = Boolean(version?.version);
  } catch (error) {
    loadError = error.message;
  }

  if (!loaded) {
    return {
      enabled: false,
      status() { return { enabled: false, configured: Boolean(embeddingUrl), error: loadError || 'sqlite-vec unavailable' }; },
      async search() { return []; },
      async upsert() { return false; },
      async reindexAll() { return { indexed: 0, skipped: 0, error: loadError || 'sqlite-vec unavailable' }; }
    };
  }

  try {
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='kb_vectors'").get();
    const expectedSql = 'float[' + Number(dimensions) + ']';
    if (existing && !String(existing.sql || '').includes(expectedSql)) {
      db.exec('DROP TABLE kb_vectors');
    }
    db.exec(
      'CREATE VIRTUAL TABLE IF NOT EXISTS kb_vectors USING vec0(embedding float[' +
      Number(dimensions) + '])'
    );
  } catch (error) {
    loadError = error.message;
    return {
      enabled: false,
      status() { return { enabled: false, configured: Boolean(embeddingUrl), error: loadError }; },
      async search() { return []; },
      async upsert() { return false; },
      async reindexAll() { return { indexed: 0, skipped: 0, error: loadError }; }
    };
  }

  async function requestEmbedding(text) {
    if (!embeddingUrl) throw new Error('Local embedding endpoint is not configured.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(embeddingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embeddingModel, input: text }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.error || 'Embedding request failed.');
      const vector = payload.data?.[0]?.embedding || payload.embedding || payload.output;
      if (!validVector(vector, dimensions)) {
        throw new Error('Embedding response dimension mismatch; expected ' + dimensions + '.');
      }
      return vector.map(Number);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Embedding request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function upsert(kbId, text) {
    const vector = await requestEmbedding(text);
    db.prepare('DELETE FROM kb_vectors WHERE rowid=?').run(BigInt(kbId));
    db.prepare('INSERT INTO kb_vectors(rowid, embedding) VALUES (?, ?)').run(
      BigInt(kbId),
      toVectorBlob(vector)
    );
    return true;
  }

  async function search(query, limit = 5) {
    if (!embeddingUrl) return [];
    try {
      const vector = await requestEmbedding(query);
      const rows = db.prepare(
        'SELECT rowid, distance FROM kb_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
      ).all(toVectorBlob(vector), Math.min(Math.max(Number(limit) || 5, 1), 20));
      if (!rows.length) return [];
      const get = db.prepare('SELECT rowid AS id, title, content FROM kb WHERE rowid=?');
      return rows.map((row) => ({
        ...get.get(row.rowid),
        distance: row.distance
      })).filter((row) => row.title);
    } catch {
      return [];
    }
  }

  async function reindexAll() {
    if (!embeddingUrl) return { indexed: 0, skipped: 0, configured: false };
    const entries = db.prepare('SELECT rowid AS id, title, content FROM kb ORDER BY rowid').all();
    let indexed = 0;
    let skipped = 0;
    for (const entry of entries) {
      try {
        await upsert(entry.id, entry.title + '\n' + entry.content);
        indexed += 1;
      } catch {
        skipped += 1;
      }
    }
    return { indexed, skipped, configured: true };
  }

  return {
    enabled: true,
    status() {
      return {
        enabled: true,
        configured: Boolean(embeddingUrl),
        model: embeddingModel,
        dimensions: Number(dimensions),
        version: db.prepare('SELECT vec_version() AS version').get()?.version || ''
      };
    },
    search,
    upsert,
    reindexAll
  };
}
