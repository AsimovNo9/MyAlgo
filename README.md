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
3. **Complete — #214 / PR #225 graph-grounded mode scoring:** durable mode score mass now resolves to exact stable mode revision, canonical members, current source graph nodes, and evidence provenance with exact trace reconciliation.
4. **Complete — #214 / PR #226 mode-aware retrieval + slider-relative supply:** stable mode members change production retrieval plans, native exact-mode supply counts against slider demand, and only measured shortfall is filled from the governed scored reservoir.
5. **Complete — #214 / PR #227 replacement stability:** valid source→replacement bindings and rendered replacement nodes survive ordinary mutation/metadata/semantic/retrieval reranks; rotation is limited to explicit hard invalidation or source/candidate invalidity.
6. **Complete — #211 / PR #228 ranking/presentation performance slice:** the warm MV3 path now uses prepared graph/lexical indexes, bounded per-candidate score reuse, batched/signature-gated persistence, compact presentation caching, shared Home DOM snapshots, and presentation-stable replacement targeting. Long-session/browser stress remains tracked in #211.
7. **Complete — #210 / PR #229 post-canonical calibration measurement:** live batches showed no 95–100 saturation, corrected effective replacement-threshold diagnostics, and validated prepared candidate-context reuse across large Home reranks; the existing deterministic display curve remains unchanged because the measurements do not justify retuning.
8. **Complete trust/graph inspection foundation — #153/#170 / PRs #230–#231:** scored native/replacement cards share exact trace-grounded Why-this; Settings has a read-only interactive graph explorer; compact explanations include symbolic paths, retained-history support, and scorer-backed provenance; durable groups are searchable, multi-select, and pinned while selected.
9. **Complete — #154 / PR #233 revisioned correction controls:** browser-validated Reduce/Prefer/Mute, exact graph-target controls, immutable pre-edit baseline, Undo, Restore original, Unmute, and sparse-explanation fallback feedback are merged.
10. **P1 — #155 evidence provenance + Forget:** make concrete evidence deletion durable across re-observation/rebuild without conflating it with graph-control Undo/Restore; wire exact retained evidence into the live provenance UI.
11. **P1 — finish #153 evidence-action integration:** direct graph correction actions are live; finish concrete evidence navigation/Forget integration against #155 semantics.
12. **P2 — #161 + #178 mode/history ownership UX:** add explicit user editing of discovered groups (rename/pin/member management/versioning) and let users choose which history clusters influence the graph/feed.
13. **P2 release hardening — #169 + #211:** finish signed-out/offline validation plus long-session/infinite-scroll/service-worker-restart stress and detached-DOM checks.
13. **P3 — #158 explicit user-created graph nodes, then #159 counterfactual replay.**
14. **Later — #163/#164/#165/#166:** portability, optional sync, paid-value validation, and a second connector.


PR #223/#221 through PR #231 are merged. Canonical semantic neighbourhoods feed durable modes whose scoring and retrieval resolve through stable mode revisions to exact graph provenance, slider-relative supply is bounded by the existing scored reservoir, and source→replacement identity survives ordinary DOM/metadata/semantic/retrieval churn. PR #228 established the bounded warm ranking/presentation path. PR #229 then measured the corrected post-canonical score distribution, found no top-end saturation that would justify changing the deterministic display curve, corrected effective replacement-threshold diagnostics, and live-validated prepared-context reuse on a 295-candidate Home working set. PR #230 extended the exact Why-this surface to native cards and carried matched symbolic graph paths/evidence support into one shared explanation renderer. PR #231 completed the read-only graph explorer and expanded the trust surface with Network/Lineage inspection, evidence drill-down, semantic/topic grouping, searchable multi-select durable groups that stay pinned while selected, scorer-backed history attribution, and lifecycle-stable body-level Why-this portals. #170 is complete; #153 remains open for direct mutation/evidence-navigation actions that depend on #154/#155 semantics.

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

Display-score calibration remains a presentation layer, not preference authority. #229 measured the post-canonical distribution after the durable-mode stack and retained the existing mapping because the observed batches showed no unnecessary 95–100 saturation.

Safe native-feed replacement slots remain merged via PR #205 (#160), and native-card enforcement/self-observation hardening remain complete via PR #204 (#152/#171). The audited no-YouTube-Data-API launch boundary remains enforced by CI (#168).

Cloud sync, billing, managed inference, multimodal enrichment, and additional connectors remain deferred until the local product loop demonstrates value.


### Graph edit safety invariant

Graph visualization now exposes revisioned #154 correction controls on live graph targets. Future user-created graph editing (#158) must preserve the same original pre-user-edit baseline before the first user mutation. Every user-authored node/edge/control change must create a versioned graph revision with reversible before/after state. Undo returns to the previous user revision; Restore original returns to the preserved baseline without deleting retained evidence. Filtering, moving, hiding, or selecting nodes in the explorer never changes recommendation state.


### Graph explorer layouts

The read-only #170 explorer supports both Network and Lineage / family-tree projections over the same canonical graph. Network is for cross-link exploration; Lineage layers content toward the leaves, creator/topic/concept nodes through the middle, and objective/user-level nodes toward the root. Neither layout creates or changes graph state. Search/mode focus can hide unrelated material entirely, and trackpad zoom is pointer-centered rather than SVG-origin-centered.


### Progressive lineage

The lineage/family-tree explorer keeps retained content leaves collapsed by default so the high-level graph remains readable. A selected/search/mode branch reveals only related content leaves; turning Focus only off restores wider high-level context without expanding unrelated content. Visible content leaves may use miniature thumbnails only from thumbnail URLs already observed and retained from YouTube; the explorer does not create a new thumbnail-fetch pipeline. Clicking a node opens its inspectable card and connected relationships, with edge selection continuing into retained evidence provenance.


### Exact Why-this from graph nodes

The graph explorer does not reconstruct recommendation reasons from adjacency. Clicking a retained content node can request the exact current local scorer explanation from the same candidate reservoir/graph/feedback/mode/semantic pipeline used by Home. The node inspector renders a compact trace subgraph from the explanation's stable node/edge IDs plus the scorer's additive contribution rows. Preference mutation controls remain deferred until revisioned undo/restore semantics are implemented.
