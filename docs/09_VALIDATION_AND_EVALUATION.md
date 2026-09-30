# Validation & Evaluation

## Product validation

The first question is not whether the model is sophisticated.

It is:

> Do users find an editable explanation of their feed useful enough to return to?

## Core metrics

### Bootstrap

- history items collected
- usable metadata rate
- concept verification/abstention rate
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
8. YouTube search-page acquisition remains score-neutral and is distinguished from downstream scoring/presentation success.


## Long-session performance validation (#211)

Validate PR #208/#211 with sustained Home/infinite-scroll sessions, not only short functional tests:

1. `rankingWorkingSetSize` remains bounded while the persistent candidate pool grows.
2. Mutation bursts collapse into one rank request rather than one request per DOM mutation.
3. Unchanged observed candidates do not rewrite the full candidate pool inside the 30-second coalescing window.
4. Metadata enrichment never exceeds the configured two-request concurrency.
5. Rank latency is measured at small, medium, and maximum working-set sizes.
6. Repeated ranks with unchanged candidate material + state/feedback/mode context reuse deterministic score/trace results; changing candidate semantic/metadata inputs invalidates only the affected candidate cache entry.
7. Candidate-score and feedback-revision caches remain bounded during a 30+ minute Home session.
8. Unchanged feed/presentation output does not rewrite the persisted rank cache; when it changes, related cache/sync/error keys are written as one storage batch.
9. A 30+ minute Home session does not crash the extension or show monotonic MyAlgo-attributable renderer memory growth.
10. A slot created with a preselected replacement candidate renders that same candidate; slot creation must not fall through to zero rendered replacements because of a second independent candidate-selection pass.
11. Scroll alone does not trigger repeated whole-page DOM discovery or replacement reselection.
12. One presentation generation shares native-card discovery and geometry between native presentation and replacement rendering.


### Replacement stability regression

Replacement stability is validity-scoped rather than time-scoped. Capture source-native-ID → replacement-candidate-ID mappings before and after ordinary in-route mutation, metadata enrichment, non-graph semantic enrichment, retrieval expansion, and manual rerank. Common valid sources must retain the same candidate with `evaluateReplacementStability(...).stabilityRate === 1`; there is no 45-second expiry requirement.

Hard boundaries—navigation, active mode, graph-changing semantic materialization, feedback/rebuild, source policy, feed-mix slider, and lifecycle/model reset—must invalidate the binding context. Candidate-level exclusion/suppression/ineligibility, threshold/native-relevance failure, exact-mode grounding loss, native duplication, or source disappearance must release the affected binding. Generation or trace changes alone are not invalidation.


### Overlay first-paint latency regression

Validate on a cold Home load and during active infinite scroll that badges can render before watch-page enrichment completes. Inspect `[MyAlgo] rank response` and verify `backgroundElapsedMs` reflects local ranking latency rather than network fetch time. The response also exposes `phaseTimings` for pool/settings hydration, cached metadata hydration, deterministic scoring, and response-context lookup, plus `cacheWarm` for the worker-local candidate/video/semantic stores.

For the #211 instant-rank slice, capture at least one cold-worker rank and three warm-worker reranks on the same Home working set. Warm reranks should reuse the bounded worker-local stores and per-candidate deterministic score cache, must preserve identical score/trace behavior, and should target the existing local-first latency budget of <=250 ms where the host/browser permits it. Cache persistence and compact trace persistence must occur after the rank response rather than extending first paint. An unchanged presentation should skip the persisted rank-cache write entirely. Inspect `scoreCache.cacheHits`, `scoreCache.cacheMisses`, and `scoreCache.cacheSize` in `[MyAlgo] rank response`: an unchanged warm working set should become hit-dominant after the first pass, while a targeted candidate metadata/semantic change should produce a miss only for the affected candidate(s).

Measure the three latency domains separately:
1. **cached presentation latency** — native Home DOM available → mode-compatible cached badges/replacements visible;
2. **fresh deterministic rank latency** — `RANK_PAGE` request → deterministic response/render;
3. **semantic convergence latency** — first valid presentation → embedding/verifier-grounded settled presentation.

Also inspect `[MyAlgo] presentation timing` for `nativeCardCount`, `candidateDiscoveryMs`, `applyRankedFeedMs`, and `replacementRenderMs`. During sustained scroll, these logs should occur only when card membership/presentation legitimately changes, not continuously for raw scroll events. Replacement targeting must not oscillate as a consequence of MyAlgo's own layout changes.

Also validate visual first paint independently of fresh scoring: after one successful Home rank, reload Home with the same active mode and confirm the mode-compatible persisted presentation cache can paint badges/replacements before the first fresh `RANK_PAGE` response. As YouTube appends/recycles Home cards, cached presentation should be coalesced into the next animation frame rather than waiting for the mutation-rank debounce.

