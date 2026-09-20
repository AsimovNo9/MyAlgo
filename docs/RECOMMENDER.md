# Recommendation System Contract

**Status date:** 2026-09-20  
**Authority:** This is the sole source of truth for recommendation-system requirements, architecture, implementation status, delivery order, and acceptance criteria.

Product-wide architecture remains in [ARCHITECTURE.md](../ARCHITECTURE.md). Deployment and operational constraints remain in [DEPLOYMENT_AND_SCALING.md](../DEPLOYMENT_AND_SCALING.md). Production verification vocabulary and cross-cutting release gates remain in [STATUS.md](STATUS.md). Do not add recommender requirements to those documents; link here instead.

## 1. Product promise and boundaries

Personal Algorithm is a user-controlled recommendation layer over YouTube. Explicit algorithm preferences are authoritative. Learned signals may add nuance, but may not override hard exclusions or silently replace the user's intent.

The system owns candidate eligibility, classification, ranking, explanations, and feedback. YouTube remains the content source and native platform. Retrieval runs during sync or activation jobs only. `/api/feed`, `/api/rank`, page mutations, and ordinary feed reads consume cached/current candidates and must not start Search, RSS, embeddings, or LLM work.

### MVP goals

- Retrieve relevant content outside the current native/subscription pool.
- Keep topic, concept, entity, creator/channel, language, format, source, freshness, and quality as separate facets.
- Combine subscriptions, liked videos, approved RSS seed channels, bounded YouTube Search, and semantic/vector retrieval when available.
- Apply hard eligibility filters before transparent soft ranking.
- Provide matched, discovery, and controlled explore lanes with diversity and repetition limits.
- Learn from feedback and observed activity without exposing raw activity or allowing learned affinity to dominate explicit intent.
- Measure per-interest coverage, candidate quality, ranking quality, latency, and quota before increasing retrieval or model cost.

### Non-goals until measured need

- Image or multimodal classification.
- Custom model training, separate vector infrastructure, queues, Redis, or microservices.
- Importing complete YouTube watch history.
- Per-user recurring Search on every feed read.
- Weakening hard exclusions to pad an empty feed.

## 2. Current system (verified implementation map)

```text
active algorithm + feedback/activity
        -> recommendation profile
        -> approved concept catalog/graph
        -> bounded query plans and source policy
        -> sync/activation candidate generation
        -> content_items + provenance
        -> deterministic metadata classification
           + optional low-confidence Anthropic fallback
        -> content_concepts and optional embeddings
        -> hard eligibility filters
        -> transparent reranking and diversity
        -> matched / discovery / explore feed
        -> dashboard and extension
        -> feedback/activity
```

| Boundary | Implementation | Current status |
|---|---|---|
| Profile and query planning | `apps/web/lib/recommendation-profile.ts`, `apps/web/lib/discovery.ts` | Implemented and locally verified; plans include goal, topic, alias, intent, creator, format, and freshness lanes. |
| Sources and orchestration | `apps/web/lib/youtube.ts`, `apps/web/lib/rss.ts`, `apps/web/lib/candidate-generation.ts`, activation/sync routes | Implemented and locally verified; production coverage/quota behavior remains open. |
| Concepts and semantic context | `apps/web/lib/concepts.ts`, `apps/web/lib/semantic-catalog.ts`, concept migrations | Implemented; production schema is verified, catalog quality/backfill remain open. |
| Classification | `apps/web/lib/classifier.ts` | Text-first deterministic path plus low-confidence LLM fallback; richer metadata coverage remains open. |
| Ranking and eligibility | `apps/web/lib/feed.ts` | Hard exclusions, relevance, source controls, feedback, freshness, semantic score, diversity, and explanations are implemented and locally tested. |
| Feed boundaries | `apps/web/app/api/feed/route.ts`, `apps/web/app/api/rank/route.ts` | Cached/current candidates only; retrieval must remain outside these paths. |
| Extension | `apps/extension/src/content-scripts/youtube.ts` and background worker | Local build verified; live YouTube surface compatibility remains unverified. |
| Evaluation | `apps/web/lib/recommendation-evaluation.ts`, `apps/web/lib/recommendation-quality.ts` | Offline metrics and sync quality summaries exist; authenticated production baseline remains open. |

The current product gap is **coverage quality**, not a missing large model: a pool can be large while a specific strong interest has too few retrieved, correctly classified, eligible, and visible items.

## 3. Required contracts

### 3.1 Candidate provenance

Every candidate must retain source, external ID, retrieval time, query/lane when applicable, topic anchors, channel, and algorithm revision. Deduplicate by provider and external ID before classification/ranking. Vector candidates additionally retain model/version and similarity provenance.

### 3.2 Profile precedence

1. Explicit `never_show`, language, watched, source, format, and other hard constraints reject candidates.
2. Explicit topics, goal, and `always_show` intent guide eligibility and ranking.
3. Feedback and historical affinities tune ranking with bounded strength and confidence.
4. Freshness, quality, novelty, diversity, and exploration break ties and allocate lanes.

Semantic similarity, embeddings, or LLM output may never bypass a hard exclusion.

