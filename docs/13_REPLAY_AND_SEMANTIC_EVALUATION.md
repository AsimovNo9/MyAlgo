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

The command prints a JSON report containing the reference provider identity plus multi-label and primary-badge metrics.

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

## Canonicalization metrics

The evaluator exposes a canonical-assignment metric for #214.

Given expected alias → canonical-ID pairs and predicted assignments, it reports exact accuracy and mismatches. This lets node canonicalization be implemented later without changing the evaluation contract.

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

Future #214 canonicalization, clustering, durable modes, graph-grounded mode scoring, and mode-aware retrieval should add their predictions to this same evaluation boundary rather than inventing new ad hoc live-only checks.
