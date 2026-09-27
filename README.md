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

1. **P0 — #221 / PR #223 canonical concepts + bounded semantic scoring (in review):** reconcile near-duplicate verified/materialized topic nodes into deterministic canonical neighbourhoods, preserve source-node provenance, and stop semantically redundant/broad matches from stacking as independent score evidence.
2. **P0 — #214 durable inferred modes:** cluster canonical concepts into stable local mode IDs/revisions, preserve multi-label candidate affinities, and stop deriving mode identity from the current feed cache.
3. **P0 — #214 graph-grounded mode retrieval/supply:** resolve every mode score change to exact member nodes, make mode selection change retrieval planning, and measure slider-relative native-mode supply before filling from the existing acquired reservoir.
4. **P1 — #210 + #153 + #170:** recalibrate display scoring after raw semantic overcounting is fixed, then complete exact Why-this and graph/provenance inspection over the stable trace contract.
5. **P1/P2 — #154 + #155 + #178, then remaining #161/#158/#159:** correction, Forget/history controls, editable modes, graph editing, and counterfactual replay. #169 is now only offline/signed-out local-runtime validation.
6. **Later — #163/#164/#165/#166:** portability, optional sync, paid-value validation, and a second connector.

PR #220/#219 is merged. It verifies bounded metadata topic candidates with a packaged local zero-shot NLI classifier before #218's evidence-backed materializer. Live validation confirmed the verifier can run locally and abstain, but also exposed the next bottleneck: broad and near-duplicate graph nodes were scored as independent additive evidence. PR #223/#221 is the focused correction: a derived canonical-neighbourhood layer, canonical embedding matches, lexical/embedding reconciliation, exact source-node trace provenance, and fixed aggregation metrics. Durable modes remain a separate #214 slice.

The intended hierarchy is:

```text
interaction-supported candidate metadata
         → local zero-shot concept verification
         → evidence-backed topic/concept materialization
         → embedding-assisted canonical concepts
         → bounded semantic-neighbourhood score contribution
         → durable mode clusters
         → multi-label candidate affinities
         → graph-grounded mode contributions
         → mode-aware retrieval + existing candidate reservoir
         → stable Home presentation + exact Why-this trace
```

A visible video badge remains conservative and may show one label or none. Internal semantic classification is multi-label. User-facing modes are stable clusters over multiple canonical graph nodes rather than transient one-node labels derived from the current feed cache.

Do not retune display-score calibration or fine-tune a model to hide duplicate semantic evidence. First make #221 canonicalization and semantic contribution aggregation replayable against the #162 evaluation boundary; only then calibrate the presentation score or compare alternative encoders.

Safe native-feed replacement slots remain merged via PR #205 (#160), and native-card enforcement/self-observation hardening remain complete via PR #204 (#152/#171). The audited no-YouTube-Data-API launch boundary remains enforced by CI (#168).

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.
