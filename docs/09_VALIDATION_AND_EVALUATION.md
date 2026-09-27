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
8. YouTube search-page acquisition remains score-neutral and is distinguished from downstream scoring/presentation success.


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
14. the production artifact contains the pinned mxbai embedding model and SmolLM2-135M-Instruct concept-extraction model/tokenizer/configuration files plus local ONNX runtime assets; neural mode loads only packaged assets, reports readiness status, performs no model-host request at runtime, and never sends candidate text, extracted concepts, graph state, history, feedback, embeddings, or traces outside the extension;
15. neural execution prefers WebGPU, degrades to local WASM CPU inference when no usable GPU adapter is available, and only then degrades to the deterministic hash baseline if neural loading/inference still fails; none of these fallbacks may block first paint or canonical graph/evidence updates.

Compare the baseline local hash provider against the opt-in `mixedbread-ai/mxbai-embed-xsmall-v1` q8 local neural provider across WebGPU and WASM backends using a fixed replay fixture. Measure rank-order agreement/quality, mode separation, first-run latency, cached latency, memory, model/package size, and multilingual behavior. Do not promote a neural model based only on benchmark reputation; validate it against MyAlgo candidate/graph data.


## Post-#213 category/mode and Home-stability validation (#214)

Live review after PR #213 exposed two distinct failure classes that must be evaluated separately.

### Category and mode inference

Use a fixed local candidate/graph fixture plus representative live examples.

Required checks:

1. candidate category vocabulary comes from eligible symbolic graph topic/concept labels rather than a fixed five-anchor taxonomy;
2. the strongest category must clear both the configured absolute similarity floor and the runner-up margin;
3. near-ties produce **no category badge** rather than forcing the least-wrong label;
4. changing the active mode does not change the candidate's category score map when candidate/graph inputs are unchanged;
5. the popup/Settings mode list contains All/Default plus categories actually inferred in local feed state; it must not synthesize Work/Learning/Relax/Gaming/French merely because those labels existed in PR #213;
6. selecting a dynamic category mode still produces exact traceable mode/category-affinity contributions and bounded retrieval intent;
7. migration converts the known PR #213 fixed bootstrap modes to All/Default while preserving an arbitrary custom mode value; neither path may recreate the old fixed taxonomy.

Record labelled examples of obvious correct, obvious incorrect, and ambiguous cases. Do not fine-tune the embedding encoder until the replay set is large enough to show a systematic residual error after taxonomy choice, metadata enrichment, thresholds/margins, and candidate model choice have been tested.

### Home replacement stability

For one unchanged Home route, record source native video ID → replacement video ID mappings across at least:

- ordinary MutationObserver reranks;
- metadata-enrichment reranks;
- semantic-enrichment reranks;
- more than 45 seconds of idle/normal DOM churn.

A valid mapping must remain unchanged while its source card and replacement candidate remain eligible. Ordinary rank-generation increments must not rotate equal/near-equal candidates.

Then deliberately trigger meaningful invalidations and confirm reselection is allowed:

- route/navigation change;
- mode change;
- graph/feedback/policy change;
- feed replacement percentage change;
- source native card removal;
- replacement candidate becoming ineligible/suppressed.

This distinguishes YouTube DOM recycling from MyAlgo-owned candidate cycling. Diagnostics should report the stable/bound replacement counts without logging private candidate text.


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

The semantic evaluator reports multi-label micro/macro precision, recall and F1, exact-set match, per-label metrics, primary-badge precision/coverage/abstention, and ambiguous false-confidence rate. Supporting evaluators cover canonical assignment, mode-supply banner/fill behavior, source→replacement stability, and inference throughput/fallback by batch size.

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

Do not evaluate canonicalization or mode-cluster quality in this PR; those are the next #214 slices.


## PR #220 local concept extraction validation (#219)

PR #218 is merged and remains the authoritative evidence-backed materialization/reconciliation boundary. PR #220 changes the preferred source of topic labels, not that boundary.

### Automated requirements

- the production build contains pinned local SmolLM2-135M-Instruct q8 model/tokenizer assets as well as the existing mxbai embedding assets;
- installed runtime has `allowRemoteModels = false` and cannot fetch model files from a model host;
- deterministic prompt construction produces the same input hash for unchanged metadata;
- parser returns at most four short concepts and rejects generic, malformed, repeated and prompt-echo outputs;
- only candidates with retained clicked/watched/saved/shared interaction evidence enter the model queue;
- cache identity includes concept model ID/version + input hash;
- unchanged cached inputs do not regenerate;
- a model-backed concept list replaces raw keyword topics for that candidate before #218 materialization;
- missing/failed model output falls back to the #218 metadata path rather than fabricating concepts;
- passive exposure and search/RSS acquisition alone still cannot materialize preference concepts;
- concept and embedding inference share one mutually exclusive sandbox scheduler; embedding requests yield between batches and queued concept work must start before the next embedding batch;
- candidate embedding drain cannot trigger additional concept generations and must still reuse cached model concepts instead of rematerializing metadata-only graph state;
- full local-data deletion removes the concept extraction cache and diagnostics;
- prior disclosure-v5 acceptance is rejected after disclosure-v6.

