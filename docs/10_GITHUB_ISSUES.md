# GitHub Issues / Execution Backlog

This backlog is ordered by dependency and risk. Historical P-labels in issue titles are retained for continuity; the current execution order below is authoritative when it differs from those labels.

## Current execution order

1. #168 — YouTube Data API display-only boundary audit.
2. #152 + #171 — native-card enforcement plus self-observation/stale-render hardening.
3. #160 — safe replacement slots.
4. #170 + #153 — graph provenance/visualization and per-item trace explanation.
5. #162 — replay/evaluation baselines before richer enrichment.
6. #154 + #155 + #178 — correction controls, Forget/provenance, and shared-history selection.
7. #169 — discharge remaining local-runtime umbrella criteria.
8. #161 + #158 + #159 — modes, explicit graph creation/editing, and counterfactual replay.
9. #163/#164/#165/#166 — portability, optional sync, paid-value validation, and a second connector.

## P0 — Validate the data boundary

### [#156](https://github.com/AsimovNo9/MyAlgo/issues/156): Spike YouTube watch-history DOM extraction — **completed**

The live-browser spike established that modern History cards expose usable creator/title metadata, repeated scans can be reconciled by stable video identity, and the original creator-coverage gap was primarily an extraction/selector problem. #156 is closed; shared-history attribution remains separately tracked in #178.

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

### [#167](https://github.com/AsimovNo9/MyAlgo/issues/167): Complete Chrome Web Store disclosure and local data-flow privacy review — **PR #199 merged; local browser validation complete**

Implemented and validated:

- versioned affirmative disclosure before observation/ranking;
- content/background guards before acceptance;
- full local-data deletion and re-acceptance requirement;
- HTTPS-only YouTube host matching plus `storage`;
- implementation-matched privacy policy/data inventory;
- built-artifact secret scan;
- clean-profile validation of pre-acceptance blocking, acceptance → observation, and deletion → disabled observation.

#167 stays open only for Store-facing release work: publish/verify the stable privacy-policy URL, reconcile the final Store listing/Privacy practices fields, and complete #168.

### [#168](https://github.com/AsimovNo9/MyAlgo/issues/168): Audit the YouTube Data API display-only boundary — **audit implemented; current launch runtime has no Data API integration**

### [#187](https://github.com/AsimovNo9/MyAlgo/issues/187): Define source-neutral evidence and connector contracts — **completed in PR #188**

Freeze the boundary between provider-specific connectors and the source-neutral recommendation domain before #148 and #151.

Implementation requirements:

- shared `ContentIdentity`, `ExposureEvidence`, `InteractionEvidence`, `ContentMetadata`, and `EvidenceProvenance` contracts;
- YouTube connector mapping for Home exposure, selection, player watch, and History fallback evidence;
- deterministic behavior correlation over normalized evidence;
- no preference inference, graph learning, scoring, or cross-source identity resolution in the connector contract.

The full contract is documented in `docs/12_SOURCE_NEUTRAL_EVIDENCE_AND_CONNECTOR_CONTRACT.md`.

## P1 — Local Personal Algorithm Graph

### [#148](https://github.com/AsimovNo9/MyAlgo/issues/148): Implement local evidence store and Personal Algorithm Graph — **completed in PR #191**

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
- deterministic semantic graph materialization from retained evidence for creator relationships;
- incremental evidence ingestion maintains creator nodes and `created_by` edges immediately when creator metadata is present, merging supporting `evidenceIds` without duplicate edges;
- full graph rebuild remains a deterministic reconciliation/recovery path for existing state;
- deterministic graph-review summary for node/edge counts, semantic kinds/relations, and evidence-support coverage;
- reset, restart-safe initialization, and export-ready serialization (`exportState()` / JSON);
- v1 → v2 migration preserves existing evidence/nodes and initializes legacy edge evidence references safely;
- unknown/invalid schemas reset to an empty current state;
- YouTube Home, selection, player-watch, and History observations persisted as normalized evidence while retaining existing raw compatibility stores.
- History scans reconciled by stable video identity, preserving newest-to-oldest DOM order as relative recency and preventing repeated scans from creating duplicate History watch evidence.

Acceptance criteria:

- [x] Store evidence with source, observed time, external reference, provenance, confidence, and retention/expiry metadata.
- [x] Model graph nodes, edges, user edits, graph revisions, and explicit versus inferred provenance.
- [x] Make inferred graph edges traceable to supporting evidence records.
- [x] Remove stale inferred relationships when their supporting evidence is deleted.
- [x] Support reset, targeted evidence deletion, graph export-ready serialization, and lifecycle-safe persistence.
- [x] Keep browser-observed evidence and YouTube API account/display data separate.
- [x] Provide a versioned schema and migration strategy, including v1 → v2 preservation.
- [x] Cover create, read, update, delete, reset, restart, evidence-backed edges, and migration behavior with CI-validated tests.
- [x] Reconcile repeated YouTube History scans idempotently without using collector observation time as watch-event identity.

Still intentionally excluded from #148:

