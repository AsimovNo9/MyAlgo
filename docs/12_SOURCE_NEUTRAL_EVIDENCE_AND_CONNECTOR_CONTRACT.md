# Source-Neutral Evidence and Connector Contract

## Purpose

MyAlgo treats YouTube as the first connector, not as the definition of the recommendation domain.

The connector boundary separates provider-specific mechanics from the source-neutral evidence consumed by the local evidence store, Personal Algorithm Graph, correlation, scoring, and explanation layers.

```text
provider mechanics
  DOM / player / history / navigation / selectors / provider IDs
                         ↓
source-neutral evidence
  ContentIdentity
  ExposureEvidence
  InteractionEvidence
  ContentMetadata
  EvidenceProvenance
                         ↓
evidence store / graph / scorer / explanation
```

The same contract must be usable by content systems that are not social networks, including Reddit, Instagram, X, RSS, blogs, podcasts, and local content.

## Core contracts

The shared package defines these concepts:

### ContentIdentity

```ts
type ContentIdentity = {
  source: string;
  externalId: string;
};
```

`externalId` is opaque to the core. A YouTube `videoId` is therefore an adapter implementation detail rather than a core-domain field.

Identity is not exposure. The same content may appear many times in different surfaces, sections, positions, or sessions.

### ExposureEvidence

```ts
type ExposureEvidence = {
  kind: 'exposure';
  exposureId: string;
  content: ContentIdentity;
  surface: string;
  section?: string | null;
  position?: number | null;
  observedAt: string;
  provenance: EvidenceProvenance;
  metadata?: ContentMetadata | null;
};
```

An exposure records contextual presentation of content. It does not mean the user preferred, clicked, or watched the content.

Repeated exposures are valid evidence and must not be collapsed merely because their content identity is equal.

### InteractionEvidence

```ts
type InteractionEvidence = {
  kind: 'interaction';
  content: ContentIdentity;
  exposureId: string | null;
  interaction: 'clicked' | 'watched' | 'saved' | 'shared' | 'dismissed' | 'feedback';
  observedAt: string;
  provenance: EvidenceProvenance;
  sessionId?: string | null;
  metrics?: Record<string, number>;
};
```

An interaction records an observed user action. It does not assign preference weight.

A click can retain the exact exposure that led to it. A watch can have a null exposure when no preceding surfaced context is known.

Quantitative metrics are optional and opaque to the contract. Player playback can therefore record `playedSeconds`, `durationSeconds`, and `thresholdSeconds` without making media playback a graph-domain primitive.

### EvidenceProvenance

```ts
type EvidenceProvenance = {
  connector: string;
  mechanism: string;
};
```

The connector identifies the adapter that observed the evidence. The mechanism identifies how the connector observed it, such as DOM, player telemetry, user interaction, RSS, or another provider-specific mechanism.

Platform-specific provenance unions belong in the connector, not in the source-neutral contract.

### ContentMetadata

Metadata is descriptive content information, not a preference decision:

- title;
- creator identity/name;
- description;
- duration;
- publication time;
- language;
- format;
- content type.

Connectors normalize provider-specific metadata into this shape.

## Connector contract

The extension's `PageProviderConnector` extends the shared `EvidenceConnector` contract.

A connector owns:

- provider IDs and URLs;
- DOM selectors;
- page/surface detection;
- player and history observation;
- navigation handling;
- provider-specific metadata extraction;
- provider-specific provenance mechanisms;
- presentation and feed-enforcement mechanics;
- mapping provider observations into normalized evidence.

A connector must expose normalized identity and evidence mapping:

```text
provider observation
      ↓
connector adapter
      ↓
ContentIdentity / ExposureEvidence / InteractionEvidence
```

The core must not import YouTube selectors, YouTube DOM nodes, YouTube player state, or YouTube-specific provenance values. The reusable correlation implementation follows the same rule: it has no dependency on `youtube-*` modules or provider IDs.

## YouTube implementation

The YouTube connector maps:

| Provider observation | Normalized evidence |
|---|---|
| Home DOM candidate | `ExposureEvidence` |
| click / auxclick / keyboard selection | `InteractionEvidence(interaction='clicked')` |
| player temporal watch | `InteractionEvidence(interaction='watched')` |
| rendered History fallback | `InteractionEvidence(interaction='watched')` |

The mechanism remains distinguishable through provenance:

- `youtube + home_dom`
- `youtube + user_interaction`
- `youtube + player_telemetry`
- `youtube + history_dom`

These mechanisms are evidence provenance, not preference semantics.

## Correlation boundary

The reusable correlation primitive is source-neutral: `correlateEvidence(exposures, interactions)` consumes only `ExposureEvidence` and `InteractionEvidence` from `@repo/shared-types`. It compares `ContentIdentity.source + externalId`, preserves exact `exposureId` matches, applies deterministic content/time fallback when an interaction has no exposure ID, and emits only contextual correlations.

The YouTube `behavior-correlation.ts` module is now an adapter around that primitive. It converts YouTube observations to normalized evidence before correlation and converts the generic timeline back to the legacy YouTube-shaped UI/background result. That adapter is a compatibility boundary, not the algorithm core.

It may establish:

```text
surfaced → clicked → watched
```

but it must not:

- infer that the user likes a topic;
- assign preference weights;
- rank candidates;
- collapse distinct exposure contexts;
- reinterpret absence of interaction as a negative preference.

