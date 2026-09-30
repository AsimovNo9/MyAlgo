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

## 3. Foundation-model and semantic-enrichment boundary

```text
content / graph inputs
      ↓
replaceable local enrichment
      ↓
semantic features / content evidence
      ↓
Personal Algorithm Graph + deterministic scoring
```

Possible enrichment later:

- title
- description
- tags/category
- transcript where legitimately available
- thumbnail vision
- bounded comment sampling
- local embeddings
- optional local summaries / explanation synthesis

The Personal Algorithm Graph remains the authoritative, inspectable user model. Embeddings are **rebuildable derived data**, not canonical preference state.

```text
observed/user evidence ─────────→ Personal Algorithm Graph (authoritative)
                                      │
                                      ├── symbolic nodes / edges / provenance
                                      │
candidate + graph text ─→ rebuildable embeddings / semantic features
                                      │
                                      ├── semantic neighbourhoods
                                      ├── retrieval expansion
                                      └── candidate/graph + mode similarity
                                                   ↓
                                      deterministic scorer + exact trace
```

Embeddings may propose semantically related graph concepts, expand retrieval intents, cluster user-interest regions, and produce candidate similarity features. Similarity alone must not silently create permanent preference edges or override explicit feedback/hard policy.

PR #223 keeps **canonical identity** and **score-region reconciliation** distinct. Canonical concepts remain conservative derived identities with exact source-node provenance. At scoring time, nested non-explicit canonical concepts with strong lexical containment (for example `chill lofi` / `chill lofi beats` / `lofi beats`, or a base topic plus a gameplay-qualified variant) may reconcile into one bounded score region so related subtopics do not stack merely because materialization retained useful distinctions. Explicit/mixed user-authored concepts are protected from this score-region merge.

Embedding-only graph matches also pass a confidence gate before receiving score mass: weak matches must clear an absolute similarity floor and remain sufficiently close to the candidate's strongest semantic match, while direct lexical support can retain a match. Broad taxonomy-only matches are a collective bounded fallback rather than multiple additive preference terms. These rules affect scoring only; they do not delete graph nodes, canonical concepts, evidence, or cached semantic diagnostics.

Each embedding cache record should be tied to stable owner identity plus model ID/version, input hash, dimensions, and generation time so a model change can invalidate/rebuild semantic enrichment without changing canonical evidence, graph edits, or preference state.

A compact local embedding encoder is preferred for vector generation. A later local generative model may synthesize natural-language explanations from bounded structured trace/path inputs, but it must not independently infer why the user likes an item from raw history.

For “Why am I seeing this?”, semantic machinery should resolve to symbolic paths such as:

```text
Goal: Learn distributed systems
  → Local-first software
  → CRDTs
  → this candidate
```

Raw vector distances/model internals belong in debug provenance, not the primary user-facing reason.

Enrichment must be asynchronous, cached appropriately, provenance-aware, replaceable, and safe to delete/recompute.

A model-version change must not silently reconstruct the user's graph. See #209.

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

Safe replacement is now layered on top of that enforcement boundary in #160. A replacement may occupy only a native slot hidden by the current generation and only when the current local ranked feed contains a distinct eligible, non-suppressed candidate with a current trace. Replacement candidates are deduplicated against all native cards, the Personal Algorithm shelf, and other replacements.

The legacy horizontal Personal picks shelf is no longer part of the YouTube runtime. The native YouTube feed is the single recommendation surface and MyAlgo starts applying persisted presentation controls from the first available Home batch rather than waiting on a fixed startup delay. Explicit source controls currently include Shorts, Live, and Playables; source-filter removals are terminal presentation hides and never become replacement slots. Once native-card enforcement and safe replacement slots are active, MyAlgo uses a single coherent feed surface: YouTube's native grid/list, annotated and selectively replaced in place. This avoids presenting a second horizontal feed that could be mistaken for the primary recommendation surface.