- preference inference;
- deterministic scoring/ranking;
- cross-source identity resolution;
- feed enforcement;
- YouTube Data API graph bootstrap.

Those remain downstream work. The next graph-layer work should build semantic entities/relationships and then a separately specified preference-inference layer rather than treating every `watched` record as a preference.

### Creator graph consistency hardening — **completed in PR #198**

PR #198 fixed the stale-graph condition found in exported real-browser state. Ordinary evidence ingestion now materializes/merges inferred creator nodes and `created_by` edges immediately, reconciles stale support when evidence is replaced, and keeps deterministic full rebuild as recovery/migration.

Validation sequence:

- stale export exposed hundreds of missing expected creator relationships;
- `rebuildGraphFromEvidence()` reconciled the export to zero missing relationships;
- subsequent real browsing without another rebuild preserved zero missing/duplicate/dangling creator relationships and complete supporting `evidenceIds`.

This is maintenance hardening of #148's graph invariant, not new preference-inference scope.

### History persistence and reconciliation regression coverage

PR #191 also resolves a runtime persistence failure found during browser validation: the extension's install/update initialization was clearing the compatibility History store while the new graph reconciliation was starting, and legacy History records used collector observation time as their identity. The implementation now preserves persisted History across install/update, gates normalized evidence writes behind startup reconciliation, and atomically replaces legacy History evidence with canonical `interaction:watched:<videoId>:history` records. Regression tests cover legacy replacement, preservation of unrelated evidence, repeated reconciliation, metadata refresh, and removal of inferred edges that lose their evidence support.

### [#169](https://github.com/AsimovNo9/MyAlgo/issues/169): Move the MVP scoring path into the extension local runtime — **runtime scoring slice completed in PR #195**

PR #195 completes the first runtime integration slice of #169 and has passed CI plus real-browser validation.

Completed in the #195 slice:

- persisted Personal Algorithm Graph wired into the extension background RANK_PAGE path;
- explicit versioned local scoring policy;
- deterministic additive scorer and trace consumed by the extension runtime;
- local candidate eligibility/source filters;
- explicit feedback replay from personal-algorithm-local-events;
- repeated feedback reconciliation to the latest effective state per content item;
- never_show_channel creator matching through persisted graph relationships;
- compact local score/trace persistence;
- focused runtime tests plus full CI validation;
- live YouTube Home-feed validation of Not interested persistence and subsequent score consumption (kDqb9IzhxjE, trace score -9).

Remaining work is tracked separately where needed: broader candidate coverage/feed enforcement, safe replacement behavior, trust UX, richer user policy controls, and any future feedback undo/reversal semantics. The #195 slice does not claim to control YouTube's underlying recommender.

PR #195 is merged. Treat this entry as the status record for the runtime-scoring slice; do not interpret it as completion of native-feed enforcement or the entire #169 acceptance set.

### [#151](https://github.com/AsimovNo9/MyAlgo/issues/151): Implement deterministic additive scoring and reproducible trace — **completed in PR #193**

PR #193 was merged after CI and live browser/runtime validation. The live diagnostic exercised the actual persisted Personal Algorithm state (792 evidence records, 516 nodes, 269 edges) and confirmed score 10.5, exact contribution accounting, trace consistency, and replay stability. Live validation also exposed an edge-scoping bug; the scorer was corrected so only edges whose endpoints are both part of the candidate path contribute.

### [#170](https://github.com/AsimovNo9/MyAlgo/issues/170): Build Personal Algorithm Graph visualization — **sequenced after #168 and native-feed hardening**

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

## Repository/documentation hygiene

### [#202](https://github.com/AsimovNo9/MyAlgo/issues/202): Remove or rename legacy YouTube retrieval vocabulary

The #168 audit found no YouTube Data API implementation, but shared/recommender planning types still use labels such as `youtube_subscription`, `youtube_search`, `youtube_liked`, `subscriptions`, and `search`. These are currently non-network planning/type vocabulary, not API consumers, but they should be removed or renamed so code review does not imply an integration that does not exist.

### [#200](https://github.com/AsimovNo9/MyAlgo/issues/200): Update stale GitHub repository description

The tracked README/docs now describe the browser-local Personal Algorithm architecture, but the GitHub repository description is repository metadata rather than a tracked file. Update it separately so it no longer presents YouTube Data API sourcing and LLM classification as the MVP foundation.

## Compliance-specific issues

### [#168](https://github.com/AsimovNo9/MyAlgo/issues/168): YouTube API display-only boundary audit

Repository audit result: the current launch runtime contains no YouTube Data API endpoint/client/OAuth/credential/cache path. CI now fails if those surfaces appear in launch source/artifacts. Future API use defaults to account/display-only and requires a new policy/product/privacy review before API Data can approach graph/scoring paths.

### [#167](https://github.com/AsimovNo9/MyAlgo/issues/167): Chrome Web Store data-use disclosure and local data-flow privacy review

Implementation and clean-profile browser validation are complete in PR #199. Remaining work is Store-dashboard publication/reconciliation plus #168.
