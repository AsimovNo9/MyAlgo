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

### Watch-history DOM spike protocol

The extension may observe rendered `/feed/history` rows only after the user
enables the experimental history-bootstrap setting. The spike stores only:

- stable YouTube video ID;
- visible title and creator;
- visible history timestamp when present;
- observation time and `youtube_history_dom` provenance.

Evidence remains local and is deduplicated by video ID without a silent record
cap. A user-triggered History scan scrolls until YouTube stops extending the
rendered history page; every eligible row encountered during the scan is stored.
The observer records local yield/failure counters for duplicate, injected,
missing-ID, and missing-title rows. It must never send observations to a backend.

Home is an unbounded feed rather than a finite history list. The extension stores
every unique Home card YouTube renders while the observer is enabled, plus a
user-triggered snapshot of the current Home surface. It does not claim to collect
an unknowable complete future Home feed.

Before this phase exits, run a real-browser session that scrolls a realistic
history volume and record usable-evidence yield, pagination/infinite-scroll
behavior, deleted/private/unavailable-item behavior, and selector failures.
The browser fixture tests are a regression guard, not evidence that the live DOM
is stable.

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