### 3.3 Source policy

Use shared classified content and approved RSS first. Use subscriptions and likes as user evidence and candidate sources. Use Search for bounded, measured gap filling. Use vector retrieval as an additional candidate source only after its inputs and fallback behavior are verified. Retrieval remains sync/activation work and is never performed from a page mutation.

Default Search budget remains at most 5 queries and 5 results per query per sync until metrics justify change. Normal topic/intent/creator/format searches use relevance ordering; freshness searches alone use date ordering and `publishedAfter`.

### 3.4 Classification and facets

Classification is metadata-first and may attach multiple matching concepts. At minimum, candidates expose canonical topics/concepts, entities, creator/channel, language, format/content type, source, publish time, confidence, and quality. A generic label must not erase a more specific matching concept.

### 3.5 Feed lanes and explanations

The feed may contain three explicit lanes: `matched`, `discovery`, and `explore`. Allocation is bounded and configurable. Explanations use approved user-facing concept names and preference connections, for example “Matches your RPG interest” or “New discovery related to Game Design.” Raw prompts, vector distances, and internal classifier strings are not user-facing.

## 4. Delivery sequence

### Phase 0: safety and measurement

Complete production OAuth/token encryption, RLS isolation, cron authorization, extension live smoke tests, and the privacy-safe production baseline. Record per-interest counts at retrieval, classified match, hard-filter survival, and visible output stages. This is the gate for all quality tuning.

### Phase 1: retrieval coverage

Fix query ordering and configurable bounded depth. Ensure balanced multi-topic algorithms receive topic queries even when no topic crosses an absolute threshold. Keep per-interest sufficiency gates, RSS approval workflow, provenance, deduplication, and activation/sync-only execution intact.

### Phase 2: durable taste and semantic retrieval

Persist historical affinities separately from short-term activity, with evidence count, confidence, timestamps, and profile revisions. Merge vector matches with Search, RSS, subscription, and liked candidates; preserve model/version provenance and deterministic fallback. Add reviewed/versioned semantic-context ingestion only after approval and idempotence rules exist.

### Phase 3: ranking and user trust

Tune explicit intent, learned affinity, semantic similarity, creator/channel, format, language, quality, freshness, novelty, and exploration. Validate diversity, series suppression, watched-state, negative feedback, and hard-rule precedence. Expose concise approved semantic-path explanations.

### Phase 4: evaluate before expanding

Compare Relevant@K, false positives, per-interest coverage, qualified-candidate rate, semantic retrieval hit rate, novelty, diversity, discovery rate, replacement success, correction rate, sync latency, and quota. Increase budgets or add visual understanding only when a measured gap and a clear acceptance test justify it.

## 5. GitHub implementation issue map

These focused issues are the recommendation execution backlog. Closed predecessors #22 and #63 are retained in GitHub history but must not receive new work.

| Order | Issue | Scope | Depends on |
|---:|---|---|---|
| 1 | #105 | Offline and privacy-safe production quality baselines | Existing evaluation helpers |
| 2 | #110 | Topic-specific activation coverage and bounded thin-lane backfill | #105 instrumentation |
| 3 | #100 | Search depth, ordering, configurable result budget, useful-candidate metrics | #105 instrumentation |
| 4 | #103 | Enrich YouTube candidates before semantic classification | #100; quota measurement |
| 5 | #111 | Preserve multi-facet concept matches through classification | #103; approved catalog |
| 6 | #102 | Persistent historical taste profile and rebuild/reset | #105; activity/feedback tables |
| 7 | #101 | Vector retrieval as a first-class, safely optional candidate source | #100; embedding status/backfill |
| 8 | #104 | Personal reranking, lane allocation, diversity, exploration controls | #102 and #101 |
| 9 | #107 | Approved semantic-path explanations and debug provenance | #104; approved concept graph |
| 10 | #106 | Reviewed/versioned semantic-context repository ingestion | #105; concept governance |

Existing local issue notes must link to these issue numbers rather than restating requirements. Production safety work in `TODO.md` remains a release gate, not a competing recommender roadmap.

## 6. Definition of done for the recommendation system

The system is ready for broader product evaluation when all of the following are true:

- Each strong explicit interest reports retrieved, classified-matching, eligible, and visible counts.
- A sync can add candidates from at least two independent sources beyond subscriptions, with provenance and deduplication.
- Hard exclusions remain correct under Search, RSS, vector, LLM, watched, and extension replacement paths.
- Historical taste affects ranking outside the current candidate batch and can be rebuilt or reset.
- Feed lanes, diversity, exploration, and explanations are deterministic enough to test.
- Offline and production aggregate baselines are recorded before semantic score or budget changes.
- `/api/feed` and `/api/rank` remain retrieval-free and latency-bounded.
- Live extension behavior is verified on Home, Search, Subscriptions, Shorts, navigation, and infinite scroll.

## 7. Verification commands

```bash
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter extension typecheck
pnpm --filter extension build
node --test packages/db/schema.test.mjs
node scripts/verify-production-pgvector.mjs
node scripts/collect-production-baseline.mjs
```
