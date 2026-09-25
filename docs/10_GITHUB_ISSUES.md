# GitHub Issues / Execution Backlog

This backlog is ordered by dependency and risk.

## P0 — Validate the data boundary

### [#156](https://github.com/AsimovNo9/MyAlgo/issues/156): Spike YouTube watch-history DOM extraction

**Why:** The current launch architecture depends on browser-observed history rather than API-derived graph bootstrap.

Acceptance criteria:

- enumerate realistic history volume
- capture stable video identity
- capture useful metadata
- handle pagination/infinite scroll
- document failure cases
- measure usable evidence yield

### [#150](https://github.com/AsimovNo9/MyAlgo/issues/150): Observe live-feed candidates and Home recommendation context — **completed**

Completed and merged in PR #180 on 2026-09-25.

Implemented:

- Home, Search, Subscriptions, Shorts, navigation, and infinite-scroll observation.
- Stable YouTube `videoId` plus contextual `exposureId`.
- Home appearances recorded as `surfaced` contextual evidence with section/position metadata.
- Document-level click, auxclick, and keyboard selection capture with source/provenance.
- Bounded local behavior-event storage.
- MyAlgo-generated UI excluded from behavioral evidence.
- Navigation and autoplay are not treated as clicks.
- Duplicate keyboard/click selections suppressed.
- Modern YouTube lockup cards supported.
- Invalidated extension contexts safely tolerated after extension reload/update.
- Live validation confirmed real selection events with stable IDs, timestamps, provenance, and exposure context across Home/Search/Subscriptions/Shorts.
- CI passed before merge.

Known limitation: some YouTube layouts still resolve to `surface: "other"` when the DOM does not expose a reliable surface container. The underlying event remains valid; this is a classification limitation rather than a selection-capture failure.

`surfaced` remains contextual evidence. #150 does not infer preference, weight clicks/watches, build graph nodes, or score candidates. Those decisions remain downstream in #174/#148/#151.

### [#174](https://github.com/AsimovNo9/MyAlgo/issues/174): Correlate surfaced recommendations with user behavior — **completed**

Implemented in the deterministic correlation layer and validated against the retained
raw event model. The layer preserves `surfaced`, `clicked`, and `watched`
events, prefers exact `exposureId` matches, never crosses video IDs, and produces
a deterministic recomputable timeline without inferring preference.

Watched evidence can come from either of two explicit sources:

- `youtube_player_telemetry` — primary live playback evidence;
- `youtube_history_dom` — bootstrap/fallback history evidence.

The correlation contract is unchanged by the temporal-watch collector. Live
validation and CI completed; the implementation remains evidence/correlation only
and does not score, rank, or infer preference. The reusable correlation primitive
is source-neutral; provider-specific behavior remains an adapter concern.

### [#183](https://github.com/AsimovNo9/MyAlgo/issues/183): Add deterministic temporal playback evidence for watched behavior — **completed**

Implemented in PR #184. The collector:

- scopes a watch session to one video/player instance;
- accumulates actual playback time;
- excludes pause, buffering, advertising, and seek jumps;
- emits at most one watched event per session;
- uses a deterministic temporal threshold;
- preserves an exact preceding `exposureId` when available;
- permits valid no-click watches with a null `exposureId`;
- keeps History as bootstrap/fallback evidence with distinct provenance.

Automated tests and real-browser validation are complete. PR #184 was merged; #183 is closed.

### [#167](https://github.com/AsimovNo9/MyAlgo/issues/167): Complete Chrome Web Store disclosure and local data-flow privacy review

### [#168](https://github.com/AsimovNo9/MyAlgo/issues/168): Audit the YouTube Data API display-only boundary

### [#187](https://github.com/AsimovNo9/MyAlgo/issues/187): Define source-neutral evidence and connector contracts — **implementation in PR #188**

Freeze the boundary between provider-specific connectors and the source-neutral recommendation domain before #148 and #151.

Implementation requirements:

- shared `ContentIdentity`, `ExposureEvidence`, `InteractionEvidence`, `ContentMetadata`, and `EvidenceProvenance` contracts;
- YouTube connector mapping for Home exposure, selection, player watch, and History fallback evidence;
- deterministic behavior correlation over normalized evidence;
- no preference inference, graph learning, scoring, or cross-source identity resolution in the connector contract.

The full contract is documented in `docs/12_SOURCE_NEUTRAL_EVIDENCE_AND_CONNECTOR_CONTRACT.md`.

## P1 — Local Personal Algorithm Graph

### [#148](https://github.com/AsimovNo9/MyAlgo/issues/148): Implement local evidence store and Personal Algorithm Graph — **implementation in PR #191**

PR #191 continues the #148 implementation with an evidence-backed graph relationship boundary.

Implemented scope:

