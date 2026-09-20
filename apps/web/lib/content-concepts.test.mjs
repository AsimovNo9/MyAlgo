import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContentConceptMatches, persistContentConceptMatches } from './content-concepts.ts';

test('maps every approved classifier facet to one canonical concept with versioned provenance', () => {
  const rows = buildContentConceptMatches('content-1', ['RPG', 'FromSoftware', 'combat systems', 'unrelated'], [{
    id: 'concept-rpg',
    canonicalName: 'Role-playing games',
    aliases: ['RPG'],
    intents: ['character progression'],
    entities: ['FromSoftware'],
    positivePhrases: ['combat systems'],
    version: 3,
  }], 1.4);

  assert.deepEqual(rows, [{
    content_item_id: 'content-1',
    concept_id: 'concept-rpg',
    confidence: 1,
    source: 'deterministic',
    model_version: 'deterministic-v1',
    concept_version: 3,
  }]);
});

test('does not match rejected negative or unrelated catalog phrases', () => {
  const rows = buildContentConceptMatches('content-1', ['gacha', 'unrelated'], [{
    id: 'concept-rpg',
    canonicalName: 'Role-playing games',
    aliases: ['RPG'],
    intents: ['character progression'],
    negativePhrases: ['gacha'],
  }], 0.8);

  assert.deepEqual(rows, []);
});

test('persists concept matches idempotently by content and concept IDs', async () => {
  let request = null;
  const client = {
    from(table) {
      assert.equal(table, 'content_concepts');
      return {
        upsert(rows, options) {
          request = { rows, options };
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await persistContentConceptMatches(client, [{
    content_item_id: 'content-1',
    concept_id: '123e4567-e89b-12d3-a456-426614174000',
    confidence: 0.8,
    source: 'deterministic',
    model_version: 'deterministic-v1',
    concept_version: 3,
  }]);

  assert.deepEqual(request, {
    rows: [{
      content_item_id: 'content-1',
      concept_id: '123e4567-e89b-12d3-a456-426614174000',
      confidence: 0.8,
      source: 'deterministic',
      model_version: 'deterministic-v1',
      concept_version: 3,
    }],
    options: { onConflict: 'content_item_id,concept_id' },
  });
});