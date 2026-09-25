# Roadmap & Execution

## Phase 0 — Technical/compliance spike

**Gate before graph UX investment.**

1. Validate watch-history DOM extraction. **Completed (#156).**
2. Validate live-feed candidate extraction and user selection capture. **Completed (#150, PR #180).**
3. Confirm data can remain local for MVP.
4. Document observed-data retention/deletion.
5. Verify Chrome permission scope.
6. Verify YouTube API remains display-only.

**Exit:** enough browser-observed evidence exists to construct a useful initial graph.

### Watch-history DOM spike protocol

The extension may observe rendered `/feed/history` rows only after the user enables the experimental history-bootstrap setting. The spike stores only:

- stable YouTube video ID;
- visible title and creator;
- visible history timestamp when present;
- observation time and `youtube_history_dom` provenance.

Evidence remains local, is deduplicated by video ID, and is capped at 1,000 records. The observer records local yield/failure counters for duplicate, injected, missing-ID, and missing-title rows. It must never send observations to a backend.

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
watched (later history evidence, when available)
```

The selection layer is document-level so it survives YouTube DOM replacement, records click/auxclick/keyboard provenance, preserves surface/section/position where the DOM permits it, and excludes MyAlgo-generated UI from its own evidence stream. Navigation and autoplay are deliberately not interpreted as clicks.

Live validation confirmed real local selection events with stable IDs, timestamps, provenance, and exposure context. CI passed and PR #180 was merged. Some YouTube layouts still produce `surface: "other"` when the DOM does not expose a reliable surface container; this does not invalidate the underlying event evidence.

#150 is now an implementation foundation rather than an active spike. #174 is the next behavioral-evidence layer: correlate these observations into deterministic surfaced → clicked → watched sequences without yet inferring preference.

## Connector contract gate

Before implementing the local evidence store and graph, the provider boundary is frozen through #187.

```text
connector-specific observation
          ↓
source-neutral evidence contract
          ↓
#148 evidence store / Personal Algorithm Graph
          ↓
#151 deterministic scorer / trace
```

Additional connectors should implement the same contract rather than introducing platform-specific concepts into the graph or scorer.

## Phase 1 — Local graph

1. Evidence store
2. graph nodes/edges
3. graph visualization
4. deterministic additive scorer
5. scoring trace

**Exit:** an item can be traced through the graph and score contributions exactly reproduced.

### Phase 1 scope discipline

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

1. node editing
2. edge/path editing
3. deletion semantics
4. user-created nodes
5. graph search
6. mode overlays

## Phase 5 — Counterfactuals

Replay recent candidates under hypothetical graph versions.

## Phase 6 — Enrichment

Only after measured evidence gaps:

- transcript
- embeddings
- thumbnail vision
- bounded comment analysis
- optional LLM disambiguation
- channel-level context summaries

Channel context is a separate enrichment/cache layer, not an uncontrolled extension of per-video analysis. A creator summary should be built from a bounded recent window and reused across videos from that creator.

## Phase 7 — Retrieval expansion

Phase 7 is the point at which MyAlgo can stop treating the current YouTube DOM as its entire recommendation universe. It should be entered only after Phases 1–5 demonstrate that users understand and value the local representation.

### Retrieval architecture

```
user model
    ↓
retrieval planner
    ↓
DOM / subscriptions / RSS / search / semantic / exploration
    ↓
candidate pool
    ↓
dedupe + enrichment + hard policies
    ↓
ranking
    ↓
YouTube presentation
```

The retrieval lanes are:

1. **DOM** — immediate YouTube context and currently rendered candidates.
2. **Subscriptions** — trusted creator uploads.
3. **RSS** — creator/publication freshness. RSS is a retrieval source, not inherently a personalized ranking source.
4. **YouTube search** — active retrieval from current interests and objectives.
5. **Semantic retrieval** — related videos that need not share exact keywords.
6. **Exploration** — controlled novelty and deliberate discovery.

Initial candidate-pool planning target: roughly 500–2,000 candidates before final ranking, depending on available sources and device constraints. A possible first allocation is:

- DOM: 100–500
- RSS: 100–300
- search: 100–500
- semantic: 100–500
- exploration: 20–100

The existing `recommender-core` retrieval abstractions are not considered live recommendation infrastructure until they are wired into the extension candidate flow.

### Retrieval and ranking principle

Retrieval should optimize **coverage**; ranking should optimize **fit**.

The system should not treat a retrieved item as personalized merely because it came from a personalized-looking source. Every candidate should be evaluated against the user's current model, hard policies, and active objective.

A useful explanation should be possible at the item level, for example:

```
WHY IS THIS HERE?

Related to interests     42%
Creator followed         31%
Related to liked videos  18%
Discovery                 9%
```

This keeps retrieval provenance separate from the final ranking decision.

## Phase 8 — Local multimodal model

A local multimodal model is **not an MVP prerequisite**. It should be introduced only when measured recommendation errors show that title/channel text is insufficient.

### Video understanding pipeline

```
YouTube video
  title
  description / metadata
  channel
  thumbnail
  user interaction history
       ↓
multimodal understanding
       ↓
structured video profile
       ├── topics
       ├── subtopics
       ├── entities
       ├── format
       ├── intent
       ├── audience
       ├── confidence
       └── embedding
       ↓
recommendation engine
       ↓
ranking
```

The multimodal model should primarily be an **enrichment/classification component**, not the final recommender.

A useful representation is multi-label and probabilistic:

```
gaming          0.99
Elden Ring      0.98
RPG             0.94
lore            0.73
tutorial        0.61
entertainment   0.88
```

The user model can then maintain semantic affinities such as:

```
gaming          0.86
soulslike       0.94
Elden Ring      0.97
programming     0.72
machine_learning 0.81
football       0.18
```

### Context levels

1. **Video-level:** title, description, thumbnail, duration, date, channel.
2. **Channel-level:** creator summary and recent-video context.
3. **User-level:** interests, objectives, and interaction history.

Embeddings should support semantic relatedness, such as recognizing that interest in Elden Ring may imply useful adjacency to Dark Souls, Sekiro, Bloodborne, or Lies of P without hard-coding those relationships.

### Hybrid video profile

```json
{
  "topics": ["gaming", "action_rpg", "soulslike"],
  "entities": ["Elden Ring", "Malenia"],
  "format": "gameplay",
  "intent": "entertainment",
  "creator_profile": {
    "gaming": 0.99,
    "soulslike": 0.97
  },
  "semantic_embedding": "...",
  "confidence": 0.96
}
```

Ranking can then combine:

```
topic_affinity
+ entity_affinity
+ semantic_similarity
+ creator_affinity
+ format_affinity
+ freshness
+ novelty
+ historical_engagement
- repetition
```

### Model strategy

Do not train a general-purpose multimodal model from scratch.

A practical research path is:

```
large multimodal teacher
        ↓
structured semantic profiles + embeddings
        ↓
real MyAlgo interaction data
        ↓
distillation
        ↓
small multimodal / embedding student
        ↓
quantization
        ↓
browser-local inference
```

Candidate families to benchmark include SmolVLM, SigLIP/SigLIP2, and larger Qwen-VL-family teachers. The objective is not benchmark prestige; it is recommendation-relevant semantic quality per MB and per inference millisecond.

The most valuable eventual training data is user-specific behavior:

```
video representation
+ user representation
+ actual behavior
```

### Local model size and MV3 lifecycle constraint

Earlier planning estimates ranged from roughly 20–70 MB to roughly 50–100 MB for a useful local multimodal stack. These are planning estimates, not requirements. A safer initial engineering assumption is approximately 50–100 MB until model selection, quantization, tokenizer/runtime overhead, and packaging are measured.

Chrome MV3 service workers are non-persistent. The architecture must therefore **not assume that a 50–100 MB model stays loaded**.

Before committing to a bundled multimodal model, run a lifecycle spike covering:

- cold-start latency;
- model initialization time;
- peak memory;
- WebAssembly vs WebGPU behavior;
- inference throughput;
- service-worker suspension and restart;
- offscreen-document lifecycle;
- cache reuse;
- CPU and battery impact;
- behavior on lower-end hardware.

A smaller model that survives the browser lifecycle reliably is preferable to a larger model that is theoretically better but operationally unusable.

### Inference architecture

Analyze each video at most once per model/analysis version and cache its semantic profile by video ID plus analysis version. Thousands of embeddings should remain inexpensive to rank.

A two-stage architecture is worth testing:

1. cheap text/image embedding encoder for most videos;
2. tiny multimodal model only for ambiguous or novel cases.

## Phase 9 — Productization

Only after the local recommendation loop is demonstrated:

- sync
- accounts
- optional cloud services
- billing
- additional connectors
- export/import of portable preference representations

Cloud services should remain optional rather than becoming a hidden dependency of the core recommendation loop.

## Competitive / ecosystem validation

The competitive landscape should be treated as evidence about user demand and product scope, not as a reason to expand Phase 1.

### NeuroFilterAI

NeuroFilterAI is useful validation that a single Chrome extension can perform on-device semantic filtering without requiring a companion service. Public product material describes local transformer inference using MiniLM/Transformers.js and an MV3 offscreen-document architecture, with public claims around a roughly three-second cold start and a Chrome Web Store package around 37.9 MiB.

Its scope is narrower than MyAlgo's intended model: it primarily scores/filters videos against declared intent rather than maintaining an editable personal recommendation model with multiple retrieval lanes.

Any public revenue or user-count figures should be treated as self-reported or third-party market signals rather than independently verified facts.

### Winnow

Winnow is a relevant current YouTube Firefox add-on reference. It reads subscriptions/Home recommendations and scores them against a free-text interest profile in the browser. Its current YouTube implementation uses a user-supplied Anthropic/OpenAI API key, so it is not fully local.

The separate Winnow Chrome/X experience is also precedent for transparent local deterministic scoring, but it is not a direct YouTube equivalent.

### YouTube Custom Feed

YouTube introduced “Your custom feed” in 2026, a prompt-based dedicated feed that refreshes from a user's request. Its rollout validates demand for user-directed recommendation experiences and creates direct competitive pressure.

MyAlgo should not assume that a prompt-driven custom feed is equivalent to an inspectable user-owned recommendation model. The product hypothesis remains that MyAlgo can expose the representation, objective, retrieval provenance, and scoring trace as objects the user can inspect and edit.

### Competitive differentiation hypothesis

The intended combination is:

```
local ownership
+ inspectable personal representation
+ editable objectives
+ multi-source retrieval
+ semantic / multimodal enrichment
+ transparent ranking traces
+ user-controlled modes
```

This is a differentiation hypothesis, not a claim that no other product implements any individual part of the combination.

## Explicitly deferred

The following remain intentionally deferred until measured product evidence justifies them:

- multi-platform support
- bundled large models
- microservices
- Kubernetes
- broad cloud data warehouse
- automatic cross-platform graph merging
- large-scale teacher-model training before real MyAlgo interaction data
- complex retrieval infrastructure before the local representation is useful
