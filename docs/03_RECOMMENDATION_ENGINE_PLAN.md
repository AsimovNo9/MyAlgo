# Recommendation / Personal Algorithm Engine

## Objective

The engine does not attempt to reproduce YouTube's proprietary recommender.

It creates an interpretable **surrogate personal model** from observable user evidence and applies that model to candidates visible to the connector.

## Pipeline

```text
Observe
  ↓
Normalize evidence
  ↓
Infer/update graph
  ↓
Extract content evidence
  ↓
Match content to graph
  ↓
Apply hard policies
  ↓
Additive scoring
  ↓
Explain
  ↓
Enforce
```

## Bootstrap and live behavioral evidence

The initial bootstrap spike is **watch-history DOM extraction**. History remains
useful for seeding and fallback because it exposes rendered historical activity
without relying on the YouTube Data API.

For live sessions, the primary `watched` signal is temporal HTML media
playback. The connector accumulates actual playback time for a video/player
session and emits one watched observation after the deterministic threshold is
reached. Paused, buffering, advertising, and seek jumps do not count. A recent
selection may carry the exact contextual `exposureId` into the watched event;
watching without a captured selection is still valid.

The two sources have distinct provenance:

```text
Player playback → watched → primary live behavioral evidence
History DOM     → watched → bootstrap/fallback evidence
```

Neither source directly implies preference. Both are raw behavioral evidence
that the correlation layer can recompute into a deterministic timeline.

### Home recommendation context

The Home page is a second P0 observation stream. Store visible recommendation
cards as `surfaced` context with position and section metadata. Do not infer that
the user likes a topic merely because YouTube showed it. Correlate a surfaced
item with a later click and/or watched observation to produce an observable
sequence:

```text
surfaced → clicked → watched
```

The correlation layer preserves raw events and does not invent a click, exposure,
or preference. Repeatedly surfaced but unobserved items are a future
avoidance/negative-signal research question, not an automatic P0 preference
update.

## Candidate acquisition

The runtime acquires candidates through rendered YouTube pages plus the merged #206/#212 acquisition foundation: opt-in RSS and opt-in YouTube search-page discovery behind connector-owned adapters. All acquisition mechanisms feed the same bounded local reservoir and deterministic scorer.

The repository already contains deterministic planning primitives:

- `buildRetrievalCoordinatorPlan()` for bounded per-topic lane budgets;
- `buildRecommendationProfile()` for goal/topic/format/creator intent;
- `buildRecommendationQueries()` and `buildRecommendationQueryPlans()` for inspectable goal/topic/alias/format/intent/creator/freshness queries.

The merged #206 implementation bridges current `PersonalAlgorithmState` graph state into retrieval intent deterministically; the legacy `Algorithm` object is not revived as a second preference model.

The implemented acquisition mechanisms are:

1. **RSS** — bounded source/channel update discovery;
2. **YouTube search-page discovery** — opt-in queries derived from normalized graph concepts, explicit goals, and active mode intent rather than raw history rows.

Retrieval expands the candidate set only. It must not directly update preference weights or create graph evidence. Each acquired candidate carries source-neutral acquisition provenance and then flows through the same local deterministic scorer and policy as browser-observed candidates.

The provenance cleanup in #202 should distinguish connector/provider, acquisition mechanism (`observed_dom`, `rss`, `web_search`, `exploration`), query lane, graph/algorithm revision, and retrieval time. Provider/API-like labels such as `youtube_search` should not survive the #206 implementation.

## Candidate scoring resolution and presentation calibration

Live validation on PR #208 showed that the first local scorer is too coarse for a large candidate reservoir: many videos receive the same raw score because the runtime primarily matches content identity, creator identity, the `created_by` relation, and explicit feedback.

