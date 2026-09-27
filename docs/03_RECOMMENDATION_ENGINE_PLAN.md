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

PR #213 initially bootstrapped candidate labels from five fixed intent anchors. Post-merge live review showed that nearest-anchor similarity is too coarse to serve as the authoritative content taxonomy: broad anchors can become the least-wrong label for unrelated content. #214 replaces that bootstrap rule with **graph-derived category inference**.

Candidate category vocabulary comes from eligible Personal Algorithm Graph topic/concept labels. A candidate vector is compared with those symbolic graph-node vectors, the strongest bounded scores are retained as rebuildable features, and a visible category is emitted only when the winner clears both an absolute similarity floor and a runner-up margin. Ambiguous candidates remain uncategorized. This is still embedding inference, not model training, and similarity alone never creates a preference edge.

Modes remain semantic lenses over one graph, but the mode surface is no longer a fixed Work/Learning/Relax/Gaming/French list. Available modes are populated from categories actually inferred in local state plus a neutral All/Default state. Selecting an inferred mode adds that category as bounded retrieval/semantic intent and applies exact traceable mode/category-affinity contributions. Known PR #213 bootstrap modes are migrated to All/Default on extension update; an arbitrary custom mode string is preserved so user-owned configuration is not silently discarded.

On YouTube Home, the feed replacement slider sets a target fraction of native video slots: 0 keeps eligible native cards, and 100 attempts to fill all safe slots from the scored candidate pool. Intermediate values favor replacements that improve on the native score, with a smaller uplift requirement nearer 100. Only distinct, eligible, trace-backed pool candidates can replace native cards. #214 also makes a valid source-card → replacement assignment stable across ordinary mutation, metadata, and semantic reranks; generation changes and a short wall-clock timer must not rotate content by themselves. Insufficient pool coverage leaves native cards in place; explicit source filters and hard policy remain authoritative. This changes presentation, not the underlying evidence graph.

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

The active mode must not be rendered as a label on every video. A visible category badge reflects the candidate's own unambiguous graph-derived category match, independent of the active mode; the conservative metadata-based Learning badge remains only a fallback when semantic enrichment is unavailable. A candidate with no clear semantic winner should show no category badge.

### Web search adapter

The first concrete provider is YouTube search-page discovery. The `WebSearchProvider` abstraction remains source-neutral, but the launch implementation issues bounded generated queries only to `https://www.youtube.com/results`, parses stable YouTube video IDs from `ytInitialData`, deduplicates them, and then runs those IDs through the canonical watch-page enrichment layer before scoring. No search box, API key, third-party search host, or optional host permission is required. Search receives only bounded graph-derived goal/topic queries plus mode intent. Results are restricted to YouTube URLs, normalized to stable video IDs, deduplicated, and passed through canonical YouTube watch-page enrichment before scoring.

Search result snippets are discovery metadata, not recommendation evidence and not authoritative video metadata.


### PR #212 handoff

PR #212 is merged and #206 is closed. Live acquisition diagnostics established the search → reservoir path; its connector-owned acquisition, offscreen search worker, bounded retention, and retrieved-discovery exploration are now foundation behavior rather than the active implementation slice.

PR #213 is merged. #214 is the active post-merge refinement: graph-derived category/mode inference, explicit ambiguity handling, and deterministic replacement stability. Replay-backed category quality evaluation belongs with #162 before any decision to fine-tune or replace the embedding encoder.

### Retrieved-discovery exploration

Retrieval provenance does not add preference weight. Search/RSS candidates are still scored by the same graph, metadata, mode-alignment, feedback, and policy signals as observed candidates.

To prevent qualified retrieved candidates from being permanently crowded out of the global off-page ranking, presentation reserves at most two exploration opportunities per generation for recently retrieved discovery candidates. An exploration replacement must:
- clear the normal replacement minimum score;
- remain visible/eligible/unsuppressed;
- not duplicate a native or already-used candidate;
- score at least as high as the native target it would replace.

All remaining opportunistic replacements retain the stricter normal uplift requirement. This changes presentation opportunity, not candidate score.


## Evidence-backed semantic concept materialization (#217)

Live validation after PR #215 showed the real Personal Algorithm Graph had thousands of `content` and `creator` nodes but no `topic`, `concept`, or `objective` nodes. Graph-derived semantic category inference therefore had no vocabulary and correctly reported `graphNodesConsidered: 0`.

