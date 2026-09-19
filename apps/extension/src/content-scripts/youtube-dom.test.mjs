import test from 'node:test';
import assert from 'node:assert/strict';

import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText } from './youtube-dom.ts';

test('extractYouTubeVideoId handles watch URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123'), 'abc123');
  assert.equal(extractYouTubeVideoId('/watch?feature=share&v=abc123'), 'abc123');
});

test('extractYouTubeVideoId handles Shorts URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/short123?feature=share'), 'short123');
});

test('extractYouTubeVideoId ignores unrelated URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/@channel'), undefined);
  assert.equal(extractYouTubeVideoId('not a url'), undefined);
});

test('extractYouTubeLinkTitle prefers accessible title attributes', () => {
  assert.equal(extractYouTubeLinkTitle({ title: '  A video  ', ariaLabel: 'Other', textContent: 'Fallback' }), 'A video');
  assert.equal(extractYouTubeLinkTitle({ title: null, ariaLabel: 'Accessible title', textContent: 'Fallback' }), 'Accessible title');
  assert.equal(normalizeYouTubeText('  spaced\n title '), 'spaced title');
});
