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

### [#174](https://github.com/AsimovNo9/MyAlgo/issues/174): Correlate surfaced recommendations with user behavior

Correlate a Home `surfaced` observation with a later click and/or rendered
history match by stable video ID. The resulting sequence distinguishes what
YouTube displayed from what the user chose to watch:

```text
surfaced → clicked → watched
```

This is contextual evidence for future graph learning; repeated non-engagement
is not an automatic negative preference in P0.

### [#167](https://github.com/AsimovNo9/MyAlgo/issues/167): Complete Chrome Web Store disclosure and local data-flow privacy review

### [#168](https://github.com/AsimovNo9/MyAlgo/issues/168): Audit the YouTube Data API display-only boundary

### [#187](https://github.com/AsimovNo9/MyAlgo/issues/187): Define source-neutral evidence and connector contracts

Freeze the boundary between provider-specific connectors and the source-neutral recommendation domain before #148 and #151.

Implementation requirements:

- shared `ContentIdentity`, `ExposureEvidence`, `InteractionEvidence`, `ContentMetadata`, and `EvidenceProvenance` contracts;
- YouTube connector mapping for Home exposure, selection, player watch, and History fallback evidence;
- deterministic behavior correlation over normalized evidence;
- no preference inference, graph learning, scoring, or cross-source identity resolution in the connector contract.

The full contract is documented in `docs/12_SOURCE_NEUTRAL_EVIDENCE_AND_CONNECTOR_CONTRACT.md`.

## P1 — Local Personal Algorithm Graph

### [#148](https://github.com/AsimovNo9/MyAlgo/issues/148): Implement local evidence store and Personal Algorithm Graph

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

### [#167](https://github.com/AsimovNo9/MyAlgo/issues/167): Chrome Web Store data-use disclosure and launch privacy review

Finalize permissions, disclosures, privacy policy, retention, and deletion behavior.