#217 inserts the missing layer before canonicalization:

```text
retained interaction evidence
        +
enriched local candidate metadata
        ↓
bounded semantic concept proposals
        ↓
inferred/rebuildable topic + concept nodes
        ↓
evidence-backed about edges
        ↓
semantic reranking
```

Proposal sources are intentionally narrow:
- enriched candidate topics/keywords;
- enriched content type/category;
- retained title keyphrases may reinforce an already-supported metadata topic, but may not create standalone taxonomy nodes.

A proposal must have retained interaction support. Passive Home exposure and search/RSS acquisition alone are not positive preference evidence and cannot materialize a semantic concept.

Derived nodes/edges:
- have deterministic IDs;
- carry `provenance: inferred`;
- carry `derivedBy: semantic-concept-materializer-v1`;
- are marked rebuildable;
- retain exact supporting evidence IDs on inferred edges;
- reconcile as one derived projection without generating synthetic user-edit records;
- bump graph revision only when the derived projection actually changes.

This slice does **not** solve canonicalization. Multiple related concepts may still exist after materialization; #214 canonicalization and durable clustering are the next measured stages.

## Local semantic concept verification (#219 / PR #220)

PR #218 proved the graph projection boundary but also showed that repeated YouTube keywords are too literal/noisy to be accepted directly as semantic graph topics. Live #220 testing also rejected two small generative models for this job. The active design therefore separates **candidate generation**, **topic verification**, and later **canonicalization**.

```text
interaction-supported candidate
        ↓
title + description + metadata keywords
        ↓
deterministic bounded candidate labels
        ↓
local zero-shot NLI verifier
        ↓
0–4 verified multi-label topics
        ↓
#218 evidence-backed materializer
        ↓
derived graph nodes
        ↓
mxbai embedding canonicalization (#214 next)
```

The active verifier is pinned `Xenova/nli-deberta-v3-xsmall` q8. Its upstream base model is MIT-licensed and was trained specifically for entailment/not-entailment zero-shot classification. It runs through the same sandboxed Transformers.js/ONNX surface as the mxbai embedding model.

### Generative-model rejection

Two live generative attempts were useful negative results:

- **FLAN-T5 Small q8** loaded locally, but the 64-item cache contained roughly half empty outputs plus prompt-like/generic strings such as `YouTube video - wikipedia`, `video video`, `seconds`, and instruction echoes.
- **SmolLM2-135M-Instruct q8** reached both WASM and WebGPU execution, but 22 real cached outputs were still dominated by empties/title fragments/prompt fragments, and a two-item WebGPU generation batch could exceed five minutes.

The failure mode was structural: a tiny generative model was being asked to invent clean taxonomy labels. PR #220 now does the narrower task a classifier is strong at: decide which bounded metadata labels are actually entailed by the video text. Alias/abstraction work remains an embedding-canonicalization problem rather than a text-generation problem.

### Verification constraints

- only retained interaction-supported candidates are eligible;
- deterministic candidate labels come from enriched metadata topics, after generic/malformed/duplicate filtering;
- title/description/category text is used as verifier evidence, not as a source of new generated labels;
- zero-shot classification is multi-label, with a conservative minimum score and at most four retained topics;
- an empty verified label set is an intentional abstention and must **not** fall back to raw keyword topics;
- missing verifier output or a verifier runtime failure may fall back to the #218 metadata path;
- output is cached by model identity + verifier-pipeline revision + candidate input hash;
- cache-only embedding-drain passes reuse valid verified labels without starting another verifier batch;
- verifier-cache validity is independent of graph revision; graph materialization re-reads current evidence/candidate state before reconciliation;
- model output remains derived/rebuildable and cannot directly create explicit preference state.

The neural sandbox is cooperative rather than concurrently multi-model: embedding requests yield after each inference batch, a waiting verifier request gets priority at the next yield point, and only one neural operation runs on the GPU at a time.

The purpose of this stage is **precision filtering and abstention**, not alias merging. Related verified labels such as `lofi`, `lofi music`, and `lofi hip hop` may still coexist until #214 embedding-assisted canonicalization reconciles them.

### Post-#220 scoring finding

Live replacement traces after PR #220 exposed the next correctness problem. The local scorer currently matches every topic/concept node lexically against candidate title/description/channel/topics and adds each match independently. With topic weight 14 and common inferred confidence 0.66, one exact inferred-topic match contributes `+9.24`; several aliases/subtopics can therefore stack tens of points even when they represent one underlying interest.

