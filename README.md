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

Implemented and validated foundations:

- browser-observed YouTube evidence with source-neutral provenance;
- browser-local Personal Algorithm Graph storage and deterministic reconciliation;
- incremental creator relationship maintenance, validated against real exported state;
- deterministic additive scoring and local runtime trace generation;
- versioned privacy disclosure, minimized Chrome permissions, local-data deletion, and clean-profile privacy-gate validation.

Current execution order:

1. complete the YouTube Data API display-only boundary audit (#168);
2. harden native-feed enforcement and stale/self-observation behavior (#152, #171, #160);
3. expose graph provenance and per-item explanation paths (#170, #153);
4. establish replay/evaluation baselines before adding richer enrichment (#162);
5. add explicit graph controls and editing only after the explanation loop is trustworthy.

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.
