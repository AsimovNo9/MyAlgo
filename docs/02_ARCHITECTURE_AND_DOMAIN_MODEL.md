# Architecture & Domain Model

## 1. System boundary

```text
┌────────────────────────────────────────────┐
│              YouTube Browser               │
│                                            │
│ Player Media   Watch History   Live Feed   │
│  Telemetry         DOM           DOM       │
└───────────────┬───────────────┬───────────┘
                │               │
                └───────┬───────┘
                        ▼
                 Evidence Collector
                        │
                        ▼
              Personal Algorithm Graph
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
         Scoring    Explanation  Editing
            │           │           │
            └───────────┼───────────┘
                        ▼
                 Feed Enforcement
```

## 2. Core domains

### Evidence

```ts
type EvidenceSource =
  | "browser_history"
  | "browser_feed"
  | "user";

interface Evidence {
  id: string;
  source: EvidenceSource;
  externalRef?: string;
  observedAt: string;
  provenance: string;
  confidence?: number;
  expiresAt?: string;
}
```

### Observation kinds and confidence

```ts
type EvidenceKind =
  | "watched"
  | "surfaced"
  | "explicit_positive"
  | "explicit_negative";
```

- `watched`: behavioral evidence from temporal player playback, with rendered
  History retained as bootstrap/fallback evidence.
- `surfaced`: weak contextual observation from the Home page, never direct taste
  evidence.
- `explicit_positive` and `explicit_negative`: highest-confidence user input.

A Home recommendation stores position, section, observation time, and outcome.
Its outcome starts as `unobserved`, then may be correlated with a later click
and/or watched observation. Player-derived watched evidence is the primary live
signal; History-derived watched evidence remains available for bootstrap and
fallback collection.

### Temporal watched evidence

The YouTube connector treats a player watch as a session-scoped observation.

- A session belongs to one video/player instance.
- Only forward media-time deltas observed while playback is active contribute to
  `playedSeconds`.
- Pause, buffering, advertising, and seek jumps do not count as playback time.
- A watched observation is emitted at most once per session.
- The default threshold is 30 seconds; videos shorter than 60 seconds use the
  lower of 30 seconds and 50% of duration.
- Natural completion is a terminal watched condition for short videos.
- A preceding captured selection may supply the exact `exposureId`; a watch
  without a selection remains valid with a null exposure ID.
- The observation uses `youtube_player_telemetry` provenance and is retained
  alongside history-derived observations rather than replacing them.

The temporal collector is evidence collection only. It does not infer
preference, assign a score, or change recommendation ranking.

### History reconciliation

The rendered YouTube History page is an ordered list of watched content, but the browser-visible cards do not provide a stable watched-at timestamp. The History collector therefore treats the YouTube video ID as the stable content-level identity and records the card's relative position (`0 = newest observed card`). Repeated scans are reconciled by video ID: metadata, observation time, and relative position are refreshed without creating another local History watch event. This prevents repeated DOM scans from turning collector observation time into false watch events.

A History watch represented this way is therefore a bootstrap/fallback observation of the current History state, not an authoritative event log or replay counter. Live player telemetry remains the event/session-level source when the product needs actual playback behavior.

### Graph node

```ts
interface AlgorithmNode {
  id: string;
  kind:
    | "interest"
    | "concept"
    | "entity"
    | "format"
    | "creator"
    | "preference";
  label: string;
  preference: number;
  enabled: boolean;
  createdBy: "inferred" | "user";
}
```

### Edge

```ts
interface AlgorithmEdge {
  id: string;
  from: string;
  to: string;
  relation:
    | "contains"
    | "related_to"
    | "creator_of"
    | "format_of"
    | "evidence_for"
    | "preferred_with";
  weight: number;
  provenance: string;
}
```

### Content evidence

Foundation models may produce structured content evidence:

```json
{
  "topics": ["Elden Ring", "builds", "PvP"],
  "entities": ["Malenia"],
  "content_type": "guide",
  "intent": ["tutorial", "build_optimization"],
  "source": "title+description+transcript",
  "confidence": 0.9
}
```

This is content evidence. It is not itself the user model.

## 3. Foundation-model boundary

```text
Foundation model
      ↓
content evidence
      ↓
Personal Algorithm Graph
      ↓
transparent scoring
```

Possible enrichment later:

- title
- description
- tags/category
- transcript where legitimately available
- thumbnail vision
- bounded comment sampling
- embeddings
- optional summaries

Enrichment must be asynchronous, cached appropriately, provenance-aware, and replaceable.

A model-version change must not silently reconstruct the user's graph.

## 4. Scoring

The runtime scorer is deterministic:

```text
score(item) =
    base
  + Σ matching_node_contribution
  + Σ matching_edge_contribution
  + feedback_adjustment
  + mode_adjustment
  - suppression
```

Hard policies are evaluated separately and first.

```text
hard exclusion → eligibility → additive score → ordering
```

## Local runtime scoring and explicit feedback

