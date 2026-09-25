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

- `watched`: behavioral evidence from temporal player playback. Rendered
  History remains a bootstrap/fallback source with distinct provenance.
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

The YouTube Data API is deliberately excluded from graph derivation at launch.

If API use expands later, it must pass a dedicated policy review and may require a different architecture/permission path.