Preference learning belongs downstream in the Personal Algorithm Graph/evidence model.

## Rules for additional connectors

A future connector should add an adapter, not a new core concept.

For example:

```text
Reddit post ID
    ↓
ContentIdentity { source: 'reddit', externalId: '...' }

Reddit listing appearance
    ↓
ExposureEvidence

Reddit open/save/comment
    ↓
InteractionEvidence
```

The core should not acquire `redditPostId`, `instagramReelId`, or `youtubeVideoId` fields.

Cross-source identity resolution is deliberately separate. Equal strings from two sources do not imply equal content.

## Dependency order

The contract is a prerequisite for the next graph layers:

```text
YouTube observation
      ↓
behavior correlation
      ↓
source-neutral evidence / connector contract
      ↓
source-neutral correlation (`correlateEvidence`)
      ↓
#148 evidence store + Personal Algorithm Graph
      ↓
evidence-backed graph relationships
      ↓
#151 deterministic scorer + trace
      ↓
additional connectors
```

The contract does not implement graph storage, preference inference, scoring, ranking, or cross-platform identity resolution.

## Browser inspection and debugging

When investigating live extension evidence in Chrome, inspect the extension's local storage directly from a page or extension debugging context.

For the selection and watch event stream, use:

```js
chrome.storage.local.get(
  ["personal-algorithm-selection-events"],
  (data) => {
    const events = data["personal-algorithm-selection-events"];
    console.table(events);
  }
);
```

This is an inspection aid only. It does not modify evidence or participate in the production evidence pipeline.

Use it when validating connector behavior, temporal watch capture, exposure propagation, provenance, deduplication, or unexpected event sequences during live browser testing.

If a runtime message such as `chrome.runtime.sendMessage(...)` is used to inspect extension behavior, run it from the extension service worker's DevTools console when the target handler belongs to the background context. A page/content-script console may not have a receiving extension context and can produce `Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.`

The storage inspection command is intentionally source-neutral at the evidence boundary: it exposes the normalized event stream without requiring the debugger to understand YouTube-specific DOM or player internals.

## Local persistence boundary (#148)

Normalized evidence crosses the connector boundary into the browser-local Personal Algorithm state:

```text
ExposureEvidence / InteractionEvidence
            ↓
LocalPersonalAlgorithmStore
            ↓
versioned local state (v2)
   ├── evidence records
   └── Personal Algorithm Graph
            │
            └── inferred edges → supporting evidence IDs
```

The v2 local state retains source, observed time, external identity, provenance, confidence, and retention/expiry metadata for each evidence record. History is reconciled by stable rendered video ID rather than collector observation time: the current History snapshot replaces prior `youtube_history_dom` watched records atomically, while unrelated evidence remains untouched. This avoids duplicate History events from repeated DOM scans and prevents startup/update lifecycle work from racing normalized History ingestion. The raw compatibility History store is preserved across extension install/update and remains local-only. Graph content nodes preserve the same `ContentIdentity`. Graph nodes and edges explicitly declare `explicit` or `inferred` provenance. Every graph edge also stores `evidenceIds`; inferred edges must reference existing evidence records, making the relationship traceable and preventing unsupported inferred edges from entering the store.

Evidence deletion removes its references from graph edges. Inferred edges with no remaining support are removed rather than left as unsupported claims. The store can resolve an edge back to its current supporting evidence records for future explanation and replay features.

User edits and graph revisions are retained as first-class local records so exported state can be inspected and replayed later. The store also exposes a deterministic graph-review summary for development validation before a dedicated visualization UI exists.

Persistence is browser-local through `chrome.storage.local`. The store exposes create/read/update/delete operations, targeted content deletion, reset, restart-safe initialization, and export-ready serialization (`exportState()` / JSON). Schema version 2 has an explicit v1 → v2 migration that preserves existing evidence and graph nodes and initializes legacy edge support references to an empty list. Unknown versions are not heuristically interpreted.

For development validation, the background service worker exposes three read/rebuild operations:
- `PERSONAL_ALGORITHM_REVIEW` returns the deterministic review summary;
- `PERSONAL_ALGORITHM_REBUILD` recomputes the derived creator graph layer from retained evidence;
- `PERSONAL_ALGORITHM_EXPORT` returns portable JSON for offline inspection.

These operations are validation/debugging surfaces, not recommendation decisions.

The store is evidence persistence, not preference inference. It does not assign recommendation weights, rank candidates, resolve cross-source identities, or consume YouTube Data API account/display data as observational evidence.

## Graph evidence semantics

The graph now distinguishes three layers:

1. **Observed evidence** — immutable-in-meaning facts such as “video X was watched,” including provenance such as `youtube/history_dom`.
2. **Graph relationships** — explicit or inferred relationships between graph nodes. Inferred relationships must name the evidence records that support them.
3. **Preference inference** — a future downstream layer that may derive user-centered relations such as interest or avoidance from accumulated evidence and graph structure.

For example:

```text
EvidenceRecord
  interaction=watched
  content=youtube:video-123
  provenance=youtube/history_dom
          │
          ▼
content:youtube:video-123
          │
          │ evidenceIds=[evidence-42]
          ▼
topic:distributed-systems
          │
          ▼
future preference inference
```

The final arrow is deliberately outside #148. A watched History record is evidence; it is not itself a `user → prefers → topic` edge.
