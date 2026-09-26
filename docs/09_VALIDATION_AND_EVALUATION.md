# Validation & Evaluation

## Product validation

The first question is not whether the model is sophisticated.

It is:

> Do users find an editable explanation of their feed useful enough to return to?

## Core metrics

### Bootstrap

- history items collected
- usable metadata rate
- concept extraction rate
- initial graph size
- time to first graph

### Feed

- observed candidates
- eligible candidates
- graph-matching candidates
- replacement candidates
- empty-feed rate
- native card replacement success

### Trust

- explanation open rate
- graph edit rate
- corrections per session
- undo/reset rate
- “why” → action conversion

### Retention

- D1/D7/D14 active use
- repeated graph editing
- mode use
- return after correction

### Quality

- precision of graph matches
- false-positive rate
- per-node usefulness
- diversity
- novelty
- suppression correctness

## Evaluation strategy

Use three levels:

1. unit tests for graph/scoring invariants
2. offline replay of stored candidate/evidence batches
3. real-user validation

Do not use an overall recommendation score as the only quality metric.

## Critical invariant

For every explanation:

```text
displayed contributions == scorer contributions
```

The trace must be reproducible from the graph revision, deterministic evidence revision, candidate identity, scorer revision, and policy revision. Replaying the same inputs must reproduce the score and trace identity.

## Local runtime scoring validation (#195)

Validation now covers the complete explicit-negative feedback path in a real browser in addition to deterministic unit tests.

### Automated validation

PR #195 CI passed typecheck, lint, tests, extension build, and artifact upload. Focused runtime tests verify:

- persisted graph scoring is used by the background ranking path;
- repeated feedback events reconcile to one effective signal;
- not_interested contributes the expected -10 adjustment;
- never_show_channel resolves to the creator node and affects sibling content;
- source filters distinguish subscription and discovery candidates;
- the local policy boundary is explicit and deterministic.

### Real-browser validation

On 2026-09-26, a real YouTube Home-feed card was marked Not interested for video kDqb9IzhxjE.

Observed sequence:

YouTube Home feed
  ↓
Not interested
  ↓
personal-algorithm-local-events
  contentItemId = kDqb9IzhxjE
  eventType = not_interested
  ↓
local feed reranking
  ↓
personal-algorithm-local-traces
  candidateId = kDqb9IzhxjE
  score = -9

The feedback event was recorded at 2026-09-26T02:39:35.727Z. The subsequent local trace was recorded at 2026-09-26T02:40:48.729Z with score -9. The expected decomposition is +1 candidate content contribution and -10 explicit negative feedback.

This is stronger than a unit-only check because it verifies the browser UI action, local persistence, subsequent runtime ranking, and trace persistence as one chain.

The validation does not establish Not interested undo/reversal semantics; those are outside the current #195 acceptance scope.

## Counterfactual evaluation

Compare:

```text
baseline graph
vs
edited graph
```

on the same stored candidate set.

This avoids conflating graph changes with candidate-pool changes.


## Native-feed enforcement validation

For #152/#171, validate the browser path as a state-transition problem rather than only a visual check:

1. load Home and confirm unmatched native cards remain visible until they receive a local score;
2. confirm hard/runtime-hidden candidates stay hidden even if their numeric score would otherwise pass the threshold;
3. navigate Home → Search → Subscriptions → Shorts while an earlier rank request is in flight and verify stale results do not reapply;
4. trigger infinite-scroll/native DOM recycling and verify MyAlgo's own shelf/status/control DOM never appears in the candidate/evidence stream;
5. record explicit feedback and confirm the previous generation is invalidated and replaced by a fresh local ranking;
6. run `PERSONAL_ALGORITHM_REBUILD` and confirm active YouTube tabs invalidate stale presentation;
7. verify no synthetic replacement cards are inserted before #160.

Diagnostics must remain privacy-safe: counts, phases, and generation numbers are acceptable; titles/video IDs should not be emitted merely to diagnose stale/self-observation handling.

PR #204 completed this protocol in a live browser. Validation confirmed stable native order, zero synthetic replacements before #160, zero duplicate/orphan badges after DOM recycling, pause/reactivation recovery, mode-label consistency, stale-response rejection, graph-rebuild invalidation, and explicit-feedback reranking.

## Safe replacement validation