At exactly 100% feed replacement, every eligible Home native card is a replacement target, but a selected durable mode is never diluted with unrelated generic fallback merely to satisfy the percentage. Exact durable-mode-grounded candidates are preferred first, followed by strongly relevant provisional semantic matches while re-grounding catches up. If relevant supply is still insufficient, unmatched native cards remain until automatic mode refresh/discovery finds more relevant candidates. Below 100%, durable-mode replacement remains exact-grounding-only and native mode matches continue to satisfy requested mode coverage.

While a rank is in flight, generate continued native DOM mutations and confirm the current response still renders, followed by at most one queued rerank. A continuously mutating page must not starve all overlay presentation. Neural embedding, concept verification, metadata enrichment, and retrieval remain follow-up work and must not be awaited by the first rank response.


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


### Search isolation and retention regression

For long-session validation:
1. enabling/refreshing web discovery must not prevent `RANK_PAGE` responses or remove existing badges while search is fetching/parsing;
2. search parsing runs in the offscreen dedicated worker on supported Chrome;
3. scrolling/searching for an extended session keeps candidate, metadata, History, Home exposure, selection, and evidence stores at their documented caps;
4. Home exposure evidence count follows the retained Home observation window instead of monotonically increasing;
5. evidence compaction preserves indefinite evidence and graph nodes referenced by retained evidence, edges, or user edits.


### Current search validation checkpoint

Observed live retrieval diagnostics:

```text
plansAttempted: 4
plansSucceeded: 4
fetched: 32
added: 3
deduplicated: 29
searchCandidatesInPool: 35
error: null
```

Interpretation: acquisition is working and PR #212 is merged. These diagnostics remain a regression baseline; PR #213 live testing should confirm semantic reranking does not regress downstream search-origin scoring/presentation or overlay responsiveness.

### Search-to-feed promotion diagnostics

Live rank diagnostics expose:
- `searchCandidatesScored`;
- `searchCandidatesQualified`;
- `searchCandidatesInReplacementInventory`;
- `maxSearchCandidateScore`.

A healthy search run can fetch candidates without producing replacements when none clear the score/native-quality gates. Validation should distinguish acquisition failure from ranking/presentation rejection. Retrieved-discovery exploration may fill at most two replacement opportunities and must never replace a higher-scoring native target.


## Semantic mode reranking validation

PR #213 is merged. Preserve its semantic execution/privacy invariants while #214 refines classification and presentation stability.

Required invariants:
1. the first rank response does not wait for missing embeddings;
2. semantic enrichment triggers at most one follow-up rerank when cached values actually change;
3. changing an inferred semantic mode changes mode similarity while graph similarity for unchanged candidate/graph text stays stable;
4. semantic mode similarity replaces, rather than double-counts, the legacy heuristic mode boost;
5. hard exclusions and explicit negative feedback remain authoritative;
6. embedding cache hits produce the same vectors/similarities as the original computation;
7. changing model version or candidate/node input invalidates the relevant cache entry without changing canonical graph/evidence;
8. the same model/version/input yields deterministic semantic features;
9. ranking traces expose semantic graph/mode contributions exactly;
10. no candidate gains preference weight merely because it came from search or RSS.
11. full local-data deletion clears persisted and in-memory embedding/semantic feature state, and stale in-flight semantic work cannot repopulate deleted caches;
12. upgrading to disclosure v6 requires renewed affirmative acceptance before observation/ranking resumes;
13. semantic embedding requests execute through the offscreen semantic Worker in production;
14. the production artifact contains the pinned mxbai embedding model and DeBERTa `nli-deberta-v3-xsmall` verifier/tokenizer assets plus local ONNX runtime assets; neural mode loads only packaged assets, reports readiness status, performs no model-host request at runtime, and never sends candidate text, verified concept labels, graph state, history, feedback, embeddings, or traces outside the extension;
15. mxbai embedding execution prefers WebGPU and can fall back to local WASM/hash behavior without blocking first paint; the DeBERTa verifier deliberately runs q8 WASM in its bounded asynchronous slice. Neither path may block canonical graph/evidence updates.

Compare the baseline local hash provider against the opt-in `mixedbread-ai/mxbai-embed-xsmall-v1` q8 local neural provider using the fixed replay fixture, and benchmark the DeBERTa verifier separately on its deliberate q8 WASM path. Measure rank-order agreement/quality, mode separation, first-run latency, cached latency, memory, model/package size, and multilingual behavior. Do not promote a neural model based only on benchmark reputation; validate it against MyAlgo candidate/graph data.


## Post-#213 category/mode and Home-stability validation (#214)

Live review after PR #213 exposed two distinct failure classes that must be evaluated separately.

### Category and mode inference

Use a fixed local candidate/graph fixture plus representative live examples.

Required checks:

