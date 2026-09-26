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

## Working plan
1. Build the Personal Algorithm Graph and its local storage.
2. Bootstrap and observe YouTube signals with provenance.
3. Deliver the trace → edit → feed-change loop.
4. Validate the product loop before widening scope.