Broad concepts such as `Music`, `Education`, `Commentary`, `review`, or `gameplay` can also accumulate alongside specific labels. Because presentation scoring uses a saturating calibration over the raw additive score, duplicated semantic evidence compresses many materially different raw scores into 97–100/100.

Do not solve this by merely retuning the display calibration. The immediate #221 slice under #214 should:
- create replayable canonical concept/neighbourhood IDs over related source graph nodes;
- preserve source-node/evidence provenance rather than deleting the original nodes;
- compute candidate affinity to the canonical neighbourhood;
- allow at most one bounded semantic score contribution per neighbourhood;
- reconcile legacy lexical graph matches and embedding graph matches so the same canonical neighbourhood cannot contribute twice through two semantic feature paths;
- downweight or separate broad content-type taxonomy from specific preference concepts;
- keep every score-affecting term exact in the trace.

Only after semantic overcount is removed should #210 revisit the display-score mapping.

## Durable semantic mode architecture (#214 / post-#220)

The post-#217 mode architecture must keep four semantic layers separate.

### 1. Canonical graph concepts

The Personal Algorithm Graph remains authoritative. Topic/concept nodes should not be promoted directly to UI modes without normalization. Introduce a deterministic canonicalization/alias step for near-duplicate labels and semantically equivalent variants while preserving provenance to every source node/evidence record.

Canonicalization must be replayable. It may propose that multiple labels belong to one concept identity, but similarity alone must not delete user-authored distinctions or silently rewrite explicit edits.

### 2. Semantic neighbourhoods and mode clusters

A user-facing mode is a **durable cluster over canonical graph nodes**, not a one-node label and not a transient list extracted from the current feed cache.

A mode cluster should contain:
- stable local ID;
- display label;
- member canonical graph node IDs;
- member weights;
- creation/promotion provenance;
- version/revision;
- last-supported timestamp;
- optional pinned/user-edited state.

Derived clusters can be recomputed, but once exposed as a control they need stable identity. A promoted/pinned mode must not disappear because the current feed lacks matching candidates.

### 3. Multi-label candidate affinity

Candidates may qualify for multiple graph regions/modes simultaneously. Preserve a bounded list/map of qualified affinities rather than collapsing all semantic state to one winning label.

The UI may still show one conservative primary badge when the leading label clears the badge confidence/margin rule. That badge is presentation only. Scoring, retrieval and evaluation consume the multi-label affinity set.

### 4. Graph-grounded mode scoring

Do not implement mode behavior as an opaque parallel `mode_adjustment` detached from graph structure.

For an active mode:
- resolve the mode to its member graph nodes;
- compute candidate↔member affinities;
- convert qualified affinities into bounded contributions whose trace entries identify the exact graph node/mode membership responsible;
- aggregate those exact contributions into the final score;
- expose the mode ID/revision and contributing graph node IDs in trace/debug provenance.

The user-facing explanation should be able to say:

`Mode: Local AI work → graph node: local LLM tooling → candidate match +X`

rather than only:

`mode similarity +X`.

### Mode-aware retrieval and supply shortfall

Mode selection changes both **reranking and retrieval planning**.

The retrieval planner should consume the active mode's bounded member-node labels/semantic terms and use the existing acquisition mechanisms. It must not create a separate ungoverned "mode pool."

The Home replacement slider continues to define requested presentation replacement percentage. For an active non-All mode:

```text
requestedModeSlots = replacementQuota(sliderPercent, eligibleNativeSlots)
nativeModeSupply   = eligible current-Home candidates matching active mode
poolModeSupply     = eligible acquired reservoir candidates matching active mode
```

If `nativeModeSupply < requestedModeSlots`, MyAlgo may surface a local banner/status such as "Not enough native <mode> supply — filling from MyAlgo's candidate pool." The trigger must use the same mode-membership and eligibility checks as scoring, so the status cannot disagree with actual feed behavior.

Pool-sourced candidates still pass through:
`hard exclusion → eligibility → additive score → ordering → trace → stable replacement presentation`.

Record shortfall count, requested slots, native matching supply, acquired matching supply, and fulfilled slots as bounded local diagnostics for #162.

### Evaluation-first rule

Threshold changes, clustering heuristics, model replacement, and any future fine-tuning must be evaluated on fixed labelled replay fixtures first. Live feed review remains a validation surface, not the sole quality metric.