1. candidate category vocabulary comes from eligible symbolic graph topic/concept labels rather than a fixed five-anchor taxonomy;
2. the strongest category must clear both the configured absolute similarity floor and the runner-up margin;
3. near-ties produce **no category badge** rather than forcing the least-wrong label;
4. changing the active mode does not change the candidate's category score map when candidate/graph inputs are unchanged;
5. the popup/Settings mode list contains All/Default plus persisted durable modes from the canonical graph catalog; ordinary feed-cache churn must not add/remove mode identity;
6. each exposed inferred mode has a stable local ID, integer revision, canonical member IDs/weights, source graph node provenance, creation time, last-supported time, and active/dormant state;
7. a cluster that keeps sufficient member overlap across graph snapshots reuses its prior ID and increments revision only for a meaningful mode-state change;
8. a previously exposed mode that temporarily loses cluster support becomes dormant rather than being silently deleted;
9. candidate semantic features preserve a bounded multi-label mode-affinity list with mode ID/revision, matched canonical IDs, and exact source node IDs;
10. selecting a durable mode stores the stable mode ID while the current label-based semantic seed remains a compatibility bridge until graph-grounded mode scoring/retrieval lands;
11. migration converts the known PR #213 fixed bootstrap modes to All/Default while preserving an arbitrary custom mode value; neither path may recreate the old fixed taxonomy.

Record labelled examples of obvious correct, obvious incorrect, and ambiguous cases. Do not fine-tune the embedding encoder until the replay set is large enough to show a systematic residual error after taxonomy choice, metadata enrichment, thresholds/margins, and candidate model choice have been tested.

### Home replacement stability

For one unchanged Home route/mode/feed-mix context, record source native video ID → replacement video ID mappings across at least:

- ordinary MutationObserver / `yt-page-data-updated` reranks;
- metadata-enrichment reranks;
- semantic-enrichment reranks where `conceptGraphChanged !== true`;
- retrieval-reservoir expansion;
- ordinary manual retry/rerank.

A valid mapping must remain unchanged while its source card and replacement candidate remain eligible. Rank-generation, score, trace, or presentation-metadata changes alone must not rotate equal/near-equal candidates or recreate a retained replacement DOM node.

Then deliberately trigger meaningful invalidations and confirm reselection is allowed:

- route/navigation change;
- durable mode ID/revision change;
- graph-changing semantic materialization;
- explicit feedback/rebuild;
- source-filter policy change;
- feed replacement percentage change;
- extension/model lifecycle reset;
- source native card removal;
- replacement candidate becoming native, ineligible/suppressed, below threshold/native relevance, or stale-mode grounded.

This distinguishes YouTube DOM recycling and derived-cache churn from MyAlgo-owned intent/policy changes. Diagnostics should report stable/bound counts, binding revision, and invalidation reason without logging private candidate text.


## P0: labelled semantic-mode evaluation inside PR #215 (#162)

Do not merge the semantic-mode architecture based only on live screenshots. PR #215 must carry a small reproducible labelled fixture set as a merge gate.

### Initial fixture target

Start with **50–100 real candidate examples** sampled from local MyAlgo state. Store only test-safe/exported fixture data required for replay.

For each candidate, label:
- zero, one, or multiple expected semantic categories/modes;
- obvious ambiguous/unknown cases;
- expected canonical concept aliases where relevant;
- whether the item should qualify for each tested mode;
- source class: current-Home/native vs acquired reservoir;
- expected hard-policy/feedback eligibility.

Include graph fixtures with deliberate near-duplicates such as:
- broad topic vs subtopic;
- casing/formatting aliases;
- game/product/entity plus activity variants;
- multilingual aliases where relevant.

### Metrics

Report at minimum:

- **multi-label precision / recall / F1** per mode and micro/macro aggregate;
- primary-badge precision and abstention rate;
- unknown/ambiguous false-positive rate;
- canonical-node merge/split errors;
- cluster purity / fragmentation;
- mode coverage: fraction of labelled modes represented by at least one durable cluster;
- mode stability across replayed feed-cache churn;
- native-mode supply vs requested replacement demand;
- acquired-pool shortfall fill rate;
- replacement source→candidate stability;
- WebGPU batch throughput and failure/fallback rate by configured batch size.

Do not optimize only overall accuracy. False confident category assignment and unstable mode identity are separate failure modes and must have separate measurements.

### Multi-label acceptance

A candidate can have multiple qualified mode affinities. Evaluation should treat labels as a set, not a single winner. A primary badge is scored separately from the multi-label semantic feature set.

### Mode-grounded trace acceptance

For every score change attributable to the active mode:
- the trace must identify the stable mode ID/revision;
- at least one exact contributing graph node/member must be present;
- the displayed contribution must reconcile numerically with scorer output;
- no untraceable free-floating mode similarity may alter final rank.

### Retrieval/supply acceptance