The next deterministic scoring layer (#210) keeps the additive trace as the authoritative score but extracts more local candidate features:

- lexical objective/topic/concept matches against graph nodes;
- creator affinity through graph identity;
- format compatibility;
- bounded freshness;
- explicit user feedback and hard policy;
- future semantic similarity from #209 only as another explicit traceable contribution.

Retrieval provenance is **not** a preference feature. A video does not receive a positive score merely because RSS or web search found it.

The scorer should retain two values:

```text
raw additive score        → exact replay / explanation / counterfactuals
calibrated display score  → bounded 0-100 UI and replacement comparison
```

Calibration must be deterministic and monotonic. Replacement should require a configurable minimum uplift once score resolution is sufficient, rather than using equal-score churn as normal behavior.

### Replacement-card metadata

A MyAlgo replacement must read like a real video card, not a debugging surface. Title and creator/channel are first-class visible metadata and must remain present even when thumbnail metadata is absent. MyAlgo provenance/score/Why-this controls are secondary annotations.

### Search status

Graph-derived query planning, RSS acquisition, and zero-config YouTube search-page discovery are implemented in #206/#212. Web discovery remains explicitly user-enabled, bounded, provenance-tagged, and separate from preference evidence. Search-page metadata is discovery-only; canonical watch-page enrichment supplies richer candidate metadata before scoring.

## Content understanding and semantic enrichment

Prefer a layered approach:

1. deterministic metadata extraction;
2. transcript/text enrichment where legitimately available;
3. local embeddings/semantic matching when justified;
4. vision analysis for measured visual gaps;
5. local generative disambiguation/explanation synthesis only where deterministic methods are insufficient.

No model is allowed to silently become the user's preference model.

### Semantic mode reranking after PR #212

PR #212 established that acquisition can populate the candidate reservoir, but live use showed that lexical classification and deterministic metadata features do not yet reshape the feed strongly enough.

The next ranking architecture is:

```text
candidate enriched text ──→ local embedding
                              │
Personal Algorithm Graph ──→ graph node embeddings
                              │
active mode seed ──────────→ semantic mode lens over graph nodes
                              │
                              ▼
                    explicit similarities
                 graph match + mode alignment
                              │
                              ▼
                 deterministic scorer / trace
                              │
                              ▼
                     calibrated reranking
```

Modes remain one graph with different semantic emphasis. Work, Learning, Relax, Gaming, and French have fixed text anchors in the local model. Each candidate embedding is compared with all five anchors, independently of the selected mode; the highest qualifying cosine similarity gives the category badge. This affinity is a relative signal, not a calibrated probability or evidence that the model has trained on the user's feed. A mode profile also selects/weights graph objective/topic/concept nodes according to embedding similarity. Graph-derived or user-created modes remain future work under #161.

Selecting a mode applies a bounded, traceable category-affinity contribution alongside the existing graph and mode semantic contributions. It also shapes optional search intent. A candidate can retain its inferred badge while a different mode is selected. If local neural inference fails, the existing hash fallback remains available and diagnostics identify the effective backend; inferred categories are recomputable derived features.

On YouTube Home, the feed replacement slider sets a target fraction of native video slots: 0 keeps eligible native cards, and 100 attempts to fill all safe slots from the scored candidate pool. Intermediate values favor replacements that improve on the native score, with a smaller uplift requirement nearer 100. Only distinct, eligible, trace-backed pool candidates can replace native cards. Insufficient pool coverage leaves native cards in place; explicit source filters and hard policy remain authoritative. This changes presentation, not the underlying evidence graph.

### Local embedding layer (#209)

Embeddings are derived features around the Personal Algorithm Graph, not the graph itself. The intended uses are:

- graph-semantic neighbourhood discovery between concept/topic/objective/creator nodes;
- bounded semantic expansion for retrieval queries;
- candidate-to-goal/topic semantic matching;
- interest-cluster suggestions for later graph controls (#178);
- support for symbolic explanation paths in #153.

The local embedding record must be versioned and recomputable from stable owner identity + model/version + input hash. Replacing the embedding model must not invalidate canonical evidence, explicit graph edits, or user-owned preference state.

Semantic similarity enters ranking only as explicit traceable features/contributions. Hard exclusions, explicit feedback, and deterministic graph policy remain authoritative.

The retrieval planner should accept a bounded set of semantic expansion terms later without changing RSS/web-search adapter contracts. #206 therefore owns acquisition; #209 owns semantic expansion/enrichment.

For explanation generation, a local generative model may verbalize exact trace data:

```text
acquisition provenance
+ matched symbolic graph path
+ exact score contributions
+ trace/graph revision
        ↓
optional local explanation synthesis
```

It must not receive unrestricted raw history and independently invent a preference rationale.

## Additive scoring

Example:

```text
base                           0.00
Elden Ring match              +0.82
RPG match                     +0.34
Build Guides match            +0.51
recent negative feedback      -0.20
------------------------------------
final                          1.47
```

These contributions are native model terms.

## Deterministic scorer (#151)

The Personal Algorithm scorer is a source-neutral pure computation over a versioned Personal Algorithm state, a candidate, and an explicit scoring policy. It does not infer preference from raw `watched` evidence.

Scoring order is fixed:

```text
hard exclusions
    ↓
eligibility
    ↓
base score
    ↓
node contributions
    ↓
edge contributions
    ↓
feedback contributions
    ↓
mode adjustments
    ↓
suppression policy
    ↓
final score + trace
```

The trace records the scorer/policy revisions, graph revision, deterministic evidence revision, matched graph paths, exact contribution terms, evidence support IDs, and policy outcome. Trace IDs are derived from those inputs rather than wall-clock time, so replaying the same graph/evidence/candidate/policy produces the same score and trace identity. `traceContributionTotal()` and `isScoreTraceConsistent()` enforce the invariant that the displayed decomposition equals the native scorer output.

Hard exclusions and eligibility short-circuit before any additive contribution is evaluated. Suppression is represented as a final trace contribution so the displayed decomposition still reconciles exactly to the final score.

The scorer accepts explicit node/relation weights, bounded feedback signals, and mode-specific weight/policy adjustments. Those are policy inputs; they are not learned implicitly by the scorer. Extension runtime wiring belongs to #169, while preference inference remains a separate upstream concern.

## Feedback

Feedback should update graph evidence or bounded preference state.

Examples:

- More like this → strengthen relevant path.
- Less like this → weaken relevant path.
- Mute → hard suppression.
- Forget → remove selected evidence/relationship.

Do not let a single click rewrite the entire graph.

## Candidate coverage

Track separately:

```text
observed candidates
→ candidates with usable evidence
→ graph-matching candidates
→ eligible candidates
→ visible candidates
→ replacement candidates
```

A classification improvement cannot compensate for an empty candidate pool.

## Counterfactual replay

Store enough recent candidate/evidence state to replay:

```text
current graph → current result
hypothetical graph → simulated result
```

This is local computation whenever possible.

## Modes

Modes modify policy/weights over one graph.

They should not fork the underlying evidence graph.


## Mode-aware retrieval and content classification

Mode is a user-intent overlay, not a statement about every candidate.

The active mode modifies retrieval intent and adds a bounded traceable score contribution only when candidate classification supports that mode:

```text
Personal Algorithm Graph goal/topics
        +
active mode intent
        ↓
bounded search query plans
        ↓
web/RSS candidate acquisition
        ↓
canonical YouTube metadata enrichment
        ↓
candidate content classification
        ↓
deterministic score + trace
```

Examples:

- Learning mode expands the graph goal toward learn/understand/study and prefers tutorial/lecture/course/explainer query forms.
- Work mode adds practical implementation/build/solve intent and prefers guides/tutorials/case studies.
- Relax mode adds relax/enjoy intent and prefers documentary/podcast/music-style query forms.
- Gaming mode adds gaming/gameplay intent and prefers gameplay/review/guide forms.
- French mode adds French-language/francophone intent and prefers language practice and French video forms.

The active mode must not be rendered as a label on every video. A visible category badge reflects the candidate's own highest qualifying anchor similarity, independent of the active mode; the conservative metadata-based Learning badge remains a fallback. A video can therefore be scored while Learning mode is active without being labeled Learning.

### Web search adapter

The first concrete provider is YouTube search-page discovery. The `WebSearchProvider` abstraction remains source-neutral, but the launch implementation issues bounded generated queries only to `https://www.youtube.com/results`, parses stable YouTube video IDs from `ytInitialData`, deduplicates them, and then runs those IDs through the canonical watch-page enrichment layer before scoring. No search box, API key, third-party search host, or optional host permission is required. Search receives only bounded graph-derived goal/topic queries plus mode intent. Results are restricted to YouTube URLs, normalized to stable video IDs, deduplicated, and passed through canonical YouTube watch-page enrichment before scoring.

Search result snippets are discovery metadata, not recommendation evidence and not authoritative video metadata.


### PR #212 handoff

PR #212 is merged and #206 is closed. Live acquisition diagnostics established the search → reservoir path; its connector-owned acquisition, offscreen search worker, bounded retention, and retrieved-discovery exploration are now foundation behavior rather than the active implementation slice.

PR #213 is the active #209/#210 branch. Live validation should focus on semantic first-paint isolation, semantic follow-up reranking, mode-dependent score/rank changes, cache bounds, replacement stability, and deletion/re-disclosure behavior.

### Retrieved-discovery exploration

Retrieval provenance does not add preference weight. Search/RSS candidates are still scored by the same graph, metadata, mode-alignment, feedback, and policy signals as observed candidates.

To prevent qualified retrieved candidates from being permanently crowded out of the global off-page ranking, presentation reserves at most two exploration opportunities per generation for recently retrieved discovery candidates. An exploration replacement must:
- clear the normal replacement minimum score;
- remain visible/eligible/unsuppressed;
- not duplicate a native or already-used candidate;
- score at least as high as the native target it would replace.

All remaining opportunistic replacements retain the stricter normal uplift requirement. This changes presentation opportunity, not candidate score.
