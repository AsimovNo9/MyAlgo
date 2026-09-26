import test from 'node:test';
import assert from 'node:assert/strict';

import { extractYouTubeChannelIdFromWatchHtml, extractYouTubeCreator, extractYouTubeLinkTitle, extractYouTubeShortsTitle, extractYouTubeVideoId, normalizeYouTubeText } from './youtube-dom.ts';
import { collectHistoryEvidence, isYouTubeHistoryPage } from './youtube-history.ts';
import { applyRecommendationOutcome, collectRecommendationObservations, isYouTubeHomePage, mergeRecommendationObservations } from './youtube-recommendations.ts';
import { dedupeCandidatesById, getReplacementCandidates, getShelfCandidates, isRenderGenerationStale, shouldHideForSourceFilters } from './youtube-ux.ts';
import { youtubePageFixtures } from './youtube-fixtures.ts';
import { youtubeConnector } from '../connectors/youtube.ts';
import { createExposureId, createSelectionObservation, getSelectionFromTarget, getYouTubeSurface } from './youtube-interactions.ts';
import { correlateBehavior, getBehaviorForVideo } from './behavior-correlation.ts';

test('extractYouTubeVideoId handles watch URLs', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=abc123'), 'abc123');
  assert.equal(extractYouTubeVideoId('/watch?feature=share&v=abc123'), 'abc123');
  assert.equal(extractYouTubeVideoId('https://m.youtube.com/watch?v=mobile123&t=12'), 'mobile123');
});

test('extractYouTubeChannelIdFromWatchHtml recovers canonical channel IDs from watch HTML', () => {
  assert.equal(
    extractYouTubeChannelIdFromWatchHtml('<script>var ytInitialPlayerResponse={"videoDetails":{"channelId":"UC1234567890123456789012"}}</script>'),
    'UC1234567890123456789012',
  );
  assert.equal(
    extractYouTubeChannelIdFromWatchHtml('<meta itemprop="channelId" content="UCabcdefghijklmnopqrstuv">'),
    'UCabcdefghijklmnopqrstuv',
  );
  assert.equal(extractYouTubeChannelIdFromWatchHtml('<html>no channel id</html>'), null);
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
    historyPosition: 0,
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

  assert.equal(observation.evidence.length, 2);
  assert.equal(observation.metrics.creatorPresent, 1);
  assert.equal(observation.metrics.creatorCoverageRate, 0.5);
  assert.equal(observation.metrics.durationSuffixedTitles, 1);
  assert.equal(observation.metrics.placeholderTitles, 1);
  assert.equal(observation.evidence[1].title, 'Video title');
});

test('history extraction removes the full compound duration suffix', () => {
  const observation = collectHistoryEvidence([
    { href: '/watch?v=duration-1', title: 'Why C++ can never be replaced 5 minutes, 34 seconds', creator: 'Creator' },
  ]);

  assert.equal(observation.evidence[0].title, 'Why C++ can never be replaced');
  assert.equal(observation.metrics.durationSuffixedTitles, 1);
});

test('Shorts title extraction ignores generic Watch placeholders', () => {
  const element = {
    querySelectorAll: (selector) => selector.includes('[title]')
      ? [
          { getAttribute: (name) => name === 'title' ? 'Watch' : null, textContent: 'Watch' },
          { getAttribute: (name) => name === 'aria-label' ? 'A real Shorts title' : null, textContent: '' },
        ]
      : [],
  };

  assert.equal(extractYouTubeShortsTitle(element), 'A real Shorts title');
});

test('modern YouTube creator metadata prefers the channel aria-label', () => {
  const element = {
    querySelector: (selector) => selector.startsWith('[aria-label^="Go to channel "]')
      ? { getAttribute: () => 'Go to channel G-Worldwide TV' }
      : null,
  };

  assert.equal(extractYouTubeCreator(element), 'G-Worldwide TV');
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
    exposureId: 'home-1|home|Recommended|0',
    title: 'Woodworking guide',
    creator: 'Maker',
    position: 0,
    section: 'Recommended',
    observedAt,
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  }, {
    externalId: 'home-1',
    exposureId: 'home-1|home||1',
    title: 'Duplicate card',
    creator: null,
    position: 1,
    section: null,
    observedAt,
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  }]);
  assert.equal(observation.metrics.usableObservations, 2);
  assert.equal(observation.metrics.duplicateCandidates, 0);
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

  assert.equal(merged.length, 2);
  const watchedExposure = merged.find((item) => item.outcome === 'watched');
  const repeatedExposure = merged.find((item) => item.section === 'Recommended');
  assert.equal(watchedExposure?.section, null);
  assert.equal(watchedExposure?.observedAt, '2026-09-24T12:00:00.000Z');
  assert.equal(repeatedExposure?.section, 'Recommended');
  assert.equal(repeatedExposure?.outcome, 'unobserved');
  assert.equal(repeatedExposure?.observedAt, '2026-09-25T12:00:00.000Z');
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
    { external_id: 'a', title: 'A', score: 90, traceId: 'trace-a', policyOutcome: 'eligible' },
    { external_id: 'a', title: 'A duplicate', score: 88, traceId: 'trace-a2', policyOutcome: 'eligible' },
    { external_id: 'b', title: 'B', score: 70, traceId: 'trace-b', policyOutcome: 'eligible' },
    { external_id: 'c', title: 'C', score: 60, traceId: 'trace-c', policyOutcome: 'eligible' },
    { external_id: 'd', title: 'D', score: 30, traceId: 'trace-d', policyOutcome: 'eligible' },
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

