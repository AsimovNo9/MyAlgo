# Replay and Semantic-Mode Evaluation

Issue #162 defines the reproducible evaluation boundary for the Personal Algorithm Graph and semantic mode work.

PR #216 establishes the first committed implementation.

## Purpose

Live browser review remains useful, but semantic classification and mode changes must also be measurable against fixed fixtures.

The evaluation layer is deliberately separate from preference inference:

- it does not create graph edges;
- it does not alter canonical evidence;
- it does not choose user preferences;
- it measures replay, semantic predictions, supply behavior, replacement stability, and inference performance.

## Commands

Run the normal test suite:

```bash
pnpm test
```

Run the semantic bootstrap fixture directly:

```bash
pnpm eval:semantic
```

The default command prints one JSON report containing the reference semantic provider/multi-label metrics plus the fixed #221 canonical-assignment, aggregation-mass, raw-score, and display-saturation metrics.

## Fixed fixtures

### Graph replay fixture

`packages/recommender-core/test/fixtures/graph-replay-v2.json`

This is a test-safe exported-state fixture using the current Personal Algorithm schema.

Replay projection intentionally ignores:

- array insertion order;
- node/edge `createdAt` and `updatedAt`;
- evidence `retainedAt`;
- random edit/revision IDs and their timestamps.

It preserves semantic and policy-relevant state:

- evidence identity/content/confidence/retention policy;
- graph node identity, kind, label, content, provenance, confidence, attributes;
- edge endpoints, relation, provenance, confidence, evidence support, attributes;
- user-edit action/target/before/after;
- graph revision number and reason.

The reviewer reports duplicate identities/relationships, dangling node references, stale evidence references, unsupported inferred edges, missing expected creator relationships, and evidence coverage.

### Semantic-mode fixture

`packages/recommender-core/test/fixtures/semantic-mode-eval-v1.json`

The bootstrap fixture contains 64 hand-labelled, test-safe synthetic candidate examples over eight graph topics, including multi-label and ambiguous cases.

It exists to establish:

- fixture schema;
- deterministic execution contract;
- CI metric calculation;
- regression boundaries.

It does **not** claim to represent production user-distribution quality.

## Privacy boundary for real labelled evaluation

Do not commit raw personal YouTube history/feed exports merely to improve the evaluation set.

A real local evaluation set may be built from exported state and candidate metadata on the developer machine. Before any example is committed to the repository it must be intentionally reviewed/anonymized so it contains no private history, account identifiers, or other personal data.

The repository bootstrap fixture therefore uses synthetic/test-safe examples. Real labelled local runs can use the same fixture schema without being checked into git.

## Semantic metrics

The evaluator treats internal semantics as multi-label.

Reported metrics include:

- micro precision, recall and F1;
- macro precision, recall and F1;
- exact label-set match;
- per-label precision/recall/F1;
- primary-badge precision;
- primary-badge coverage and abstention;
- false confident-badge rate on explicitly ambiguous examples.

The visible primary badge remains a separate presentation decision. A candidate can correctly retain several qualified internal semantic labels while displaying one badge or none.

## Canonicalization and aggregation metrics (#221 / PR #223)

The evaluator now runs the fixed `packages/recommender-core/test/fixtures/canonical-semantic-eval-v1.json` fixture in the default `pnpm eval:semantic` CI path.

Canonical assignment compares expected source-node/alias → canonical-ID pairs with predicted assignments and reports exact accuracy plus mismatches. The same fixture reports source-node matches vs canonical-neighbourhood matches, lexical/embedding overlap, semantic contribution mass before/after reconciliation, average raw scores, and the fraction of supplied display scores saturating at 97–100. The fixture is synthetic/test-safe and is a regression gate, not a production-distribution claim.

Browser validation adds a second, deliberately different regression layer: canonical identity may remain split while the scorer still has to reconcile nested concepts into one candidate-specific score region. Runtime tests therefore cover the live-style `chill lofi` / `chill lofi beats` / `lofi beats` case, weak relative embedding-neighbour rejection, and a single collective taxonomy fallback. This avoids weakening canonical identity merely to fix additive score overcount.