For each active mode and slider setting:
1. compute requested replacement slots;
2. compute eligible current-Home mode supply;
3. verify the shortfall banner/status fires iff native mode supply is insufficient for the requested quota;
4. verify existing RSS/search acquisition is invoked/consumed rather than a new side pool;
5. verify acquired candidates use the same policy/scorer/trace path;
6. verify light-touch slider settings trigger fewer shortfall states than strict/high-replacement settings on the same fixture.

Every shortfall event should be captured in bounded local diagnostics and replayable from the fixture.



## PR #216 replay/evaluation implementation (#162)

PR #215 is merged. PR #216 implements the first reproducible #162 measurement boundary.

Committed CI fixtures:

- `packages/recommender-core/test/fixtures/graph-replay-v2.json` — fixed test-safe exported-state graph fixture;
- `packages/recommender-core/test/fixtures/semantic-mode-eval-v1.json` — 64 labelled test-safe semantic examples with single-label, multi-label and ambiguous cases.

The replay projection compares semantic state independently of array insertion order and volatile persistence timestamps. The graph reviewer detects duplicate identities/relationships, dangling node references, stale evidence references, unsupported inferred edges, missing expected creator relationships and inferred-edge evidence coverage.

The semantic evaluator reports multi-label micro/macro precision, recall and F1, exact-set match, per-label metrics, primary-badge precision/coverage/abstention, and ambiguous false-confidence rate. The default CI evaluation now also runs #221 canonical assignment and aggregation diagnostics: source-node→neighbourhood compression, lexical/embedding overlap, contribution mass before/after reconciliation, raw-score averages, and supplied 97–100 display-saturation rates. Supporting evaluators also cover mode-supply banner/fill behavior, source→replacement stability, and inference throughput/fallback by batch size.

Run:

```bash
pnpm eval:semantic
```

The repository fixture is intentionally synthetic/test-safe. It is a deterministic regression baseline, not a claim that production user-distribution quality has been measured. Real labelled exported-state/candidate fixtures should remain local unless intentionally anonymized and reviewed before commit.

The existing extension store tests continue to exercise current-schema persistence, v1→v2 migration, unknown-schema safe reset, deterministic creator-relationship rebuild and incremental evidence consistency. PR #216 adds the source-independent replay comparison/review layer over those exported-state contracts.

See `docs/13_REPLAY_AND_SEMANTIC_EVALUATION.md` for the fixture and metric contract.


## PR #217 semantic concept materialization validation

PR #216 is merged and supplies the replay/evaluation contract. #217 validates the missing live graph layer discovered after #215.

### Automated requirements

- interaction-supported enriched topics/content types materialize deterministic inferred nodes;
- repeated title keyphrases cannot create standalone taxonomy nodes; they may only reinforce an existing metadata-derived topic;
- passive Home exposure alone cannot materialize concepts;
- acquired/search/RSS metadata alone cannot materialize concepts without retained interaction support;
- derived nodes/edges have deterministic IDs and exact retained evidence references;
- unchanged projection reconciliation does not bump graph revision;
- projection changes bump graph revision once without creating synthetic user-edit records;
- explicit graph nodes survive derived projection replacement/removal;
- proposal count and support-edge count remain bounded, with `qualifiedBeforeCap` and `droppedByCap` diagnostics exposing cap pressure;
- concept evaluation reports precision/recall/F1, unexpected/missing labels and duplicate normalized labels.

### Live acceptance

After loading a build with real retained interactions, run a semantic refresh and inspect:

```js
const result = await chrome.runtime.sendMessage({ type: 'GET_SEMANTIC_DIAGNOSTICS' });
console.log(result.conceptMaterialization);
console.log(result.diagnostics);
```

Expected progression:

```text
conceptMaterialization.interactionSupportedContentCount > 0
conceptMaterialization.materializedNodeCount > 0   // when repeated supported signals exist
semantic diagnostics graphNodesConsidered > 0
```

A user with insufficient repeated supported signals may legitimately remain at zero concepts; #217 must abstain rather than create topics from passive exposure.

Then verify graph kinds directly:

```js
const { ['personal-algorithm-state']: state } =
  await chrome.storage.local.get('personal-algorithm-state');

console.table(
  Object.entries(
    (state?.graph?.nodes ?? []).reduce((acc, node) => {
      acc[node.kind] = (acc[node.kind] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([kind, count]) => ({ kind, count }))
);
```

PR #223/#221 now evaluates canonicalization against a fixed synthetic fixture. PR #224 consumes those canonical neighbourhoods for the first durable-mode slice.

### PR #224 durable-mode validation

