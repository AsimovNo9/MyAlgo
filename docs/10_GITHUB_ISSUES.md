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
- user-triggered scan retains every eligible rendered history row until YouTube
	stops extending the finite history surface; no silent record cap
- document failure cases
- measure usable evidence yield

### [#150](https://github.com/AsimovNo9/MyAlgo/issues/150): Validate live-feed candidate extraction

Acceptance criteria:

- Home
- Search
- Subscriptions
- Shorts
- navigation
- infinite scroll
- no collection of MyAlgo-injected cards

For the Home surface, store recommendation appearance as `surfaced` contextual
evidence with position and section metadata. Do not treat appearance alone as a
user preference.

Retain every unique Home card that YouTube renders while observation is enabled.
Home is unbounded, so this is an observed-feed record rather than a claim to
capture an unknowable complete future Home feed.

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