### FLAN-T5 live rejection

The first live concept-model run used FLAN-T5 Small q8. It successfully loaded and generated locally on WASM, proving the two-model runtime path, but the 64 cached outputs were not adequate: approximately half were empty and several accepted outputs were generic/prompt-like. The model is therefore replaced in the same PR by SmolLM2-135M-Instruct q8. This is a model-quality rejection, not a runtime failure.

The same run also exposed a drain-path bug: cache-only semantic passes reported generation disabled and discarded cached concept inputs, allowing metadata-only materialization to overwrite the model-backed projection. Regression behavior now requires `cache_only` passes to reuse valid cached concepts while starting no new generations.

### Direct model-path validation

To isolate concept generation from page-ranking/drain timing, PR #220 exposes a privacy-gated one-shot diagnostic request:

```js
const result = await chrome.runtime.sendMessage({
  type: 'REFRESH_CONCEPT_EXTRACTION'
});
console.log(result);

// Validate cache-only reuse without starting another generation batch.
const cached = await chrome.runtime.sendMessage({
  type: 'REFRESH_CONCEPT_EXTRACTION',
  payload: { generate: false }
});
console.log(cached);
```

The first request runs one bounded concept-generation batch against the persisted candidate reservoir and immediately returns materialization, last-generation diagnostics, and concept-model status. The second request reuses only valid cached concepts, which is useful for checking that the embedding-drain path cannot rematerialize metadata-only graph state or increment the graph revision when the projection is unchanged. This command is intended for validation/debugging, not routine UI use.

`CONCEPT_EXTRACTION_DIAGNOSTICS` records the last actual generation attempt. Cache-only embedding-drain passes no longer overwrite it. Cache-only usage is still visible through materializer diagnostics as `modelExtractionStatus: "cache_only"`.

A model load/inference failure must persist `conceptModelStatus.status: "error"` with the runtime error string so a later cache-only pass cannot hide the failure.

Graph revision changes during a long concept-generation request must **not** invalidate that request. Concept proposals are keyed by candidate input + model/pipeline identity, not graph revision. Only privacy/local-data reset or semantic-model boundary changes cancel in-flight concept generation. Validation should allow ordinary graph updates while SmolLM2 is running and still observe the completed batch in the concept cache.

After generation completes, the materializer must re-read current evidence and the current candidate pool before graph reconciliation. A concept result whose candidate input changed while generation was running is rejected by its input hash; unchanged generated concepts remain reusable. This prevents preserving model work at the cost of reconciling an obsolete graph snapshot.

### Neural scheduler fairness

A direct concept request issued while the embedding model is in multi-batch WebGPU inference must not wait for the entire embedding request. The currently running embedding batch may finish, then the concept request gets priority before the next embedding batch. The scheduler must never run the two models concurrently.

Validation signal:
- embedding status may show `inference · webgpu-sandbox`;
- a direct concept refresh should transition from `queued` to concept model loading/inference before the embedding request fully drains;
- the concept provider must not hit its sandbox timeout solely because embeddings have more queued batches;
- after concept completion, the embedding request resumes and preserves output count/order.

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
- `conceptExtraction.extracted` between 0 and 4 on one top-level refresh;
- `conceptExtraction.pending` decreases over later refreshes;
- `conceptModelStatus.backend` is `webgpu-sandbox` or `wasm-sandbox`;
- `conceptExtraction.fallbackReason === null`;
- later materialized topic nodes include `sourceKinds: ['model_topic', ...]`.

Repeat the same semantic refresh after the cache warms. `cacheHits` should increase and unchanged candidates should not regenerate.

Disable neural semantics and verify the materializer returns to metadata-derived topics without deleting canonical evidence. Re-enable neural semantics and confirm valid cached concept outputs can be reused.

### Quality comparison

Compare #218 metadata-only vs #220 model-proposal output on a fixed labelled/local-reviewed sample. Measure:
- concept precision/recall/F1;
- generic/noisy label rate;
- normalized duplicate rate;
- fragmentation (multiple labels representing one intended concept);
- abstention/empty-output rate;
- extraction latency and WebGPU→WASM fallback rate;
- package-size and long-session memory impact.

Do not promote concept generation merely because labels look cleaner in one feed. Use #162 evaluation metrics plus live examples.