Automated validation must prove:
- taxonomy-only canonical concepts never become inferred preference-mode members;
- mode proposals require repeated shared content support and are deterministic across insertion order;
- stable IDs survive ordinary membership growth when member-set Jaccard clears the reconciliation threshold;
- unchanged snapshots do not bump a mode revision;
- lost support marks a mode dormant without changing its ID or last-supported timestamp;
- candidate↔mode affinities remain multi-label and preserve exact source-node provenance;
- popup/Settings controls consume the persisted durable catalog rather than deriving available modes from the current feed cache.

The initial support/Jaccard thresholds are bootstrap regression settings, not calibrated product thresholds. Live validation should inspect cluster coherence and stability before changing them.

PR #224 passed that live durability gate and is merged. PR #225 adds the next scoring gate. For a selected durable mode, validation must prove:
- only a candidate affinity matching the exact active mode ID **and revision** can affect score;
- member contributions resolve to canonical IDs and source graph nodes that still exist in the current graph;
- supporting edge evidence IDs are preserved when available;
- the member contributions reconcile exactly to the one bounded aggregate mode budget;
- the aggregate durable-mode contribution does not exceed 14 points;
- legacy heuristic mode alignment, free-floating mode-centroid similarity, and active-category mode boosts do not stack beside a durable mode;
- stale mode revisions or removed source graph nodes abstain;
- hard exclusions and explicit feedback remain authoritative;
- the produced trace samples achieve grounding and reconciliation rate 1.0 under `evaluateModeTraceGrounding`.

Live review should inspect the full mode-grounding explanation object rather than only the top-five generic contribution summary, so a lower-ranked member contribution cannot be hidden by presentation truncation.

PR #225 passed its live scoring gate and is merged. PR #226 adds the retrieval/supply gate. Validation must prove:
- `GET_RETRIEVAL_PLAN` for a durable mode returns the exact stable mode ID/revision and bounded canonical member terms, and its query set differs from Default when the fixture expects a change;
- switching durable mode revision changes retrieval-plan revision identity;
- a dormant retained mode can still change retrieval intent without creating preference evidence;
- for Home, `requestedModeSlots = replacementQuota(sliderPercent, eligibleNativeSlots)`;
- `nativeModeSupply` counts only source-filter-eligible current-Home candidates with exact current mode grounding;
- `poolModeSupply` excludes **all** current Home IDs and counts only off-page candidates that remain visible, policy-eligible, normally scored above the existing replacement threshold, and exact-mode grounded;
- `shortfall = max(0, requestedModeSlots - nativeModeSupply)` and fill attempts are bounded by `min(shortfall, poolModeSupply)`;
- fulfilled slots never exceed requested slots or native supply plus actually rendered pool replacements;
- changing acquisition mechanism (observed/RSS/search) does not add score;
- Default/All clears mode-supply diagnostics and preserves the pre-#226 general replacement behavior;
- `evaluateRetrievalModeChanges` reports the expected plan changes and `evaluateModeSupply` reports correct banner/shortfall behavior and acquired fill rate.

Live validation should capture both the stored `retrievalDiagnostics.modeSupply` snapshot and the content-script `[MyAlgo] native presentation` / `replacement slots` diagnostics so requested/native/pool/fulfilled counts can be reconciled against the DOM.

### PR #226 first live retrieval/supply checkpoint

The first real Home run validated the core exact-mode supply path for durable mode `mode:inferred:v1:5b7102b1` revision 5:

- five rendered pool replacements all exposed that exact mode ID/revision in DOM provenance;
- at a 50% slider, 28 eligible native slots produced 14 requested mode slots;
- native exact-mode supply was 1, pool exact-mode supply was 9, and shortfall was 13;
- five pool replacements rendered, so fulfilled mode coverage reconciled to 6 = 1 native + 5 pool;
- requested-slot, shortfall, and fulfilled-bound checks all evaluated true.

The same run exposed two corrective regressions before PR readiness:

1. Switching to Default correctly removed durable mode provenance from rendered replacements and `GET_RETRIEVAL_PLAN.activeMode`, but the persisted `modeSupply` snapshot could remain from the previous durable mode. Retrieval refresh and content-script diagnostics can race during a mode transition. The runtime therefore clears incompatible supply atomically with mode selection and reconciles every later retrieval/supply diagnostics write against the **current** selected mode ID/revision so an older async refresh cannot restore stale mode state.

2. The diagnostic planner contained durable canonical-member queries, but production web acquisition consumed only the first four plans. In the observed ordering those were the mode goal followed by creator lanes, so member-topic queries could be truncated before acquisition. Production selection now builds a larger bounded candidate plan set and reserves the four acquisition slots as: goal first, then one query per highest-priority durable member while available, then ordinary fallback lanes. Default retains the existing first-N planner ordering.

For follow-up live validation, inspect `GET_RETRIEVAL_PLAN.acquisitionPlans` rather than assuming the first four diagnostic `plans` are the search requests that will execute.

PR #226 subsequently passed that follow-up gate and is merged. PR #227 adds the replacement-stability gate. Validation must distinguish **soft rerank churn** from **hard invalidation**.