## Mode supply metrics

Mode-supply evaluation consumes:

- requested replacement slots;
- eligible native mode supply;
- eligible acquired mode supply;
- fulfilled slots;
- whether the shortfall banner/status fired.

The expected shortfall condition is deterministic:

```text
nativeMatchingSupply < requestedSlots
```

The evaluator reports banner precision/recall/accuracy and acquired shortfall fill rate.

## Replacement stability

Given two source-native-ID → replacement-candidate-ID snapshots, the evaluator reports:

- sources present in both snapshots;
- changed replacements among common sources;
- stability rate;
- exact changed mappings.

Sources that disappeared because YouTube legitimately recycled the DOM are not counted as replacement churn.

## Inference performance

Inference-run summaries can compare configured batch sizes using:

- total inputs;
- elapsed time;
- inputs/second;
- fallback rate;
- per-batch-size throughput.

These measurements are diagnostic inputs for WebGPU/WASM tuning; batch size is not part of model identity or canonical preference state.

## CI role

The committed semantic fixture currently gates:

- deterministic repeated evaluation;
- fixture size/schema;
- a bootstrap multi-label F1 floor;
- a primary-badge precision floor;
- an ambiguous false-confidence ceiling.

Those thresholds are regression guards for the reference baseline, not proof that production semantic quality is solved.

#221/PR #223 canonicalization uses this evaluation boundary. PR #224 adds deterministic durable-mode identity/stability coverage; later #214 graph-grounded scoring and mode-aware retrieval should continue using the same contracts rather than ad hoc live-only checks.


## Mode-cluster and trace metrics

The evaluation API also defines contracts for the next #214 implementation slices:

- canonical alias → canonical concept assignment accuracy;
- cluster assignment accuracy;
- predicted-cluster purity;
- expected-mode fragmentation;
- durable mode ID/member stability across snapshots using member-set Jaccard;
- active-mode trace grounding to stable mode ID/revision and exact contributing graph node IDs;
- exact reconciliation of per-member mode contributions to the aggregate mode contribution;
- whether switching a mode actually changes retrieval query plans when the fixture expects it.

PR #224 now exercises the durable-identity portion of these contracts directly. Its deterministic fixture covers canonical co-support clustering, taxonomy exclusion, ID/revision reuse across membership growth, unchanged-snapshot revision stability, dormant-mode retention, and multi-label candidate affinity provenance. The fixture also feeds the produced snapshots into `evaluateModeStability` so the implementation consumes the existing replay contract rather than introducing a parallel metric.

PR #225 implements graph-grounded mode contribution reconciliation and directly feeds runtime-produced member contributions into the existing `evaluateModeTraceGrounding` contract. Candidate affinity v2 retains per-member canonical/source-node detail; scoring emits one trace contribution per qualified canonical member and requires the member total to reconcile exactly to the bounded aggregate mode amount. Stale mode revisions and missing current graph nodes abstain.

PR #226 consumes the next two existing #162 evaluation boundaries rather than inventing live-only metrics. Durable member-driven query plans are compared with Default through `evaluateRetrievalModeChanges`; slider-relative requested/native/acquired/fulfilled snapshots use `evaluateModeSupply` for deterministic shortfall/banner accuracy and acquired fill rate. The runtime stores only the latest bounded supply snapshot. Replacement identity stability remains the next #214 slice and continues to use `evaluateReplacementStability`.

## Bootstrap reference result

The deterministic hash reference provider on `semantic-mode-eval-v1.json` currently produces:

- multi-label micro precision: 0.4103;
- recall: 1.0000;
- F1: 0.5818;
- exact set match: 0.1719;
- primary badge precision: 1.0000;
- primary badge coverage: 0.8438;
- ambiguous false-confident primary badges: 0.

