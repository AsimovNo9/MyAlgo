# MyAlgo — Interactive personal algorithm editor

This repository has pivoted from the V3 local-first recommender plan to an
interactive personal algorithm editor. MyAlgo models what shapes a user's feed,
makes that model inspectable, and lets the user edit it.

## Canonical sources of truth
- [docs/README.md](docs/README.md)
- [docs/00_DECISIONS_AND_CONSISTENCY.md](docs/00_DECISIONS_AND_CONSISTENCY.md)
- [docs/01_PRODUCT_AND_STRATEGY.md](docs/01_PRODUCT_AND_STRATEGY.md)
- [docs/02_ARCHITECTURE_AND_DOMAIN_MODEL.md](docs/02_ARCHITECTURE_AND_DOMAIN_MODEL.md)
- [docs/10_GITHUB_ISSUES.md](docs/10_GITHUB_ISSUES.md)

## Current product direction
The working product model is:

- local Personal Algorithm Graph
- account and feed observation with provenance
- additive, explainable scoring and RecommendationTrace
- graph edits that visibly control the feed
- optional cloud sync, backup, billing, and managed inference only after value is proven

## Repo structure
- `apps/extension` — browser surface and connector layer
- `packages/recommender-core` — source-independent graph, preference, trace, and evaluation contracts
- `packages/shared-types` — extension-facing shared contracts
- `docs` — active product, compliance, and execution documents
- [`PRIVACY.md`](PRIVACY.md) — current local-only extension privacy policy

## Current status and next work

Implemented foundations now include:

- browser-observed YouTube evidence with source-neutral provenance;
- browser-local Personal Algorithm Graph storage and deterministic reconciliation;
- deterministic additive scoring, calibrated display scoring, and trace-backed native replacements;
- source-neutral RSS plus zero-config YouTube search-page candidate acquisition;
- mode-aware retrieval intent separated from candidate content classification;
- connector-owned acquisition/enrichment boundaries;
- offscreen Worker isolation for YouTube search-page fetch/parsing;
- bounded candidate/history/feed/evidence retention for long local sessions;
- versioned privacy disclosure, local-data deletion, and CI-enforced YouTube API/security boundaries.

Current execution order:

1. refine the merged semantic-ranking slice in #214: infer categories/modes from the Personal Algorithm Graph, leave ambiguous candidates uncategorized, and keep valid Home replacements stable across ordinary reranks;
2. establish replay/evaluation baselines for category quality, semantic model/scorer comparisons, and replacement stability (#162);
3. build graph provenance visualization and complete per-item explanation paths (#170, #153);
4. add correction/Forget/history-selection controls (#154, #155, #178);
5. continue broader mode editing, graph editing, counterfactuals, portability, sync, and additional connectors after the semantic/trust loop is stable.

PR #213 is merged. It established local neural/hash semantic enrichment, graph/mode similarities, asynchronous reranking, packaged WebGPU/WASM inference, and traceable semantic score contributions. Live review after merge exposed two refinement needs now tracked in #214: the five fixed semantic anchors were too coarse as a content taxonomy, and generation/time-based replacement rotation could make an otherwise unchanged Home feed feel unstable.

The current direction is **not to fine-tune the embedding model first**. Candidate categories are derived from candidate-to-graph topic/concept similarities with an explicit score floor and winner-margin gate, and the mode controls are populated from the categories actually inferred in local state. Model training is deferred until a labelled replay set shows systematic errors that remain after taxonomy, metadata, threshold, and model-choice evaluation.

Safe native-feed replacement slots remain merged via PR #205 (#160), and native-card enforcement/self-observation hardening remain complete via PR #204 (#152/#171). The audited no-YouTube-Data-API launch boundary remains enforced by CI (#168).

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.
