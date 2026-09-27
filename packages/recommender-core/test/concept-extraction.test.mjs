import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConceptExtractionPrompt,
  conceptExtractionInputHash,
  parseConceptExtractionOutput,
} from '../src/concept-extraction.ts';

test('concept extraction prompt is bounded and deterministic', () => {
  const candidate = {
    external_id: 'video-1',
    title: 'Silent Hill Townfall Full Gameplay Ending',
    description: 'A complete survival horror walkthrough with combat and puzzle sections.',
    topics: ['Silent Hill Townfall Full Gameplay', 'Horror Game', 'Review'],
    content_type: 'Gaming',
    channel_name: 'Example Creator',
  };
  const first = buildConceptExtractionPrompt(candidate);
  const second = buildConceptExtractionPrompt(candidate);

  assert.equal(second, first);
  assert.equal(conceptExtractionInputHash(candidate), conceptExtractionInputHash(candidate));
  assert.match(first, /Output exactly one comma-separated line/);
  assert.match(first, /Silent Hill Townfall Full Gameplay Ending/);
});

test('concept extraction parser is conservative and bounded', () => {
  assert.deepEqual(
    parseConceptExtractionOutput('Topics: Silent Hill, survival horror, video, gameplay video, puzzle games, Silent Hill', 4),
    ['Silent Hill', 'survival horror', 'puzzle games'],
  );

  assert.deepEqual(
    parseConceptExtractionOutput('- local LLMs\n- WebGPU inference\n- AI development\n- review', 3),
    ['local LLMs', 'WebGPU inference', 'AI development'],
  );
});

test('concept extraction parser rejects prompt echoes and malformed labels', () => {
  assert.deepEqual(
    parseConceptExtractionOutput('Title: example, Description: something, https://example.com, this phrase has far too many individual words for a compact concept label'),
    [],
  );
  assert.deepEqual(
    parseConceptExtractionOutput('YouTube video - wikipedia, List all episodes in chronological order., video video, seconds, Identify the topic of video games.'),
    [],
  );
});
