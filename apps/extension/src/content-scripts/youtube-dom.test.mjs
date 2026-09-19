import test from 'node:test';
import assert from 'node:assert/strict';

import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText } from './youtube-dom.ts';

test('extractYouTubeVideoId handles watch URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123'), 'abc123');
  assert.equal(extractYouTubeVideoId('/watch?feature=share&v=abc123'), 'abc123');
  assert.equal(extractYouTubeVideoId('https://m.youtube.com/watch?v=mobile123&t=12'), 'mobile123');
});

test('extractYouTubeVideoId handles Shorts URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/short123?feature=share'), 'short123');
});

test('extractYouTubeVideoId handles live, embed, and short-host URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/live/live123'), 'live123');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/embed/embed123'), 'embed123');
  assert.equal(extractYouTubeVideoId('https://youtu.be/short-host123?t=10'), 'short-host123');
});

test('extractYouTubeVideoId ignores unrelated URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/@channel'), undefined);
  assert.equal(extractYouTubeVideoId('not a url'), undefined);
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch'), undefined);
  assert.equal(extractYouTubeVideoId('https://example.com/watch?v=external'), undefined);
});

test('extractYouTubeLinkTitle prefers accessible title attributes', () => {
  assert.equal(extractYouTubeLinkTitle({ title: '  A video  ', ariaLabel: 'Other', textContent: 'Fallback' }), 'A video');
  assert.equal(extractYouTubeLinkTitle({ title: null, ariaLabel: 'Accessible title', textContent: 'Fallback' }), 'Accessible title');
  assert.equal(extractYouTubeLinkTitle({ title: '', ariaLabel: 'Accessible title', textContent: 'Fallback' }), 'Accessible title');
  assert.equal(extractYouTubeLinkTitle({ title: '  ', ariaLabel: null, textContent: '  Text fallback  ' }), 'Text fallback');
  assert.equal(extractYouTubeLinkTitle({ title: null, ariaLabel: null, textContent: null }), '');
  assert.equal(normalizeYouTubeText('  spaced\n title '), 'spaced title');
});
