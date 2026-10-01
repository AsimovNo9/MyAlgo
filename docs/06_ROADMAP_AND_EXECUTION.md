# Roadmap & Execution

## Phase 0 — Technical/compliance spike

**Gate before graph UX investment.**

1. Validate watch-history DOM extraction. **Completed (#156).**
2. Validate live-feed candidate extraction and user selection capture. **Completed (#150, PR #180).**
3. Validate deterministic behavioral correlation. **Completed (#174, implementation merged).**
4. Validate temporal player playback evidence. **Completed (#183, PR #184).**
5. Confirm data can remain local for MVP. **Completed and browser-validated (#167 / PR #199).**
6. Document observed-data retention/deletion. **Completed for the local-only MVP (#167 / PR #199).**
7. Verify Chrome permission scope. **Completed in source/tests (#167 / PR #199).**
8. Verify YouTube API boundary. **Audit implemented in #168: current launch runtime contains no YouTube Data API integration; CI guardrails enforce that absence.**

**Exit:** enough browser-observed evidence exists to construct a useful initial graph.

### Watch-history DOM spike protocol

The extension may observe rendered `/feed/history` rows only after the user enables the experimental history-bootstrap setting. The spike stores only:

- stable YouTube video ID;
- visible title and creator;
- visible history timestamp when present;
- observation time and `youtube_history_dom` provenance.

Evidence remains local, is deduplicated by video ID, and is capped at 2,000 unique History records in retained local state; each History observation processes at most 500 rendered items. The normalized Personal Algorithm state uses the same stable video identity and reconciles the current History snapshot atomically, replacing legacy timestamp-keyed History records while preserving unrelated evidence and removing unsupported inferred edges. The observer records local yield/failure counters for duplicate, injected, missing-ID, and missing-title rows. It must never send observations to a backend.

Completed validation: a real-browser session across multiple history scroll depths established that modern history cards expose creator metadata and that the initial creator gap was caused by selectors rather than virtualization/hydration. History titles are normalized at extraction, literal `Watch` placeholders are excluded/classified, repeated observations are deduplicated, and the resulting evidence remains local. Shorts Home observations now preserve real titles when available, although creator metadata can remain null on Shorts-specific rows. The browser fixture tests remain a regression guard rather than evidence that the live DOM is permanently stable.

The extension also tolerates stale content scripts after an extension update by safely ignoring invalidated runtime/storage calls. A YouTube reload is still required after an extension update to establish the new content-script context.

### Live-feed candidate and selection observation (#150)

Completed on 2026-09-25 and merged as PR #180. The implementation established the shared behavioral evidence boundary for later graph work:

```text
YouTube candidate
    ↓
stable videoId
    ↓
contextual exposureId
    ↓
surfaced (YouTube decision)
    ↓
clicked (user selection, when present)
    ↓
watched (temporal player evidence, when available)
```

The selection layer is document-level so it survives YouTube DOM replacement, records click/auxclick/keyboard provenance, preserves surface/section/position where the DOM permits it, and excludes MyAlgo-generated UI from its own evidence stream. Navigation and autoplay are deliberately not interpreted as clicks.

Live validation confirmed real local selection events with stable IDs, timestamps, provenance, and exposure context. CI passed and PR #180 was merged. Some YouTube layouts still produce `surface: "other"` when the DOM does not expose a reliable surface container; this does not invalidate the underlying event evidence.

### Deterministic behavioral correlation (#174)

Implemented in a source-neutral correlation primitive and a YouTube compatibility adapter. `correlateEvidence` consumes only normalized `ExposureEvidence` / `InteractionEvidence`; the adapter is responsible for translating YouTube observations into and out of that generic contract.
The derived timeline is recomputable from retained surfaced, clicked, and watched
events. Exact `exposureId` matches are authoritative; no event is invented merely
to make a correlation succeed; events never cross video IDs; and chronological
serialization is deterministic.

### Temporal player watch evidence (#183)

The player collector creates one session per active video/player instance and
accumulates actual media-time deltas while playback is active.

Semantics:

- paused and buffering time does not count;
- ad playback does not count;
- seek jumps do not count;
- one watched observation is emitted per session;
- the default threshold is 30 seconds;
- videos shorter than 60 seconds use the lower of 30 seconds and 50% of duration;
- natural completion is a terminal watched condition for short videos;
- a preceding captured selection may supply the exact `exposureId`;
- watching without a selection remains valid with a null `exposureId`;
- History remains bootstrap/fallback evidence with distinct provenance.

Automated tests cover threshold accumulation, pause/resume, seek exclusion,
short-video completion, duplicate suppression, session reset, exposure propagation,
and no-click watches. Live validation on 2026-09-25 produced two independent click
→ watched chains without visiting History; each emitted exactly one player watched
event after approximately 30 seconds of accumulated playback, preserved the exact
selection `exposureId`, and used `youtube_player_telemetry` provenance.

CI workflow run 313 passed for commit `ab4310088023883384ae9d5c1b9b97d15627be73e`.

#150, #174, and #183 are now implementation foundations rather than active spikes.

## Connector contract gate

Before implementing the local evidence store and graph, the provider boundary is frozen through #187.

```text
connector-specific observation
          ↓
source-neutral evidence contract
          ↓
normalized correlation boundary
          ↓
#148 evidence store / Personal Algorithm Graph
          ↓
#151 deterministic scorer / trace — completed
```

The reusable correlation boundary is now source-neutral: `correlateEvidence` consumes normalized `ExposureEvidence` / `InteractionEvidence`, while YouTube-specific adaptation remains outside the core primitive. #148 can therefore consume the same evidence/correlation model without pretending future connectors are YouTube.

Additional connectors should implement the same contract rather than introducing platform-specific concepts into the graph or scorer.

### Local evidence store and Personal Algorithm Graph (#148)

PR #191 now extends the browser-local state boundary with evidence-backed graph relationships.

The current schema is **v2** and contains:

- normalized `EvidenceRecord` entries with source-neutral evidence, confidence, retention policy, and expiry metadata;
- explicit content graph nodes keyed by `source + externalId`;
- graph nodes and edges with explicit versus inferred provenance;
- `evidenceIds` on every graph edge so an inferred relationship can be traced back to the exact local evidence records that support it;
- rejection of inferred edges that have no supporting evidence;
- cleanup of evidence references when evidence is deleted, including removal of inferred edges that would otherwise become unsupported;
- a helper to resolve an edge's supporting evidence records for future explanation/replay surfaces;
- user edit records and monotonically increasing graph revisions;
- export-ready serialization of the complete local state;
- reset and targeted evidence deletion operations;
- an explicit v1 → v2 migration that preserves existing evidence and graph nodes while initializing legacy edge evidence references to an empty list;
- safe reset for unknown or malformed schemas rather than guessing at data shape.

Connector observations continue to be retained in the existing raw event stores for compatibility, while normalized exposure/interaction evidence is also persisted into the local state. Canonical YouTube History evidence uses `interaction:watched:<videoId>:history` IDs with `youtube + history_dom` provenance. The record is content-level bootstrap/fallback evidence, not an authoritative replay event or preference edge.

The store remains intentionally local and source-neutral. It does not infer preferences, score candidates, resolve identities across sources, or make API-derived graph decisions. The evidence-backed edge model is a prerequisite for those downstream layers because any future inferred preference relationship must be able to explain which observations support it.

### Deterministic scorer and trace (#151)

PR #193 is merged and the scorer is validated at both unit and live-browser/runtime levels.

The scorer provides deterministic hard-exclusion and eligibility evaluation, additive base/node/edge/feedback/mode contributions, explicit suppression contributions, graph/evidence-backed matched paths, deterministic evidence revisions, stable trace IDs, replay with stable score and trace identity, and contribution-total/trace-consistency invariants.

The live diagnostic passed against real extension state with 792 evidence records, 516 graph nodes, 269 graph edges, score 10.5, contribution total 10.5, consistent trace accounting, and stable replay score/trace identity. It also caught an edge-scoping bug that was corrected before merge.

The scorer remains policy-driven: it does not infer preference from raw watched evidence. Extension-local runtime integration is now implemented for the #195 runtime-scoring slice; broader native-feed enforcement, replacement, and remaining #169 acceptance criteria continue downstream.

### Extension-local scoring runtime (#169 / PR #195)

PR #195 completes the first runtime integration slice for #169. The extension background RANK_PAGE path now consumes the persisted local graph and the deterministic #151 scorer rather than the previous placeholder/index-based ranking behavior.

Implemented and live-validated:

- explicit versioned local scoring policy;
- local candidate eligibility and source-filter handling;
- persisted explicit feedback replay into scoring;
- reconciliation of repeated feedback events to the latest state per content item;
- creator-level never_show_channel matching through persisted creator relationships;
- compact local score/trace persistence;
- runtime tests covering graph scoring, feedback, creator suppression, source filters, and policy boundaries;
- CI build/typecheck/lint/test validation;
- real-browser validation of YouTube Home-feed Not interested → local event persistence → subsequent local score consumption.

Live validation on 2026-09-26 used video kDqb9IzhxjE: the feedback event was persisted at 2026-09-26T02:39:35.727Z; after feed reranking, the local trace at 2026-09-26T02:40:48.729Z recorded score -9 for the same candidate. The result matches the scorer's expected +1 content contribution plus -10 not_interested feedback contribution.

Remaining #169 scope is not implied to be complete by this slice: feed-candidate coverage, full feed enforcement/replacement behavior, feedback undo/reversal semantics, richer policy controls, and production hardening remain separate work where applicable.

#169 should be considered implementation-complete for the #195 runtime-scoring slice, with the broader feed-enforcement and trust loop continuing downstream.

### Graph consistency hardening (#198)

PR #198 is merged. It closed the stale-graph gap found during real exported-state review by making ordinary evidence ingestion maintain inferred creator nodes and `created_by` edges immediately, while preserving `rebuildGraphFromEvidence()` as deterministic reconciliation/recovery.

Browser validation used a stale export, rebuilt it to zero missing creator relationships, then continued real browsing without another rebuild. The later export remained consistent: every expected content → creator relationship and supporting evidence reference was present, with no duplicate or dangling relationships. Treat this as the baseline invariant for future graph evaluation.

### Privacy/disclosure gate (#167 / PR #199)

PR #199 is merged and the clean-profile browser flow has been validated:

- before disclosure acceptance, observation/ranking remains disabled;
- accepting the current disclosure enables the local runtime;
- deleting all local MyAlgo data clears retained extension state and acceptance;
- observation remains disabled after deletion until the disclosure is accepted again.

Store-dashboard publication fields and the separate #168 YouTube Data API audit remain release gates.

### Phase 1 graph progression

The implementation boundary is deliberately staged:

```text
observed evidence
      ↓
content node
      ↓
evidence-backed graph relationship
      ↓
semantic entities / relationships
      ↓
preference inference
      ↓
scoring / ranking
```

#148 currently stops before preference inference. A future preference layer should consume retained evidence and graph relationships rather than treating every `watched` event as an unconditional preference. For validation before that layer exists, #148 exposes complete JSON export plus a deterministic graph-review summary; #170 can later turn those same read-only surfaces into a user-facing graph inspector.

## Phase 1 — Local graph

1. Evidence store — completed (#148 / PR #191)
2. Evidence-backed semantic graph materialization — completed (#148 / PR #191)
3. Graph review/export surface — implemented in #148; user-facing visualization remains #170
4. Graph visualization — planned after the immediate #168 and native-feed hardening sequence (#170)
5. Deterministic additive scorer — completed (#151 / PR #193)
6. Scoring trace — completed (#151 / PR #193)

**Current state:** the local evidence → graph → deterministic score/trace → extension-local runtime foundation is implemented and live-validated. PR #198 hardened graph consistency, PR #199 implemented/browser-validated the local privacy gate, PR #203 locked the no-YouTube-Data-API launch boundary, PR #204 completed native-card enforcement/stale-loop hardening, and PR #205 completed safe native-slot replacements plus first-batch source controls. PR #208 merged RSS/source-neutral retrieval foundations. PR #212 merged zero-config YouTube search-page discovery, connector-owned acquisition/enrichment, mode-aware retrieval, offscreen Worker search isolation, bounded retention, and retrieved-discovery exploration. Acquisition is now sufficient to expose the next bottleneck: candidate semantic understanding and reranking. PR #213 / #209 + #210 are the active work.

**Phase 1 exit:** an item can be traced through the graph and score contributions exactly reproduced. This foundation is now met; feed enforcement and trust UX remain downstream phases.

## PR #208 live-validation follow-up

Live validation exposed that candidate acquisition can outgrow the resolution of the first local scorer. #210 now tracks richer deterministic feature extraction and score calibration. PR #208 may implement the first slice so RSS candidates can be compared meaningfully before web-search volume is added.

Replacement-card presentation must also preserve normal video title/creator hierarchy; a MyAlgo score badge and trace control are annotations, not substitutes for ordinary video metadata.

Web search is now implemented in PR #212 through YouTube's normal search-result pages under the existing YouTube host permission. Search runs from graph goal/topics + mode intent, parses `ytInitialData` off the ranking service-worker path, normalizes stable video IDs, and routes those IDs through canonical watch-page enrichment before scoring.

## Current execution order

PR #223/#221 through PR #230 are merged. Canonical semantic regions, durable modes, graph-grounded mode contributions, mode-aware supply, stable replacement identity, bounded warm ranking/presentation, and measured post-canonical calibration are now foundations rather than active architecture work.

1. **Complete first trust slice — #153 / PR #230.** Scored native and replacement cards now expose one trace-grounded Why-this contract with exact contributions, matched symbolic graph paths, trace/revision identity, and separated acquisition provenance. #153 remains open for direct actions and deeper evidence navigation.
2. **Active P1 — #170 graphical graph explorer.** Build the read-only interactive Personal Algorithm Graph on the same stable identifiers exposed by #153: deterministic bounded Network and Lineage/family-tree layouts, pointer-centered pan/zoom, progressive lineage disclosure, search/focus, rich node/edge provenance inspection, exact scorer-backed Why-this for retained content nodes, live/offline snapshot review, and durable-mode overlays that highlight exact member/source nodes plus their connecting neighbourhood. Network and lineage are two projections of the same canonical graph, not separate models.
3. **P1/P2 — #155 + #154 + #178 correction/provenance/history controls.** Let users forget evidence, reduce/prefer/mute graph terms, and explicitly choose history clusters.
4. **P2 — remaining #161 + #158.** Add user-authored/versioned modes and explicit graph nodes once inspection/correction semantics are established.
5. **P3 — #159 counterfactual replay.** Preview graph edits against a fixed local candidate/evidence snapshot.
6. **Release-validation track — #169 + #211.** Validate signed-out/offline behavior plus long/infinite-scroll/service-worker-restart stability without blocking the primary product loop unless a measured regression appears.
7. **Later — #163/#164/#165/#166.** Portability, optional sync, paid-value validation, and a second connector.


## Phase 1 scope discipline

The long-term vision includes multimodal understanding, retrieval planning, semantic discovery, teacher/student distillation, portable preference representations, and potentially multiple connectors. None of those should automatically become Phase 1 implementation scope.

The first experiment is narrower:

> Can a user recognize an automatically generated representation of their recommendation preferences as meaningfully “theirs”, and do they want to inspect or edit it?

Minimum Phase 1 implementation:

1. reliable local evidence collection;
2. a small interpretable representation;
3. a visible scoring trace;
4. simple user edits;
5. measurable changes to subsequent recommendations.

Only expand retrieval or model complexity when a measured failure justifies it.

**The roadmap is the vision. Phase 1 is not the vision.**

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

Inspection/search/mode overlays move earlier into #170 because users need to understand the graph before editing it. Phase 4 is therefore mutation-focused:

### Graph revision safety invariant

Before the first explicit user mutation, preserve a durable original graph baseline. Every user-authored node/edge/control mutation creates a new graph revision with reversible before/after state. Undo restores the prior user revision; Restore original returns to the preserved baseline without erasing retained evidence. Forget remains an evidence operation, not a graph-edit undo.

1. node editing
2. edge/path editing
3. deletion semantics
4. user-created nodes
5. edit confirmation and revision history
6. rollback/counterfactual handoff

## Phase 5 — Counterfactuals

Replay recent candidates under hypothetical graph versions.

## Phase 6 — Enrichment

Only after measured evidence/semantic gaps:

- transcript;
- rebuildable local embeddings (#209);
- thumbnail vision;
- bounded comment analysis;
- optional local LLM disambiguation/explanation synthesis;
- channel-level context summaries.

The Personal Algorithm Graph remains canonical. Embeddings are recomputable enrichment tied to model/version/input hashes and may support semantic graph neighbourhoods, retrieval expansion, candidate matching, preference clustering, and symbolic explanation paths. Similarity alone must not become a permanent preference edge or ranking authority.

A local generative model may later convert exact trace/path data into concise prose, but the underlying explanation must remain grounded in symbolic graph paths, acquisition provenance, and deterministic score contributions.

Channel context is a separate enrichment/cache layer, not an uncontrolled extension of per-video analysis. A creator summary should be built from a bounded recent window and reused across videos from that creator.

## Retrieval expansion — implemented foundation

MyAlgo can safely transform the native feed and use a bounded local candidate reservoir. The #206/#212 retrieval foundation is now merged: observed DOM, opt-in RSS, and opt-in YouTube search-page discovery populate the source-neutral reservoir without becoming preference evidence. The active limitation has moved from candidate acquisition to semantic matching and score resolution.

Retrieval expands the candidate universe; it does not become the preference model. Retrieved candidates must enter the same local reservoir and deterministic scorer used by browser-observed candidates, with acquisition provenance kept distinct from graph/evidence provenance.

### Retrieval architecture

```text
user model
    ↓
retrieval planner
    ↓
(optional bounded semantic expansion from #209)
    ↓
observed DOM / RSS / web search / exploration
    ↓
candidate pool
    ↓
deterministic scoring
    ↓
ranked candidate set
```