Replacement presentation is generation-scoped and synthetic: it carries trace/score/mode/source-slot metadata, is excluded from candidate/evidence/interaction observation, and is removed on a new generation, route/mode/source/graph invalidation, pause, or reactivation. The YouTube connector now compares deterministic calibrated display scores: a replacement candidate must clear `replacementMinimumScore = 55`, opportunistic swaps require at least a 5-point display-score uplift over the native card, and a render remains capped at six replacements. The raw additive score remains the replay/explanation authority; calibration is only a bounded presentation/ranking layer. If no qualified candidate exists, the native card remains rather than creating a blank slot.

The replacement UI preserves the target slot footprint and target media aspect ratio, visibly presents title + creator/channel even when thumbnail metadata is missing, links only to the canonical provider URL, and exposes a compact exact-contribution trace entry point that precedes the full #153 explanation surface. It does not mutate the Personal Algorithm Graph or create evidence merely because MyAlgo rendered the card.

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

## 6.1 Candidate acquisition boundary

PR #205 completed the native presentation boundary, and PR #212 completed the first source-neutral acquisition expansion (#202/#206) through observed DOM, opt-in RSS, and opt-in YouTube search-page discovery. Acquisition remains upstream of scoring and does not change the preference model. PR #213 now adds rebuildable semantic matching over the normalized candidate reservoir and Personal Algorithm Graph.

Candidate acquisition is upstream of scoring:

```text
Personal Algorithm Graph + explicit goals + normalized evidence/history
        ↓
deterministic query/retrieval planning
        ↓
observed DOM / RSS / web search / exploration
        ↓
normalized candidate reservoir + acquisition provenance
        ↓
existing deterministic scorer/policy
        ↓
native feed presentation
```

Acquisition provenance and graph/evidence provenance are separate. A candidate retrieved through RSS or web search does **not** become preference evidence merely because it was retrieved. Only separately defined user/observation events may affect the graph.

Web-search queries should be derived from normalized concepts, explicit goals, allowed graph relations, preferred formats, creator concepts, and bounded freshness lanes. The current graph state is authoritative: an explicit deterministic graph-to-retrieval-intent adapter should feed the query planner rather than reconstructing a separate legacy preference object. Raw watch-history rows, raw titles, private notes, or full graph dumps must not be sent to a search provider. The acquisition adapter remains provider-neutral; the launch implementation uses YouTube search pages behind that connector-owned boundary.

The launch YouTube Data API boundary remains unchanged: #206 must not add YouTube Data API search.

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


## 9. Live-ranking performance boundary

The persistent candidate/evidence stores are not the per-render scoring working set. PR #208/#211 scores every current-page candidate plus a separately bounded off-page replacement subset and coalesces YouTube DOM mutation bursts. PR #228 prepares graph/canonical/lexical lookup state once per immutable Personal Algorithm snapshot, reuses deterministic candidate score/trace results when candidate material + feedback + mode context are unchanged, and bounds those worker-local caches so long sessions cannot grow them without limit.

The Home renderer follows the same incremental principle. One presentation pass discovers native cards and reads geometry once, then shares that snapshot between native-feed presentation and replacement rendering. Viewport priority is maintained by IntersectionObserver instead of rerunning the whole presentation pipeline on every scroll debounce. Persisted first-paint presentation is compact, mode/revision scoped, and related storage keys are written in one signature-gated batch only when presentation state materially changes.

Watch-page metadata enrichment runs in the MV3 service worker with bounded concurrency rather than inside the YouTube renderer. A dedicated scoring Web Worker remains optional future work only if profiling shows the bounded service-worker scorer is still CPU-bound after working-set reduction, incremental score reuse, prepared lexical/graph indexes, batched persistence, and renderer-side snapshot reuse.

Opportunistic replacements bind the selected off-page candidate to the native slot when the slot is created. Rendering consumes that binding instead of independently selecting a second time; fallback selection is reserved for policy-created slots without a pre-bound candidate.


### Replacement stability across SPA churn

