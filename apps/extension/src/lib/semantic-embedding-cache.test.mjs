import test from 'node:test';
import assert from 'node:assert/strict';

const backing = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(keys.filter((key) => backing.has(key)).map((key) => [key, backing.get(key)]));
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) backing.set(key, value);
      },
      async remove(keys) {
        for (const key of keys) backing.delete(key);
      },
    },
  },
};

const { createChromeEmbeddingCache } = await import('./semantic-embedding-cache.ts');
const { STORAGE_KEYS } = await import('./storage.ts');

const record = (id, generatedAt) => ({
  owner_type: 'content',
  owner_id: id,
  model_id: 'fixture',
  model_version: 'v1',
  input_hash: id,
  dimensions: 2,
  embedding: [1, 0],
  generated_at: generatedAt,
});

test('semantic embedding cache batches writes until flush and persists records', async () => {
  backing.clear();
  const cache = createChromeEmbeddingCache(32);
  await cache.set('a', record('a', '2026-09-26T00:00:00.000Z'));
  assert.equal(backing.has(STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE), false);

  await cache.flush();
  const persisted = backing.get(STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE);
  assert.equal(Object.keys(persisted).length, 1);
  assert.equal((await cache.get('a')).owner_id, 'a');
});

test('semantic embedding cache trims oldest entries to configured bound', async () => {
  backing.clear();
  const cache = createChromeEmbeddingCache(32);
  for (let index = 0; index < 40; index += 1) {
    await cache.set(
      `k-${index}`,
      record(`id-${index}`, `2026-09-26T00:${String(index).padStart(2, '0')}:00.000Z`),
    );
  }
  await cache.flush();

  const persisted = backing.get(STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE);
  assert.equal(Object.keys(persisted).length, 32);
  assert.equal('k-0' in persisted, false);
  assert.equal('k-39' in persisted, true);
});


test('semantic embedding cache clear removes persisted and in-memory records', async () => {
  backing.clear();
  const cache = createChromeEmbeddingCache(32);
  await cache.set('a', record('a', '2026-09-26T00:00:00.000Z'));
  await cache.flush();
  assert.equal((await cache.get('a')).owner_id, 'a');

  await cache.clear();

  assert.equal(await cache.get('a'), null);
  assert.equal(await cache.size(), 0);
  assert.equal(backing.has(STORAGE_KEYS.SEMANTIC_EMBEDDING_CACHE), false);
});
