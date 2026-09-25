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

The core must not import YouTube selectors, YouTube DOM nodes, YouTube player state, or YouTube-specific provenance values.

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

Behavior correlation converts provider-shaped observations at the connector boundary and performs its deterministic matching over normalized evidence.

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
#148 evidence store + Personal Algorithm Graph
      ↓
#151 deterministic scorer + trace
      ↓
additional connectors
```

The contract does not implement graph storage, preference inference, scoring, ranking, or cross-platform identity resolution.
