import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConceptCandidateLabels,
  buildConceptVerificationInput,
  buildConceptVerificationText,
  conceptExtractionInputHash,
  selectVerifiedConcepts,
} from '../src/concept-extraction.ts';

const candidate = {
  external_id: 'video-1',
  title: 'Silent Hill Townfall Full Gameplay Ending',
  description: 'A complete survival horror walkthrough with combat and puzzle sections.',
  topics: [
    'Silent Hill Townfall',
    'Silent Hill Townfall Full Gameplay',
    'survival horror',
    'gameplay',
    'Review',
    'Silent Hill Townfall',
  ],
  content_type: 'Gaming',
  channel_name: 'Example Creator',
};

test('concept verification input is bounded and deterministic', () => {
  const first = buildConceptVerificationInput(candidate);
  const second = buildConceptVerificationInput(candidate);

  assert.deepEqual(second, first);
  assert.equal(conceptExtractionInputHash(candidate), conceptExtractionInputHash(candidate));
  assert.match(buildConceptVerificationText(candidate), /Silent Hill Townfall Full Gameplay Ending/);
  assert.deepEqual(first.labels, [
    'Silent Hill Townfall',
    'Silent Hill Townfall Full Gameplay',
    'survival horror',
  ]);
});

test('candidate labels reject generic metadata noise and duplicates', () => {
  assert.deepEqual(
    buildConceptCandidateLabels({
      external_id: 'v',
      title: 'Example',
      topics: [
        'video',
        'Review',
        'YouTube video metadata',
        'local LLMs',
        'WebGPU inference',
        'local LLMs',
        'https://example.com',
      ],
    }),
    ['local LLMs', 'WebGPU inference'],
  );
});

test('verified concepts are multi-label, thresholded, deterministic, and bounded', () => {
  assert.deepEqual(
    selectVerifiedConcepts(
      ['Silent Hill', 'survival horror', 'review', 'puzzle games', 'gaming'],
      [0.96, 0.91, 0.12, 0.68, 0.61],
      { minimumScore: 0.58, maxConcepts: 3 },
    ),
    ['Silent Hill', 'survival horror', 'puzzle games'],
  );

  assert.deepEqual(
    selectVerifiedConcepts(['alpha', 'beta'], [0.2, 0.3]),
    [],
  );
});