PR #195 wires the deterministic scorer into the extension background runtime for the MVP feed-ranking path. The runtime reads the persisted Personal Algorithm Graph, applies an explicit versioned local policy, evaluates candidate eligibility/source filters, produces additive scores and RecommendationTrace records, and persists compact local trace metadata.

Explicit YouTube feedback is replayed from the local event store into scoring signals. Feedback is reconciled by content identity so repeated not_interested events do not accumulate indefinitely. The latest feedback state is used for a content item; more_like_this contributes +10, not_interested contributes -10, and never_show_channel contributes -100. Channel suppression resolves through the persisted content → creator relationship when available, so it can affect sibling content from the same creator rather than only the clicked video.

The live validation path on 2026-09-26 confirmed the persisted-feedback chain: a real YouTube Home-feed Not interested action for kDqb9IzhxjE created a local not_interested event, the candidate was subsequently ranked by the extension runtime, and its compact local trace recorded score -9 (+1 baseline content contribution and -10 explicit feedback contribution). This verifies event persistence and scorer consumption in the real browser runtime.

Source filters are also enforced locally. Candidate collection records subscription/discovery/liked context where the YouTube DOM exposes it; subscribedOnly and includeDiscovery are applied before additive ranking. This remains candidate eligibility/filtering, not a claim about YouTube's proprietary ranking decisions.

not_interested undo/reversal semantics are not part of #195. The current persisted event model is append-only and the MVP validation scope is positive feedback capture → persistence → scoring consumption.

## Native-feed enforcement boundary

Native YouTube cards remain YouTube-owned DOM. MyAlgo may apply local visibility/decorative decisions to those cards, but it does not reorder the underlying native renderer sequence or claim control over YouTube's ranking system.

Presentation decisions are evaluated in this order:

```text
provider/source filter or hard scorer policy
        ↓
local score threshold
        ↓
show/hide native card
```

If MyAlgo has no ranked result for a native card, the card remains visible as a degraded/pass-through state. Missing local candidate coverage must not be interpreted as a negative decision.

Each successful render generation starts from a cleared MyAlgo presentation state. Stale responses are rejected against generation, route, and mode. MyAlgo-generated shelf/replacement/status/explanation/control DOM is excluded from candidate, evidence, and interaction extraction.

Safe native replacement is a separate concern tracked in #160; the #152/#171 enforcement path does not manufacture replacement content.

## 5. Explanation

The explanation engine consumes the same scoring trace used by ranking.

It must be possible to answer:

- which graph path matched?
- which evidence supports it?
- which graph contributions changed the score?
- which user setting can change the result?

## 6. Platform connector

The core graph is platform-agnostic.

A connector owns:

- player/media telemetry observation
- DOM observation
- history extraction
- candidate extraction
- interaction observation
- feed enforcement
- platform-specific UI behavior

For YouTube P0, the connector has separate player, history, and Home ingestion
paths. Player playback is the primary live watched signal; History remains a
bootstrap/fallback path. They share stable video IDs for correlation but retain
independent provenance.

```text
Player telemetry ───────┐
History DOM ────────────┼─→ watched evidence
Home DOM ───────────────┼─→ surfaced evidence
User interaction ──────┘─→ clicked evidence
```

YouTube is the first connector.

## 7. Storage

MVP target:

```text
HOT
recent candidates
recent evidence
active graph
recent scoring traces

WARM
recent enrichment
embeddings, if introduced

COLD
compressed historical evidence, only if retention policy permits

DELETE
expired or user-deleted data
```

Do not permanently store raw provider/API payloads merely because they are convenient.

## 8. API role

The current launch runtime contains no YouTube Data API endpoint, client library, OAuth scope/token path, API credential path, or API Data cache. Browser-observed YouTube pages supply launch evidence.

If YouTube Data API use is introduced later, its default reviewed role is account facts/display only. API Data must remain excluded from graph derivation, scoring, traces, and explanations unless a dedicated policy/product/privacy review explicitly approves a changed architecture.

CI enforces this boundary with a static launch-source/artifact audit plus manifest checks that forbid an OAuth/identity surface. See `docs/compliance/YOUTUBE_API.md`.


## Source-neutral connector/evidence boundary

The platform connector is an adapter boundary, not part of the Personal Algorithm domain.

Provider-specific mechanics remain in the connector:

- DOM and selectors;
- provider IDs and URLs;
- player/media telemetry;
- history extraction;
- navigation;
- provider-specific provenance mechanisms;
- presentation and feed enforcement.

The connector maps those observations into source-neutral contracts:

```text
ContentIdentity
ExposureEvidence
InteractionEvidence
ContentMetadata
EvidenceProvenance
```

The evidence store, Personal Algorithm Graph, behavior correlation, scorer, and explanation layers must consume those normalized concepts rather than provider-specific IDs or event types.

The full contract is defined in `docs/12_SOURCE_NEUTRAL_EVIDENCE_AND_CONNECTOR_CONTRACT.md`.
