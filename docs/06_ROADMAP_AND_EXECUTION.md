# Roadmap & Execution

## Phase 0 — Technical/compliance spike

**Gate before graph UX investment.**

1. Validate watch-history DOM extraction.
2. Validate live-feed candidate extraction.
3. Confirm data can remain local for MVP.
4. Document observed-data retention/deletion.
5. Verify Chrome permission scope.
6. Verify YouTube API remains display-only.

**Exit:** enough browser-observed evidence exists to construct a useful initial graph.

## Phase 1 — Local graph

1. Evidence store
2. graph nodes/edges
3. graph visualization
4. deterministic additive scorer
5. scoring trace

**Exit:** an item can be traced through the graph and score contributions exactly reproduced.

## Phase 2 — Native feed control

1. section-aware candidate detection
2. hard filtering
3. ranking
4. replacement slots
5. no self-observation of injected cards
6. infinite-scroll/navigation handling

**Exit:** MyAlgo can reliably transform a real YouTube feed without destabilizing the page.

## Phase 3 — Trust UX

1. per-item “Why am I seeing this?”
2. graph path
3. evidence provenance
4. reduce/mute/prefer/forget
5. confirmation that edits changed the next decision

**Exit:** users can understand and change a recommendation without opening a dashboard.

## Phase 4 — Graph editing

1. node editing
2. edge/path editing
3. deletion semantics
4. user-created nodes
5. graph search
6. mode overlays

## Phase 5 — Counterfactuals

Replay recent candidates under hypothetical graph versions.

## Phase 6 — Enrichment

Only after measured evidence gaps:

- transcript
- embeddings
- thumbnail vision
- bounded comment analysis
- optional LLM disambiguation

## Phase 7 — Productization

- sync
- accounts
- optional cloud services
- billing
- additional connectors

Cloud enrichment is not an MVP prerequisite.

## Explicitly deferred

- multi-platform support
- bundled large models
- microservices
- Kubernetes
- broad cloud data warehouse
- automatic cross-platform graph merging
