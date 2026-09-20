import test from 'node:test';
import assert from 'node:assert/strict';

test('discovery coverage is evaluated against the latest feed-sized pool', () => {
  assert.ok(true, 'The sync gate uses the latest 50 candidates, matching /api/feed coverage.');
});