For a fixed Home route/mode/feed-mix context, capture the rendered source-native-ID → replacement-candidate-ID snapshot before and after each soft cause:
- mutation/page-data update;
- metadata enrichment;
- semantic enrichment with no graph change;
- retrieval-reservoir expansion;
- ordinary manual rerank.

Common source IDs must retain the same candidate ID, so `evaluateReplacementStability(before, after).stabilityRate === 1`. Score, trace ID, generation, or presentation text may legitimately change. For a retained binding, the rendered replacement element should also remain the same DOM node while its trace/score metadata is refreshed in place. Replacement-owned presentation UI (badge, title/creator/thumbnail, summary, Why-this control/panel) must remain present after the cleanup/reuse pass rather than being removed by generic native-card cleanup.

Then exercise hard invalidation independently:
- route change;
- durable mode change/revision change;
- graph-changing semantic materialization;
- explicit feedback/rebuild;
- source-filter change;
- feed-mix slider change;
- extension/model lifecycle reset.

A hard invalidation must advance the replacement binding revision and may choose a new candidate after the new policy/rank completes. One SPA navigation transition should advance the binding-context revision once: `yt-navigate-start` owns the invalidation, while the corresponding finish reranks without a second clear; a finish observed without a start may still invalidate defensively. Candidate-level invalidation must also release only the affected binding when the candidate becomes excluded/suppressed/ineligible, falls below threshold/native relevance, loses exact durable-mode grounding, becomes native on the current page, or its source card disappears.

Affected-only source-removal validation must also cover policy-created replacement slots. A candidate already prebound to its own source is not a cross-source collision: same-source ownership must remain reusable while a candidate owned by a different source stays blocked. Removing one source must not cause an unrelated surviving policy-created source to discard its incumbent merely because that source's hidden slot already advertises the incumbent candidate.

Generation changes alone are not churn. Live diagnostics should record source ID, candidate ID, rank generation, binding revision, trace ID, score, and last hard invalidation reason so identity can be compared separately from ordinary score/trace updates.

Include one retrieval-expansion case where the incumbent replacement is no longer present in the newly bounded off-page scoring working set. If its binding context is still valid, it should remain rendered from the retained stability reservoir rather than rotate solely because newer acquired candidates displaced it from that bounded working set. Conversely, if current mode demand contracts and the source is no longer rebound to a replacement slot, the old binding should disappear rather than remain latent.


## PR #220 local concept verification validation (#219)

PR #218 is merged and remains the authoritative evidence-backed materialization/reconciliation boundary. PR #220 changes how candidate topic labels are **verified**, not that boundary.

### Automated requirements

- the production build contains pinned local nli-deberta-v3-xsmall NLI q8 model/tokenizer assets as well as the existing mxbai embedding assets;
- installed runtime has `allowRemoteModels = false` and cannot fetch model files from a model host;
- deterministic verification text + bounded candidate-label construction produces the same input hash for unchanged metadata;
- generic/malformed/duplicate metadata labels are rejected before inference;
- zero-shot inference is multi-label, retains at most four labels, and can abstain with an empty verified set;
- a verified empty set must not silently fall back to raw metadata topics;
- only candidates with retained clicked/watched/saved/shared interaction evidence enter the verifier queue;
- cache identity includes verifier model ID/version + verifier-pipeline revision + input hash;
- unchanged cached inputs do not re-run verification;
- verified topic labels replace raw keyword topics for that candidate before #218 materialization;
- missing/failed verifier output may fall back to the #218 metadata path rather than fabricating concepts;
- passive exposure and search/RSS acquisition alone still cannot materialize preference concepts;
- concept verification and embedding inference share one mutually exclusive sandbox scheduler; embedding requests yield between batches and queued verifier work starts before the next embedding batch;
- candidate embedding drain cannot trigger additional verifier runs and must still reuse cached verified concepts instead of rematerializing metadata-only graph state;
- full local-data deletion removes the concept-verification cache and diagnostics;
- prior disclosure-v5 acceptance is rejected after disclosure-v6.

### Generative-model rejection

#220 produced two useful negative live results before settling on classification.

**FLAN-T5 Small q8** loaded successfully on local WASM, but the real 64-item cache contained roughly half empty outputs plus generic/prompt-like strings. **SmolLM2-135M-Instruct q8** reached both WASM and WebGPU, but 22 real cached outputs were still dominated by empty/title/prompt fragments, and a two-item WebGPU generation request could exceed five minutes.

The active design therefore does not ask a small model to invent taxonomy. It uses an NLI classifier to verify bounded metadata candidate labels. Embedding-assisted alias/canonical abstraction remains the next #214 slice.

### Direct verifier-path validation

To isolate verification from page-ranking/drain timing, PR #220 exposes a privacy-gated one-shot diagnostic request:

```js
const result = await chrome.runtime.sendMessage({
  type: 'REFRESH_CONCEPT_EXTRACTION'
});
console.log(result);

const cached = await chrome.runtime.sendMessage({
  type: 'REFRESH_CONCEPT_EXTRACTION',
  payload: { generate: false }
});
console.log(cached);
```

The first request runs one bounded verifier batch against the persisted candidate reservoir and immediately returns materialization, verifier diagnostics, and model status. The second request reuses only valid cached verified labels. This command is intended for validation/debugging, not routine UI use.

`CONCEPT_EXTRACTION_DIAGNOSTICS` retains the historical storage key for compatibility but now describes the last actual **verification** attempt. Semantic scoring/affinity passes are cache-only with respect to concept verification and do not overwrite it. The verifier is deferred until the current neural semantic working set is caught up, and it runs in a separate sandbox iframe from WebGPU embeddings; a verifier timeout must therefore not block incremental affinity reranks.

A model load/inference failure must persist `conceptModelStatus.status: "error"` with the runtime error string so a later cache-only pass cannot hide the failure.

Graph revision changes during verifier inference must not invalidate an otherwise input-valid result. Cache validity is candidate input + verifier model/pipeline identity. After inference completes, the materializer re-reads current evidence and candidate state before graph reconciliation.

### Neural scheduler fairness

A direct verifier request issued while the embedding model is in multi-batch WebGPU inference must not wait for the entire embedding request. The current embedding batch may finish, then verifier work gets priority before the next embedding batch. The scheduler never runs the two models concurrently.

Validation signal:
- embedding status may show `inference · webgpu-sandbox`;
- a direct verifier refresh transitions from `queued` to `wasm-sandbox` verifier inference before the embedding request fully drains;
- verifier execution does not time out merely because embeddings have more queued batches;
- after verifier completion, the embedding request resumes and preserves output count/order.

### Live validation

Enable local neural semantics and trigger normal semantic enrichment. Then inspect:

```js
const r = await chrome.runtime.sendMessage({ type: 'GET_SEMANTIC_DIAGNOSTICS' });
console.log(r.conceptExtraction);
console.log(r.conceptModelStatus);
console.log(r.conceptMaterialization);
console.log(r.diagnostics);
```

Healthy first-run signals include:
- `conceptExtraction.interactionSupportedCandidateCount > 0`;
- `conceptExtraction.extracted` is bounded by the per-refresh verifier slice;
- `conceptExtraction.pending` decreases over later refreshes;
- `conceptModelStatus.backend` is `wasm-sandbox`;
- `conceptExtraction.fallbackReason === null`;
- materialized verified topic nodes include `model_topic` in `sourceKinds`;
- a verifier-abstained candidate can cache `concepts: []` without raw keyword fallback.

Repeat the same semantic refresh after the cache warms. `cacheHits` should increase and unchanged candidates should not be reclassified.

### Quality comparison

Compare #218 metadata-only vs #220 verifier output on a fixed labelled/local-reviewed sample. Measure:
- verified-label precision/recall/F1;
- generic/noisy label rate;
- abstention rate;
- duplicate/fragmentation rate before canonicalization;
- verifier latency on the deliberate q8 WASM path;
- package-size and long-session memory impact.

The verifier is expected to improve precision and abstention, not solve aliases. Evaluate canonicalization separately in the next #214 slice.

### Post-merge live result and next gate

The merged verifier path completed a two-candidate q8 WASM batch in approximately 11.1 seconds with `fallbackReason: null`, cached verified results, and demonstrated an explicit empty abstention. Example retained topic sets included `Education`, `jordan peterson | peterson academy`, and several Grok-related metadata labels. The latter is a useful canonicalization fixture: several labels can all be correctly entailed while still representing one semantic neighbourhood.

A subsequent cache-only observation showed `changed: false` while the externally sampled graph revision had advanced between measurements. Code review confirmed that `reconcileDerivedGraphProjection()` does not increment graph revision on its own `changed: false` branch; background verifier/materialization work can legitimately advance the revision between two console samples. Future stability tests should therefore capture the revision immediately before and after one isolated cache-only request rather than compare against an older asynchronous generation result.

Live replacement traces also exposed semantic score overcount. Multiple related graph labels can each add independent topic/concept feature contributions, and broad concepts can stack with specific ones. The next #221/#214 replay gate must therefore measure:
- canonical neighbourhood assignment accuracy;
- number of raw source-node matches per canonical neighbourhood;
- bounded neighbourhood contribution count/value;
- overlap between legacy lexical graph features and embedding graph features for the same canonical neighbourhood;
- reduction in duplicate semantic contribution mass;
- raw-score distribution before/after canonical aggregation;
- calibrated-score saturation rate (for example, fraction of candidates at 97–100);
- trace reconciliation from the neighbourhood contribution back to every supporting source graph node.