test('selection observations keep stable video identity separate from exposure context', () => {
  assert.equal(getYouTubeSurface('/'), 'home');
  assert.equal(getYouTubeSurface('/results'), 'search');
  assert.equal(getYouTubeSurface('/feed/subscriptions'), 'subscriptions');
  assert.equal(getYouTubeSurface('/feed/subscriptions/videos'), 'subscriptions');
  assert.equal(getYouTubeSurface('/shorts/abc'), 'shorts');

  const subscriptionsCard = { closest: (selector) => selector.includes('page-subtype="subscriptions"') ? {} : null };
  const searchCard = { closest: (selector) => selector === 'ytd-search' ? {} : null };
  const homeCard = { closest: (selector) => selector.includes('page-subtype="home"') ? {} : null };
  const unknownCard = { closest: () => null };
  assert.equal(getYouTubeSurface('/some-spa-route', subscriptionsCard), 'subscriptions');
  assert.equal(getYouTubeSurface('/some-spa-route', searchCard), 'search');
  assert.equal(getYouTubeSurface('/some-spa-route', homeCard), 'home');
  assert.equal(getYouTubeSurface('/some-spa-route', unknownCard), 'other');
  assert.equal(
    createExposureId({ videoId: 'abc', surface: 'home', section: 'Recommended', position: 7 }),
    'abc|home|Recommended|7',
  );
  assert.notEqual(
    createExposureId({ videoId: 'abc', surface: 'home', section: 'Recommended', position: 7 }),
    createExposureId({ videoId: 'abc', surface: 'search', section: 'Results', position: 2 }),
  );
});

test('selection observation captures nested user selection and excludes MyAlgo UI', () => {
  globalThis.document = { querySelectorAll: () => [] };

  const link = {
    href: 'https://www.youtube.com/watch?v=selected-1',
    closest: () => null,
  };
  const target = {
    closest: (selector) => selector.includes('/watch') ? link : null,
  };
  const selection = getSelectionFromTarget(target, 'ytd-rich-item-renderer', 'home');

  assert.equal(selection.videoId, 'selected-1');
  assert.equal(selection.exposure.position, null);
  assert.equal(selection.exposure.exposureId, 'selected-1|home||');
  assert.equal(selection.source, 'card');

  const excludedTarget = {
    closest: (selector) => selector.includes('data-personal-algorithm-shelf') ? {} : null,
  };
  assert.equal(getSelectionFromTarget(excludedTarget, 'ytd-rich-item-renderer', 'home'), null);

  const observation = createSelectionObservation(selection, 'click', '2026-09-25T16:00:00.000Z');
  assert.deepEqual(observation, {
    videoId: 'selected-1',
    exposureId: 'selected-1|home||',
    kind: 'click',
    source: 'card',
    observedAt: '2026-09-25T16:00:00.000Z',
    provenance: 'youtube_user_interaction',
  });
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
  assert.equal(youtubeConnector.presentation.replacementMinimumScore, 1);
  assert.equal(youtubeConnector.presentation.replacementLimit, 6);
});

test('behavior correlation preserves surfaced, clicked, and watched as separate evidence', () => {
  const surfaced = [{
    externalId: 'A',
    exposureId: 'A|home|Recommended|7',
    title: 'A',
    creator: null,
    position: 7,
    section: 'Recommended',
    observedAt: '2026-09-25T10:00:00.000Z',
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  }];
  const interactions = [
    {
      videoId: 'A',
      exposureId: 'A|home|Recommended|7',
      kind: 'click',
      source: 'card',
      observedAt: '2026-09-25T10:01:00.000Z',
      provenance: 'youtube_user_interaction',
    },
    {
      videoId: 'A',
      exposureId: null,
      kind: 'watched',
      source: 'history',
      observedAt: '2026-09-25T10:02:00.000Z',
      provenance: 'youtube_history_dom',
    },
  ];

  const timeline = getBehaviorForVideo('A', surfaced, interactions);
  assert.equal(timeline.videoId, 'A');
  assert.equal(timeline.surfaced.length, 1);
  assert.equal(timeline.clicked.length, 1);
  assert.equal(timeline.watched.length, 1);
  assert.deepEqual(timeline.correlations.map((item) => item.kind), [
    'surfaced_clicked',
    'clicked_watched',
    'surfaced_watched',
  ]);
});

