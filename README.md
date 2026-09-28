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

1. **Complete — #221 / PR #223 canonical concepts + bounded semantic scoring:** canonical neighbourhoods, scorer-only region reconciliation, field-local lexical grounding, embedding abstention, and bounded taxonomy fallback are merged and live-validated.
2. **Complete — #214 / PR #224 durable inferred modes:** canonical concepts now reconcile into stable local mode IDs/revisions, preserve multi-label candidate affinities, survive feed-cache churn, and retain unsupported exposed modes as dormant.
3. **P0 — #214 / PR #225 graph-grounded mode scoring:** replace free-floating durable-mode boosts with bounded member contributions carrying stable mode ID/revision, canonical member identity, exact source graph nodes, and evidence provenance.
4. **P0 — #214 mode-aware retrieval/supply + replacement stability:** make mode selection change retrieval planning, measure slider-relative native-mode supply, fill shortfalls only through the existing governed reservoir, and preserve valid source→replacement bindings across ordinary reranks.
5. **P1 — #210 + #153 + #170:** recalibrate display scoring after the graph-grounded mode distribution is stable, then complete exact Why-this and graph/provenance inspection over the stable trace contract.
6. **P1/P2 — #154 + #155 + #178, then remaining #161/#158/#159:** correction, Forget/history controls, editable modes, graph editing, and counterfactual replay. #169 is now only offline/signed-out local-runtime validation.
7. **Later — #163/#164/#165/#166:** portability, optional sync, paid-value validation, and a second connector.

PR #223/#221 and PR #224 are merged and live-validated. Canonical semantic neighbourhoods now feed a durable mode catalog with stable IDs/revisions and bounded multi-label candidate affinities. PR #225 is the next #214 slice: affinity pipeline v2 preserves per-canonical-member similarity/provenance, ranking resolves the selected stable mode ID/revision, and one bounded mode budget is reconciled into exact `modeContributions` carrying canonical/source-node/evidence provenance. Mode-aware retrieval/supply and replacement stability remain subsequent #214 slices.

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

Do not mix display-score recalibration into durable-mode identity work. #221 has removed the duplicate semantic-score defect, so #210 is now unblocked, but the P0 sequence completes durable mode identity and graph-grounded mode behavior first.

Safe native-feed replacement slots remain merged via PR #205 (#160), and native-card enforcement/self-observation hardening remain complete via PR #204 (#152/#171). The audited no-YouTube-Data-API launch boundary remains enforced by CI (#168).

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.