Replacement identity is keyed by native source video ID → replacement candidate ID. Rank generation and generation-scoped slot IDs prevent stale renders but do not define candidate identity.

PR #227 removes the obsolete time-based hold model. A valid binding has no arbitrary 45-second expiry. It survives ordinary in-route mutation/page-data churn, metadata enrichment, non-graph semantic enrichment, retrieval-reservoir expansion, and manual rerank/retry. The candidate may receive a new score, trace, or richer metadata during those reranks; if the source→candidate mapping remains valid, the rendered replacement node is refreshed in place.

Hard invalidation is explicit: navigation/route, active mode, graph-changing semantic materialization, feedback/rebuild, source policy, feed-mix slider, and lifecycle/model resets clear the binding context. An individual binding also ends when the source disappears or the candidate fails current eligibility/score/mode/native-duplication checks. `yt-page-data-updated` remains an in-route mutation refresh because YouTube emits it during normal Home updates. Retrieval expansion is intentionally soft: newly acquired supply may fill empty capacity but does not displace a valid incumbent merely for scoring slightly higher.


### First-paint overlay path

Badges and replacement presentation must not wait on network metadata enrichment. The critical path is now: collect current DOM candidates → merge/persist lightweight observations → hydrate from already-cached metadata → score the bounded working set → return/render. Canonical watch-page enrichment runs asynchronously afterward in the extension service worker and requests a later metadata rerank only when new metadata was actually persisted.

Ordinary YouTube mutation/page-data churn must not invalidate a rank already in flight. Mutation and metadata events are coalesced into one queued rerank while the current response is allowed to render. Only hard lifecycle/semantic changes such as navigation, mode changes, graph changes, and explicit feedback invalidate the active generation.


## 10. Mode, classification, and semantic enrichment boundaries

Keep these three concepts separate:

1. **Mode** is transient user intent. It affects retrieval planning and bounded score weighting.
2. **Content classification** describes the candidate itself. UI labels such as `Learning` may be shown only when candidate metadata supports that classification with sufficient confidence.
3. **Semantic enrichment** is rebuildable derived data. Text embeddings may improve candidate↔goal/topic similarity and retrieval expansion, but do not become canonical graph truth.

The launch semantic stack now has two distinct local model roles:

- the packaged DeBERTa zero-shot verifier filters bounded metadata topic candidates and may abstain with an empty verified set;
- the packaged mxbai embedding encoder supplies rebuildable candidate↔graph semantic similarity.

Neither model output is canonical preference state. Verified labels still pass through the evidence-backed #218 materializer, while embeddings remain derived enrichment.

PR #223/#221 implements the derived canonicalization layer over the materialized topic/concept graph. Deterministic aliases are reconciled first; the existing local embeddings may then group high-similarity inferred nodes only when lexical compatibility or shared graph support grounds the assignment. Original graph nodes/evidence remain inspectable, explicit/user-authored distinctions are protected from similarity-only merging, and broad `content_type` taxonomy stays distinguishable from specific interests. Scoring consumes one bounded contribution per canonical neighbourhood and reconciles lexical plus embedding evidence instead of independently adding duplicate paths. Durable mode clusters remain downstream #214 work over these canonical concepts.

Multimodal thumbnail/video classification remains deferred until measured ambiguity demonstrates that text metadata is insufficient. Any multimodal model must remain asynchronous, cacheable, rebuildable, and outside overlay first-paint latency.


### YouTube search-page acquisition

The launch web-discovery provider uses YouTube's ordinary search-result pages under the extension's existing YouTube host permission. Generated queries come from the graph retrieval profile plus active mode intent. For a durable mode, PR #226 resolves the stable mode ID/revision and injects a bounded set of its highest-weight canonical member labels into retrieval topics; retrieval-plan identity is versioned by that mode revision. A retained dormant mode may still supply retrieval intent so acquisition can seek new candidates without treating retrieval itself as renewed preference evidence. The provider parses embedded `ytInitialData` for stable video IDs and lightweight result metadata, then hands those IDs to the same canonical watch-page enrichment path used by RSS candidates. Search-page acquisition is candidate discovery only and never becomes preference evidence by itself. The provider-neutral `WebSearchProvider` interface remains so acquisition can be replaced later without coupling search transport to ranking.