For #160, validate replacements as bounded presentation assignments rather than a second recommendation pipeline. Also validate that persisted source controls shape the first available Home batch promptly, including full-section removal for Shorts and Playables without creating replacement slots:

1. every replacement occupies a slot hidden by the current generation and does not reorder unrelated native siblings;
2. the replacement video ID is absent from currently present native cards, the Personal Algorithm shelf, and other replacements;
3. every replacement carries a current local trace ID, score, mode, source video ID, and slot identity;
4. no replacement is rendered for suppressed/ineligible candidates or when no qualified candidate exists;
5. a fresh generation, route/mode/source/graph invalidation, pause, or reactivation removes stale replacements before new assignments;
6. Home and Subscriptions infinite-scroll/DOM recycling do not duplicate replacements;
7. injected replacements remain excluded from observation and interaction collectors;
8. replacement cards preserve the target slot footprint, media aspect ratio, focusability, accessible label/title, and canonical YouTube destination.

Record filled and unfilled slot counts only; diagnostics must not log video titles or IDs by default.

For #210/#208 scoring validation, also verify:

1. candidate feature extraction produces deterministic objective/topic/concept/creator/format/freshness contributions from the same graph + metadata input;
2. raw additive trace totals still reconcile exactly;
3. calibrated display scores are deterministic, monotonic, and bounded to 0-100;
4. a replacement is not made unless the replacement candidate clears the configured display-score uplift;
5. replacement cards visibly retain title and creator/channel even when thumbnail metadata is null;
6. the compact `Why this?` view reports the same contribution values as the trace;
7. RSS/web-search acquisition mechanism does not itself add preference weight;
8. web-search execution is not claimed as validated until a real provider adapter exists and is live-tested.


## Long-session performance validation (#211)

Validate PR #208/#211 with sustained Home/infinite-scroll sessions, not only short functional tests:

1. `rankingWorkingSetSize` remains bounded while the persistent candidate pool grows.
2. Mutation bursts collapse into one rank request rather than one request per DOM mutation.
3. Unchanged observed candidates do not rewrite the full candidate pool inside the 30-second coalescing window.
4. Metadata enrichment never exceeds the configured two-request concurrency.
5. Rank latency is measured at small, medium, and maximum working-set sizes.
6. A 30+ minute Home session does not crash the extension or show monotonic MyAlgo-attributable renderer memory growth.
7. A slot created with a preselected replacement candidate renders that same candidate; slot creation must not fall through to zero rendered replacements because of a second independent candidate-selection pass.


### Replacement stability regression

For live replacement validation, render at least one replacement and then allow ordinary Home mutations and `yt-page-data-updated` events to occur for at least 45 seconds. The same replacement should remain present while its source card and candidate stay valid. Confirm that `yt-navigate-start`, mode changes, feedback/graph invalidation, suppression, and stability expiry correctly permit teardown/reselection.


### Overlay first-paint latency regression

Validate on a cold Home load and during active infinite scroll that badges can render before watch-page enrichment completes. Inspect `[MyAlgo] rank response` and verify `backgroundElapsedMs` reflects local ranking latency rather than network fetch time. While a rank is in flight, generate continued native DOM mutations and confirm the current response still renders, followed by at most one queued rerank. A continuously mutating page must not starve all overlay presentation.


## Web search, mode, and classification validation

Validate the search/classification slice with the following invariants:

1. Changing mode changes generated search intent while preserving the underlying graph goal.
2. Search sends only bounded normalized graph-derived terms plus mode intent; it does not send raw history rows, full graph state, explicit feedback, or scoring traces.
3. Search requires no user API key, third-party endpoint, or optional host permission; it runs only against YouTube search pages under the existing YouTube host permission.
4. YouTube search-page `ytInitialData` is parsed into bounded unique video IDs, and duplicate renderer variants are collapsed by video ID.
5. Search-page metadata is replaced/augmented by canonical watch-page enrichment before candidate scoring when enrichment is available.
6. Retrieval mechanism itself contributes no preference weight.
7. Active Learning mode alone does not produce a Learning UI label.
8. A Learning label is rendered only when the candidate classifier reports learning with the configured confidence threshold.
9. Mode-alignment score contributions appear in the deterministic trace only when candidate classification matches the mode.
10. Search/enrichment remains off the initial overlay first-paint path.
