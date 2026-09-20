import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContentConceptMatches } from './content-concepts.ts';

test('maps classifier topics to canonical concept IDs with bounded confidence', () => {
  const rows = buildContentConceptMatches('content-1', ['RPG', 'unrelated'], [{
    id: 'concept-rpg',
    canonicalName: 'Role-playing games',
    aliases: ['RPG'],
    intents: ['character progression'],
  }], 1.4);

  assert.deepEqual(rows, [{
    content_item_id: 'content-1',
    concept_id: 'concept-rpg',
    confidence: 1,
    source: 'deterministic',
    model_version: 'deterministic-v1',
  }]);
});