This exposes the current architecture clearly: broad soft semantic membership has excessive false positives, while the stricter primary-badge gate is conservative and precise. The numbers are a baseline for #214, not a production-quality target.


## Concept materialization metrics (#217)

The merged #162 evaluator now also exposes `evaluateConceptMaterialization` for the first post-evaluation semantic graph slice.

It compares expected vs predicted `topic`/`concept` labels and reports:

- precision;
- recall;
- F1;
- missing expected concepts;
- unexpected concepts;
- duplicate normalized labels.

#217 unit fixtures separately require deterministic, order-independent projection generation and verify that passive exposure-only data cannot create semantic graph concepts.

The initial #217 materializer intentionally favors precision over coverage:
- candidate topics/content types require support from at least two interacted-with content items;
- title-only keyphrases are not eligible to create taxonomy nodes after live validation showed they dominated the vocabulary with noisy n-grams; title phrases may only reinforce existing metadata-derived topics;
- proposals are bounded to 64 nodes and 24 evidence-backed content edges per node by default.

These are bootstrap safeguards, not final taxonomy thresholds. Canonicalization is implemented in #221/PR #223 against this evaluation boundary; durable clustering remains downstream #214 work and should be measured here rather than tuned only from live screenshots.


### Live precision correction

Initial live materialization saturated the 64-node cap with 35 title-only nodes and 15 mixed candidate-topic/title nodes. Several top labels were generic or title-fragment artifacts such as `cut rope`, `all time`, and `most disturbing`.

The materializer therefore treats enriched candidate topics/content types as the taxonomy source. Title phrases are supporting evidence only. It also suppresses a candidate topic when the same normalized label already exists as a content-type concept, preventing duplicate `Music`/ `Entertainment` topic+concept pairs.

Diagnostics expose `qualifiedBeforeCap` and `droppedByCap` so cap saturation is measurable rather than hidden.


## Local concept verification comparison (#219)

PR #220 introduces a model-verification stage before #218's deterministic materializer. Evaluation should compare raw metadata topics against zero-shot-verified metadata topics under the same retained evidence fixture:

```text
A: enriched YouTube keyword/category metadata → #218 materializer
B: zero-shot-verified metadata topics          → #218 materializer
```

The graph projection, evidence gate, support thresholds and concept-materialization metrics remain the same. This isolates whether the verifier improves topic precision/abstention without crediting unrelated pipeline changes. Alias abstraction remains the next embedding-canonicalization slice.

For labelled/reviewed examples, compare:
- concept precision, recall and F1;
- unexpected/generic labels;
- normalized duplicate labels;
- fragmentation: number of labels representing one intended concept;
- over-broad merges or abstraction loss;
- empty-output/abstention rate;
- extraction cache hit rate;
- first-run and cached latency;
- WebGPU/WASM fallback rate.

The verifier output is not canonical truth. Even a correctly retained label remains a derived proposal until it is evidence-supported and passes the same #218 materializer. #221/PR #223 adds the downstream derived canonical-neighbourhood reconciliation; it does not rewrite the source graph.

### Post-#220 canonicalization/scoring fixture implementation (#221 / PR #223)

Live #220 validation produced the exact failure class encoded by the committed fixture: several verified labels can all be correct yet semantically redundant. Tutorial/use-case variants around one product/topic and gameplay/franchise variants are reconciled into derived scoring neighbourhoods while the original graph nodes remain intact.

Extend the fixed evaluation boundary with cases that assert:
- expected source-label → canonical-neighbourhood assignment;
- explicit/user-authored distinctions that must **not** merge solely from embedding similarity;
- broad content-type concepts separated from specific interest concepts;
- one bounded semantic score contribution per canonical neighbourhood;
- exact trace provenance listing the source graph nodes that reconciled into that contribution;
- unchanged canonical IDs across ordinary feed/cache churn;
- raw-score and calibrated-score distributions before/after canonical aggregation.

A successful canonicalization slice should reduce duplicate semantic contribution mass without hiding the source nodes or weakening exact trace reconciliation.