- versioned browser-local state schema, now v2;
- normalized evidence records with confidence and retention/expiry metadata;
- content graph nodes keyed by source + external ID;
- graph nodes/edges with explicit versus inferred provenance;
- `evidenceIds` on graph edges for exact supporting-evidence provenance;
- inferred edges require at least one existing supporting evidence record;
- deleting evidence removes its edge references and removes inferred edges that would otherwise have no support;
- evidence lookup by graph edge for future explanation/replay;
- user-edit and graph-revision records;
- evidence create/read/update/delete and targeted content deletion;
- graph node/edge create/update/delete;
- reset, restart-safe initialization, and export-ready serialization;
- v1 → v2 migration preserves existing evidence/nodes and initializes legacy edge evidence references safely;
- unknown/invalid schemas reset to an empty current state;
- YouTube Home, selection, player-watch, and History observations persisted as normalized evidence while retaining existing raw compatibility stores.

Acceptance criteria:

- [x] Store evidence with source, observed time, external reference, provenance, confidence, and retention/expiry metadata.
- [x] Model graph nodes, edges, user edits, graph revisions, and explicit versus inferred provenance.
- [x] Make inferred graph edges traceable to supporting evidence records.
- [x] Remove stale inferred relationships when their supporting evidence is deleted.
- [x] Support reset, targeted evidence deletion, graph export-ready serialization, and lifecycle-safe persistence.
- [x] Keep browser-observed evidence and YouTube API account/display data separate.
- [x] Provide a versioned schema and migration strategy, including v1 → v2 preservation.
- [x] Cover create, read, update, delete, reset, restart, evidence-backed edges, and migration behavior with CI-validated tests.

Still intentionally excluded from #148:

- preference inference;
- deterministic scoring/ranking;
- cross-source identity resolution;
- feed enforcement;
- YouTube Data API graph bootstrap.

Those remain downstream work. The next graph-layer work should build semantic entities/relationships and then a separately specified preference-inference layer rather than treating every `watched` record as a preference.

### [#169](https://github.com/AsimovNo9/MyAlgo/issues/169): Move the MVP scoring path into the extension local runtime

### [#151](https://github.com/AsimovNo9/MyAlgo/issues/151): Implement deterministic additive scoring and reproducible trace

### [#170](https://github.com/AsimovNo9/MyAlgo/issues/170): Build Personal Algorithm Graph visualization

## P2 — Feed enforcement

### [#152](https://github.com/AsimovNo9/MyAlgo/issues/152): Enforce graph decisions on native YouTube cards

### [#160](https://github.com/AsimovNo9/MyAlgo/issues/160): Implement safe native-feed replacement slots

### [#171](https://github.com/AsimovNo9/MyAlgo/issues/171): Prevent self-observation and stale reranking loops

## P3 — Trust UX

### [#153](https://github.com/AsimovNo9/MyAlgo/issues/153): Build per-item “Why am I seeing this?” and trace-to-graph path

### [#154](https://github.com/AsimovNo9/MyAlgo/issues/154): Implement reduce, mute, and prefer graph controls

### [#155](https://github.com/AsimovNo9/MyAlgo/issues/155): Implement evidence provenance and Forget semantics

### [#158](https://github.com/AsimovNo9/MyAlgo/issues/158): Support user-created Personal Algorithm Graph nodes

## P4 — Graph editing

### [#161](https://github.com/AsimovNo9/MyAlgo/issues/161): Add modes as overlays over one Personal Algorithm Graph

Node and edge/path editing follow the trust UX once the core graph operations
are proven.

## P5 — Counterfactuals

### [#159](https://github.com/AsimovNo9/MyAlgo/issues/159): Implement local counterfactual replay

Replay stored candidates against hypothetical graph versions.

## P6 — Enrichment

Only after measured gaps:

- transcripts
- embeddings
- thumbnail vision
- bounded comment analysis
- optional LLM resolver

### [#162](https://github.com/AsimovNo9/MyAlgo/issues/162): Build local graph replay and evaluation suite

## P7 — Productization

- [#163](https://github.com/AsimovNo9/MyAlgo/issues/163): Personal Algorithm Graph export and import
- [#164](https://github.com/AsimovNo9/MyAlgo/issues/164): optional encrypted sync
- [#165](https://github.com/AsimovNo9/MyAlgo/issues/165): validate paid value before billing
- [#166](https://github.com/AsimovNo9/MyAlgo/issues/166): second connector after YouTube retention validation

## Compliance-specific issues

### [#168](https://github.com/AsimovNo9/MyAlgo/issues/168): YouTube API display-only boundary audit

Confirm implementation never feeds YouTube API Data into graph derivation.

### [#167](https://github.com/AsimovNo9/MyAlgo/issues/167): Chrome Web Store data-use disclosure and local data-flow privacy review

Finalize permissions, disclosures, privacy policy, retention, and deletion behavior.
