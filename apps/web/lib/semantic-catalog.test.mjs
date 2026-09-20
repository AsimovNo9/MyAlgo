import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFallbackConceptCatalog } from './concepts.ts';
import { loadConceptCatalog } from './semantic-catalog.ts';

function mockClient(data, error = null) {
  return {
    from() {
      return {
        select() {
          return {
            order: async () => ({ data, error }),
          };
        },
      };
    },
  };
}

test('loads the versioned database catalog when available', async () => {
  const catalog = await loadConceptCatalog(mockClient([
    {
      id: 'concept-rpg',
      canonical_name: 'RPG',
      description: null,
      aliases: ['role playing game'],
      intents: ['character progression'],
      entities: ['Baldur\'s Gate'],
      positive_phrases: ['RPG mechanics'],
      negative_phrases: ['mobile RPG ads'],
      language: 'en',
      source: 'curated',
      version: 2,
    },
  ]));

  assert.deepEqual(catalog[0], {
    id: 'concept-rpg',
    canonicalName: 'RPG',
    aliases: ['role playing game'],
    intents: ['character progression'],
    description: null,
    entities: ["Baldur's Gate"],
    positivePhrases: ['RPG mechanics'],
    negativePhrases: ['mobile RPG ads'],
    language: 'en',
    source: 'curated',
    version: 2,
  });
});

test('falls back to deterministic concepts when the database is empty or unavailable', async () => {
  const expected = buildFallbackConceptCatalog();
  assert.deepEqual(await loadConceptCatalog(null), expected);
  assert.deepEqual(await loadConceptCatalog(mockClient([], new Error('database unavailable'))), expected);
});