For Home presentation under a selected durable mode, the replacement slider represents requested mode coverage rather than an unconditional replacement count. Exact current-mode native cards satisfy that demand first. Only the remaining shortfall may be filled from the existing scored reservoir, and a pool candidate must pass the same policy/score gates plus exact stable mode ID/revision grounding. Current Home IDs are never counted as pool supply. Default/All keeps the general replacement behavior. The latest requested/native/pool/fulfilled snapshot is bounded local diagnostics, not preference state.


### Connector-owned acquisition adapters

PR #212 keeps provider acquisition behind `PageProviderConnector.acquisition`. The background coordinator asks the active connector for its search provider and enrichment function; it does not construct YouTube search providers directly.

The YouTube acquisition adapter contains search-page parsing, RSS mechanics, stable video-ID normalization, and canonical watch-page metadata enrichment. This preserves the intended dependency direction:

```text
background retrieval coordinator
        ↓
PageProviderConnector.acquisition
        ↓
provider-specific acquisition
        ↓
normalized RecommendationCandidate / metadata
        ↓
shared reservoir + scorer
```

Future connectors add acquisition adapters rather than provider branches to the retrieval coordinator.


### Search worker isolation

YouTube search acquisition must not block the extension service worker that handles ranking and presentation.

The production YouTube search provider delegates `/results` fetching and large `ytInitialData` parsing to an offscreen extension document. That document spawns a dedicated Web Worker using Chrome's MV3 `offscreen` + `WORKERS` capability. The ranking service worker exchanges only the generated query and normalized search results with this context.

If the offscreen capability is unavailable, the provider may fall back to direct fetch/parsing for compatibility, but the supported Chrome path is isolated.

This preserves three performance domains:
- YouTube renderer/content script: DOM observation and presentation only;
- extension service worker: ranking, storage coordination, graph/retrieval scheduling;
- search worker: search-page network payload and CPU-heavy result parsing.


## Semantic reranking runtime

Semantic reranking is a derived layer around the canonical Personal Algorithm Graph.

```text
canonical evidence + graph
        │
        ├── objective/topic/concept text ──→ embedding cache
        │                                      │
active mode seed ──────────────────────────────┤
                                               ↓
                                     semantic mode lens
                                               │
enriched candidate text ───────────→ embedding cache
                                               │
                     graph similarity + mode similarity
                                               ↓
                                deterministic scorer/trace
```

The model-facing contract is `LocalEmbeddingProvider`. It is replaceable and exposes only model ID/version, dimensions, and batched text embedding. Embedding records are keyed by stable owner identity + model/version + input hash and are safe to delete/rebuild.

PR #213 includes a dependency-free hashed word/phrase/subword vector provider as the end-to-end baseline. It is **not** treated as equivalent to a pretrained neural encoder; its purpose is to validate cache invalidation, mode construction, ranking integration, fallback behavior, and trace semantics before adopting model weights.

The ranking critical path never waits for new embedding computation. A rank uses semantic feature records already cached for the exact model + graph revision + mode + candidate input hash. Missing semantic features fall back to the existing deterministic lexical/classifier path. After first paint, semantic enrichment computes in the background, persists bounded derived features, and triggers one follow-up rerank only when the semantic values changed.

When semantic mode similarity exists, it replaces the older heuristic mode score rather than stacking with it. Candidate classification remains separate and may still drive descriptive UI labels such as Learning.

A future neural provider should run in an off-main-rank worker/offscreen inference context with WebGPU when available and a bounded CPU/WASM fallback. Switching provider/model versions invalidates only derived caches; it never rewrites graph/evidence truth.
