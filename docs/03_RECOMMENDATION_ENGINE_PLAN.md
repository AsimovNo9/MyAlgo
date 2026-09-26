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

The current runtime primarily acquires candidates by observing rendered YouTube pages. After PR #205, presentation/replacement can consume a broader local reservoir, so #206 adds independent acquisition without adding a second scorer.

The repository already contains deterministic planning primitives:

- `buildRetrievalCoordinatorPlan()` for bounded per-topic lane budgets;
- `buildRecommendationProfile()` for goal/topic/format/creator intent;
- `buildRecommendationQueries()` and `buildRecommendationQueryPlans()` for inspectable goal/topic/alias/format/intent/creator/freshness queries.

The first implemented acquisition mechanisms should be:

1. **RSS** — bounded source/channel update discovery;
2. **web search** — opt-in queries derived from normalized graph concepts, explicit goals, and retained history-derived concepts rather than raw history rows.

Retrieval expands the candidate set only. It must not directly update preference weights or create graph evidence. Each acquired candidate carries source-neutral acquisition provenance and then flows through the same local deterministic scorer and policy as browser-observed candidates.

The provenance cleanup in #202 should distinguish connector/provider, acquisition mechanism (`observed_dom`, `rss`, `web_search`, `exploration`), query lane, graph/algorithm revision, and retrieval time. Provider/API-like labels such as `youtube_search` should not survive the #206 implementation.

## Content understanding

Prefer a layered approach:

1. deterministic metadata extraction
2. transcript/text enrichment where legitimately available
3. embeddings/semantic matching when justified
4. vision analysis for measured visual gaps
5. LLM disambiguation only where deterministic methods are insufficient

No model is allowed to silently become the user's preference model.

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
