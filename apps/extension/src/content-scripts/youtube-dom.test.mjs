import test from 'node:test';
import assert from 'node:assert/strict';

import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText } from './youtube-dom.ts';
import { collectHistoryEvidence, isYouTubeHistoryPage } from './youtube-history.ts';
import { applyRecommendationOutcome, collectRecommendationObservations, isYouTubeHomePage, mergeRecommendationObservations } from './youtube-recommendations.ts';
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

test('history extraction keeps minimal visible evidence and tracks rejected rows', () => {
  const observedAt = '2026-09-24T12:00:00.000Z';
  const observation = collectHistoryEvidence([
    {
      href: '/watch?v=history-1',
      title: '  Local-first design  ',
      creator: ' MyAlgo channel ',
      historyTimestamp: 'Watched 2 days ago',
    },
    { href: '/watch?v=history-1', title: 'Duplicate row' },
    { href: '/watch?v=history-2', title: 'Injected row', injected: true },
    { href: '/watch?v=missing-title', title: ' ' },
    { href: '/@channel', title: 'Not a video' },
  ], observedAt);

  assert.deepEqual(observation.evidence, [{
    externalId: 'history-1',
    title: 'Local-first design',
    creator: 'MyAlgo channel',
    historyTimestamp: 'Watched 2 days ago',
    observedAt,
    provenance: 'youtube_history_dom',
  }]);
  assert.deepEqual(observation.metrics, {
    observedCandidates: 5,
    usableEvidence: 1,
    duplicateCandidates: 1,
    missingVideoId: 1,
    missingTitle: 1,
    injectedCandidates: 1,
    creatorPresent: 1,
    creatorCoverageRate: 1,
    durationSuffixedTitles: 0,
    placeholderTitles: 0,
  });
});

test('history observability measures creator coverage and title anomalies without changing evidence', () => {
  const observation = collectHistoryEvidence([
    { href: '/watch?v=creator-1', title: 'Normal title', creator: 'Creator A' },
    { href: '/watch?v=creator-2', title: 'Video title 5 minutes', creator: '' },
    { href: '/watch?v=creator-3', title: 'Watch', creator: null },
    { href: '/watch?v=creator-1', title: 'Duplicate with creator', creator: 'Creator A' },
  ], '2026-09-25T10:00:00.000Z');

  assert.equal(observation.evidence.length, 3);
  assert.equal(observation.metrics.creatorPresent, 1);
  assert.equal(observation.metrics.creatorCoverageRate, 0.3333);
  assert.equal(observation.metrics.durationSuffixedTitles, 1);
  assert.equal(observation.metrics.placeholderTitles, 1);
  assert.equal(observation.evidence[1].title, 'Video title 5 minutes');
  assert.equal(observation.evidence[2].title, 'Watch');
});

test('history extraction runs only on the rendered YouTube history page', () => {
  assert.equal(isYouTubeHistoryPage('/feed/history'), true);
  assert.equal(isYouTubeHistoryPage('/feed/history/'), true);
  assert.equal(isYouTubeHistoryPage('/'), false);
  assert.equal(isYouTubeHistoryPage('/feed/subscriptions'), false);
});

test('Home extraction records surfaced context without inferring preference', () => {
  const observedAt = '2026-09-24T12:00:00.000Z';
  const observation = collectRecommendationObservations([
    { href: '/watch?v=home-1', title: 'Woodworking guide', creator: 'Maker', section: 'Recommended' },
    { href: '/watch?v=home-1', title: 'Duplicate card' },
    { href: '/watch?v=injected', title: 'MyAlgo card', injected: true },
    { href: '/watch?v=missing-title', title: '' },
  ], observedAt);

  assert.deepEqual(observation.observations, [{
    externalId: 'home-1',
    title: 'Woodworking guide',
    creator: 'Maker',
    position: 0,
    section: 'Recommended',
    observedAt,
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  }]);
  assert.equal(observation.metrics.usableObservations, 1);
  assert.equal(observation.metrics.duplicateCandidates, 1);
  assert.equal(observation.metrics.injectedCandidates, 1);
  assert.equal(observation.metrics.missingTitle, 1);
});

test('Home observations become contextual outcomes only after user interaction', () => {
  const observations = collectRecommendationObservations([
    { href: '/watch?v=home-1', title: 'Woodworking guide' },
    { href: '/watch?v=home-2', title: 'Crypto news' },
  ], '2026-09-24T12:00:00.000Z').observations;

  const clicked = applyRecommendationOutcome(observations, 'home-1', 'clicked');
  const watched = applyRecommendationOutcome(clicked, 'home-1', 'watched');

  assert.equal(clicked[0].outcome, 'clicked');
  assert.equal(watched[0].outcome, 'watched');
  assert.equal(watched[1].outcome, 'unobserved');
});

test('repeated Home observation retains a correlated interaction outcome', () => {
  const first = collectRecommendationObservations([
    { href: '/watch?v=home-1', title: 'Woodworking guide' },
  ], '2026-09-24T12:00:00.000Z').observations;
  const watched = applyRecommendationOutcome(first, 'home-1', 'watched');
  const repeated = collectRecommendationObservations([
    { href: '/watch?v=home-1', title: 'Woodworking guide', section: 'Recommended' },
  ], '2026-09-25T12:00:00.000Z').observations;

  const merged = mergeRecommendationObservations(watched, repeated);

  assert.equal(merged[0].outcome, 'watched');
  assert.equal(merged[0].section, 'Recommended');
  assert.equal(merged[0].observedAt, '2026-09-25T12:00:00.000Z');
});

test('Home extraction runs only on the YouTube landing page', () => {
  assert.equal(isYouTubeHomePage('/'), true);
  assert.equal(isYouTubeHomePage(''), true);
  assert.equal(isYouTubeHomePage('/feed/history'), false);
  assert.equal(isYouTubeHomePage('/results'), false);
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