test('behavior correlation never invents a click or cross-video attribution', () => {
  const surfaced = [
    {
      externalId: 'A',
      exposureId: 'A|home|Recommended|1',
      title: 'A',
      creator: null,
      position: 1,
      section: 'Recommended',
      observedAt: '2026-09-25T10:00:00.000Z',
      provenance: 'youtube_home_dom',
      evidenceKind: 'surfaced',
      outcome: 'unobserved',
    },
    {
      externalId: 'B',
      exposureId: 'B|home|Recommended|2',
      title: 'B',
      creator: null,
      position: 2,
      section: 'Recommended',
      observedAt: '2026-09-25T10:00:00.000Z',
      provenance: 'youtube_home_dom',
      evidenceKind: 'surfaced',
      outcome: 'unobserved',
    },
  ];
  const interactions = [
    {
      videoId: 'A',
      exposureId: null,
      kind: 'watched',
      source: 'history',
      observedAt: '2026-09-25T10:01:00.000Z',
      provenance: 'youtube_history_dom',
    },
    {
      videoId: 'B',
      exposureId: 'A|home|Recommended|1',
      kind: 'click',
      source: 'card',
      observedAt: '2026-09-25T10:02:00.000Z',
      provenance: 'youtube_user_interaction',
    },
  ];

  const timelines = correlateBehavior(surfaced, interactions);
  const a = timelines.find((item) => item.videoId === 'A');
  const b = timelines.find((item) => item.videoId === 'B');
  assert.equal(a.clicked.length, 0);
  assert.equal(a.watched.length, 1);
  assert.equal(a.correlations.some((item) => item.kind === 'surfaced_clicked'), false);
  assert.equal(b.clicked.length, 1);
  assert.equal(b.correlations.some((item) => item.kind === 'surfaced_clicked'), false);
});

test('behavior correlation prefers exact exposure and falls back to video identity deterministically', () => {
  const surfaced = [
    {
      externalId: 'A',
      exposureId: 'A|home|Recommended|1',
      title: 'A',
      creator: null,
      position: 1,
      section: 'Recommended',
      observedAt: '2026-09-25T10:00:00.000Z',
      provenance: 'youtube_home_dom',
      evidenceKind: 'surfaced',
      outcome: 'unobserved',
    },
    {
      externalId: 'A',
      exposureId: 'A|home|For You|5',
      title: 'A',
      creator: null,
      position: 5,
      section: 'For You',
      observedAt: '2026-09-25T10:03:00.000Z',
      provenance: 'youtube_home_dom',
      evidenceKind: 'surfaced',
      outcome: 'unobserved',
    },
  ];
  const click = {
    videoId: 'A',
    exposureId: 'A|home|For You|5',
    kind: 'click',
    source: 'card',
    observedAt: '2026-09-25T10:04:00.000Z',
    provenance: 'youtube_user_interaction',
  };
  const fallbackClick = { ...click, exposureId: null, observedAt: '2026-09-25T10:02:00.000Z' };

  const exact = getBehaviorForVideo('A', surfaced, [click]);
  const fallback = getBehaviorForVideo('A', surfaced, [fallbackClick]);
  assert.equal(exact.correlations[0].surfacedExposureId, 'A|home|For You|5');
  assert.equal(fallback.correlations[0].surfacedExposureId, 'A|home|Recommended|1');
});

test('behavior correlation preserves repeated clicks and does not depend on ambient time', () => {
  const surfaced = [{
    externalId: 'A',
    exposureId: 'A|home|Recommended|1',
    title: 'A',
    creator: null,
    position: 1,
    section: 'Recommended',
    observedAt: '2026-09-25T10:00:00.000Z',
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  }];
  const interactions = [
    {
      videoId: 'A',
      exposureId: 'A|home|Recommended|1',
      kind: 'click',
      source: 'card',
      observedAt: '2026-09-25T10:01:00.000Z',
      provenance: 'youtube_user_interaction',
    },
    {
      videoId: 'A',
      exposureId: 'A|home|Recommended|1',
      kind: 'click',
      source: 'keyboard',
      observedAt: '2026-09-25T10:01:01.000Z',
      provenance: 'youtube_user_interaction',
    },
  ];
  const first = correlateBehavior(surfaced, interactions);
  const second = correlateBehavior(JSON.parse(JSON.stringify(surfaced)), JSON.parse(JSON.stringify(interactions)));
  assert.equal(first[0].clicked.length, 2);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('autoplay-like navigation and missing events remain absent from correlation output', () => {
  const surfaced = [{
    externalId: 'A',
    exposureId: 'A|home|Recommended|1',
    title: 'A',
    creator: null,
    position: 1,
    section: 'Recommended',
    observedAt: '2026-09-25T10:00:00.000Z',
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  }];
  const timeline = getBehaviorForVideo('A', surfaced, []);
  assert.equal(timeline.clicked.length, 0);
  assert.equal(timeline.watched.length, 0);
  assert.deepEqual(timeline.correlations, []);
});

