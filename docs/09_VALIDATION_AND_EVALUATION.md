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
