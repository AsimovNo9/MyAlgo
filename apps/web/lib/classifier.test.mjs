import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyContent } from './classifier.ts';

test('classifyContent keeps deterministic topic matches local', async () => {
  const classification = await classifyContent('A practical tutorial for building AI agents');

  assert.ok(classification.topics.includes('AI'));
  assert.ok(classification.topics.includes('Tutorial'));
  assert.equal(classification.format, 'tutorial');
  assert.equal(classification.language, null);
});

test('classifyContent detects known script languages without treating Latin content as English', async () => {
  const classification = await classifyContent('最新のゲーム review');

  assert.equal(classification.language, 'ja');
  assert.equal(classification.format, 'review');
});

test('classifyContent falls back to General when semantic AI is not configured', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const classification = await classifyContent('A mysterious title about orbital mechanics');

    assert.deepEqual(classification.topics, ['General']);
    assert.equal(classification.content_type, 'general');
  } finally {
    if (previousKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }
});