Do not retune the 0–100 presentation calibration until this raw semantic overcount is corrected.

### PR #223 live browser regression (2026-09-27)

The first browser run of #223 confirmed healthy packaged neural execution (`mxbai-embed-xsmall-v1`, WebGPU sandbox, no fallback) but also found gaps not represented by the initial synthetic fixture:

- nested but non-identical canonical concepts such as `chill lofi`, `chill lofi beats`, and `lofi beats` could still each contribute large score terms to the same candidate;
- weak embedding neighbours could receive score mass when they were merely among the top positive matches, producing visibly unrelated semantic reasons;
- taxonomy-only matches could stack several broad categories when no specific match was present.

The corrective #223 runtime gate therefore validates three layers separately:

1. conservative canonical identity remains intact for provenance;
2. nested non-explicit canonical concepts may reconcile into one bounded **scoring region** without erasing their source nodes;
3. embedding-only matches must clear absolute + relative confidence thresholds, and taxonomy-only evidence contributes through one collective bounded fallback.

Re-run the live browser trace after these changes and require that lofi/Silent-Hill-style examples collapse to one score-region contribution with all source node IDs, unrelated weak neighbours disappear from `Why this?`, broad taxonomy no longer stacks, and hard policy/feedback behavior remains unchanged. Presentation calibration remains deferred to #210.



## Post-canonical score calibration validation (#210)

Calibration is a presentation/ranking-resolution layer; the exact additive raw score and trace remain authoritative.

For each representative Home rank batch, capture `scoreCalibration` from the `[MyAlgo] rank response` log and record:

- raw min/p25/p50/p75/p90/p95/max;
- display min/p25/p50/p75/p90/p95/max;
- display distinct-count and tie rate;
- saturation rates at >=95, >=97, and >=99;
- replacement minimum score/uplift, qualified rate, and median threshold headroom.

Validation sequence:

1. collect at least one cold-worker and three warm-worker batches on the same stable Home working set;
2. repeat in Default and at least one durable mode;
3. confirm diagnostics are deterministic when the ranked inputs are unchanged;
4. inspect ordinary-candidate saturation before changing `calibrateLocalScore()`;
5. change calibration only if the measured distribution is unnecessarily compressed/saturated;
6. after any mapping change, revalidate replacement minimum score/uplift against the same stored/replay batch;
7. raw scores, contribution reconciliation, trace IDs for unchanged scoring inputs, hard exclusions, and explicit-feedback authority must remain unchanged by a presentation-calibration change.

Do not infer success from a prettier numeric spread alone. The gate is improved usable ordering/resolution without changing the underlying Personal Algorithm semantics.

### PR #229 measured result

Representative post-canonical Home batches showed raw medians around 11 and display medians around 68, with no observed saturation at 95, 97, or 99. The existing deterministic calibration therefore remains unchanged.

The live cache validation also separated exact trace invalidation from expensive prepared candidate work. On a 295-candidate Home working set, prepared-context reuse reached 295/295 on a repeated generation and 271/295 after the next page change, while replacement bindings remained stable at 119/119 on the repeated presentation. Full score/trace cache hits may still be zero when evidence revision changes because trace provenance must refresh.

For #153 explanation validation, require:
1. every scored native card and every replacement card exposes a `Why this?` entry point;
2. the explanation shows the exact display/raw score and graph revision associated with the trace;
3. displayed contribution values are copied from the scorer trace without recomputation;
4. matched graph paths preserve node IDs, user-facing node labels, edge IDs, and evidence IDs from the trace;
5. acquisition mechanism is shown separately and explicitly not presented as preference evidence;
6. repeated presentation refreshes update the explanation for the current trace without duplicating controls or changing native card identity.



## Read-only graph inspector validation (#170)

The first #170 slice is an inspection surface, not a graph mutation path.

Validate all of the following:

1. opening/loading the live inspector does not change graph revision, evidence count, node count, edge count, or user-edit history;
2. node-kind and edge-relation summaries reconcile to the inspected snapshot;
3. explicit vs inferred provenance and evidence-support counts are visible without exposing raw storage objects as the primary UI;
4. selecting an inferred edge shows the retained supporting evidence records, including connector, mechanism, observed time, and content label;
5. search filters nodes/edges by label, kind/relation, or stable ID without mutating graph state;
6. pasted export JSON is parsed only in the Settings page and does not overwrite/persist live graph state;
7. malformed or wrong-schema pasted snapshots fail clearly and leave the previous live graph unchanged;
8. bootstrap-sized graphs remain practically navigable through bounded scroll/search lists;
9. the inspector uses current graph node/edge/evidence identifiers so #153 Why-this paths can later deep-link without identifier translation.

The first slice deliberately avoids force-directed layout, graph mutation, scoring, and preference inference. Those are separate UX/control concerns.
