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

1. **P0 — #217:** materialize bounded, evidence-backed topic/concept nodes so semantic reranking has real graph vocabulary instead of `graphNodesConsidered: 0`.
2. **P0 — #214:** canonicalize those derived concepts, cluster them into durable modes, preserve multi-label affinities, ground mode score changes in exact graph structure, and measure mode-supply shortfalls using the merged #162 replay/evaluation suite.
3. **P1 — #170 + #153:** graph/provenance visualization and complete per-item explanation over exact mode/node/edge contributions.
4. **P1/P2 — #154 + #155 + #178, then remaining #161/#158/#159:** correction, Forget/history controls, editable modes, graph editing, and counterfactual replay.
5. **Later — #163/#164/#165/#166:** portability, optional sync, paid-value validation, and a second connector.

PR #216 is merged. #162 now provides the measurement contract. #217 is the active semantic-graph materialization slice discovered by live validation: the real graph had thousands of content/creator nodes but no topic/concept/objective nodes.

The intended hierarchy is:

```text
evidence + interaction-supported candidate metadata
         → derived topic/concept materialization
         → canonical concepts
         → semantic neighbourhoods / durable mode clusters
         → multi-label candidate affinities
         → graph-grounded scorer contributions
         → mode-aware retrieval + existing candidate reservoir
         → stable Home presentation + exact Why-this trace
```

A visible video badge remains conservative and may show one label or none. Internal semantic classification is multi-label. User-facing modes are stable clusters over multiple canonical graph nodes rather than transient one-node labels derived from the current feed cache.

The Home replacement slider controls how much of the page MyAlgo attempts to replace. For an active mode, the same quota defines how much mode-matching supply is required. If eligible current-Home supply cannot meet that demand, MyAlgo should state the shortfall and use the existing acquired reservoir; acquired items never bypass hard policy, deterministic scoring, or traceability.

Do not fine-tune the embedding model yet. The P0 replay/evaluation fixture must first determine whether measured errors come from graph fragmentation, clustering, multi-label classification, metadata, thresholds, or the encoder itself.

Safe native-feed replacement slots remain merged via PR #205 (#160), and native-card enforcement/self-observation hardening remain complete via PR #204 (#152/#171). The audited no-YouTube-Data-API launch boundary remains enforced by CI (#168).

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.
