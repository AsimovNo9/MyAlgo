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

1. finish live validation of PR #212 / #206 / #211: search → enrichment → scoring → bounded exploration replacement, overlay responsiveness, and retention caps;
2. finish #210 deterministic candidate-quality/replacement hardening;
3. build graph provenance visualization and complete per-item explanation paths (#170, #153);
4. establish replay/evaluation baselines (#162);
5. add rebuildable **text embeddings** for semantic retrieval/scoring (#209), with multimodal enrichment deferred until measured need;
6. add correction/Forget/history-selection controls (#154, #155, #178), then broader graph editing/counterfactual work.

PR #212 currently keeps retrieval provenance score-neutral while reserving at most two bounded exploration opportunities for qualified RSS/search candidates that clear the normal replacement score and do not score below the native target. Search work is isolated from ranking in an MV3 offscreen Worker path.

Safe native-feed replacement slots remain merged via PR #205 (#160), and native-card enforcement/self-observation hardening remain complete via PR #204 (#152/#171). The audited no-YouTube-Data-API launch boundary remains enforced by CI (#168).

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.
