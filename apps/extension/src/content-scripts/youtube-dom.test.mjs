import test from 'node:test';
import assert from 'node:assert/strict';

import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText } from './youtube-dom.ts';
import { dedupeCandidatesById, getReplacementCandidates, getShelfCandidates, isRenderGenerationStale, shouldHideForSourceFilters } from './youtube-ux.ts';
import { youtubePageFixtures } from './youtube-fixtures.ts';
import { youtubeConnector } from '../connectors/youtube.ts';

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

test('representative YouTube surfaces expose stable video IDs and titles', () => {
  for (const fixture of youtubePageFixtures) {
    assert.equal(extractYouTubeVideoId(fixture.href), fixture.expectedId);
    assert.equal(extractYouTubeLinkTitle({ title: fixture.title }), fixture.title);
  }
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

test('deduplication keeps the first valid candidate per video ID', () => {
  const candidates = [
    { external_id: 'abc', title: 'First', channel_name: 'A' },
    { external_id: 'abc', title: 'Duplicate', channel_name: 'B' },
    { external_id: 'def', title: 'Second', channel_name: 'C' },
    { external_id: '', title: 'No id', channel_name: 'D' },
  ];

  assert.deepEqual(dedupeCandidatesById(candidates).map((item) => item.external_id), ['abc', 'def']);
});

test('personal shelf and replacement feed use bounded unique IDs only', () => {
  const items = [
    { external_id: 'a', title: 'A', score: 90 },
    { external_id: 'a', title: 'A duplicate', score: 88 },
    { external_id: 'b', title: 'B', score: 70 },
    { external_id: 'c', title: 'C', score: 60 },
    { external_id: 'd', title: 'D', score: 30 },
  ];

  assert.deepEqual(getShelfCandidates(items, 6).map((item) => item.external_id), ['a', 'b', 'c']);
  assert.deepEqual(getShelfCandidates(items, 6, ['a']).map((item) => item.external_id), ['b', 'c']);
  assert.deepEqual(getReplacementCandidates(items, ['a', 'b'], 6).map((item) => item.external_id), ['c']);
});

test('render generation detects stale responses', () => {
  assert.equal(isRenderGenerationStale(1, 2), true);
  assert.equal(isRenderGenerationStale(2, 2), false);
});

test('source filters hide only disabled provider formats', () => {
  assert.equal(shouldHideForSourceFilters({ is_short: true }, { includeShorts: false }), true);
  assert.equal(shouldHideForSourceFilters({ is_short: true }, { includeShorts: true }), false);
  assert.equal(shouldHideForSourceFilters({ is_live: true }, { includeLive: false }), true);
  assert.equal(shouldHideForSourceFilters({}, { includeShorts: false, includeLive: false }), false);
});

test('YouTube connector declares bounded presentation and normalized provider behavior', () => {
  assert.equal(youtubeConnector.id, 'youtube');
  assert.equal(youtubeConnector.capabilities.activity, true);
  assert.equal(youtubeConnector.capabilities.writeActions, false);
  assert.equal(youtubeConnector.canHandleUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(youtubeConnector.canHandleUrl('https://example.com/watch?v=abc'), false);
  assert.equal(youtubeConnector.getExternalId('/shorts/abc'), 'abc');
  assert.equal(youtubeConnector.getCanonicalUrl('a b'), 'https://www.youtube.com/watch?v=a%20b');
  assert.deepEqual(youtubeConnector.getSourceFlags('/shorts/abc'), { is_short: true, is_live: false });
  assert.equal(youtubeConnector.pageUrlPatterns.includes('https://www.youtube.com/*'), true);
  assert.equal(youtubeConnector.presentation.shelfBatchSize <= youtubeConnector.presentation.shelfDomLimit, true);
  assert.equal(youtubeConnector.presentation.horizontalAspectRatio, '16 / 9');
});
