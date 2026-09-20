# Personal Algorithm Recommender: Current State

**Status date:** 2026-09-20
**Primary platform:** YouTube Web
**Runtime:** Next.js on Vercel, Supabase Postgres/Auth, Chrome MV3 extension
**Canonical status matrix:** [STATUS.md](STATUS.md)

## Executive Summary

Personal Algorithm is a user-controlled recommendation layer over YouTube. It does not replace YouTube's own recommender. It retrieves and stores candidate videos, classifies them, applies explicit user rules and learned signals, ranks the result, and uses the extension to hide, reorder, or replace native YouTube cards.

The system has moved beyond a simple feed filter. The current implementation includes:

- Explicit algorithms with weighted topics, goals, formats, language, and rules.
- Subscriptions, liked videos, bounded YouTube Search, and RSS seed-channel ingestion.
- A versioned concept graph with aliases, intents, relations, and provenance.
- Catalog-aware query planning and deterministic classification.
- Persisted candidate-to-concept matches.
- Optional pgvector storage and similarity RPC retrieval.
- Optional embedding generation/backfill.
- Low-confidence Anthropic classification with approved semantic context.
- Transparent scoring, hard exclusions, diversity, freshness, watched-content exclusion, and explanations.
- YouTube native-card replacement behavior.

The most important remaining product problem is coverage quality: the system can retrieve candidates, but the active algorithm and candidate pool must be broad enough to produce several relevant results instead of one highly repeated or historically biased item.

## Current Data Flow

```text
User algorithm + learned signals
        |
        v
Recommendation profile
  topics, aliases, intents, creators, formats, language
        |
        v
Approved concept graph
  canonical concepts, aliases, relations, phrases
        |
        v
Bounded query planner
  goal, topic, alias, graph intent, creator, format, freshness
        |
        v
Candidate retrieval during sync/activation only
  subscriptions, liked videos, YouTube Search, RSS
        |
        v
content_items + retrieval provenance
        |
        v
Metadata classification
  deterministic first, semantic catalog context, optional low-confidence LLM
        |
        v
classifications + content_concepts
        |
        v
Hard eligibility filters
  watched, language, source, format, explicit exclusions
        |
        v
Transparent personal ranker
  explicit match, learned affinity, freshness, channel fit,
  semantic similarity, feedback, diversity, repetition suppression
        |
        v
Matched / discovery / explore feed
        |
        v
Dashboard and YouTube extension
        |
        v
Feedback and observed activity
```

`/api/feed` and `/api/rank` must consume cached/current candidates only. They must not trigger YouTube Search, embedding generation, or LLM work.

## Main Components

### Recommendation profile

[apps/web/lib/recommendation-profile.ts](../apps/web/lib/recommendation-profile.ts) derives a profile from an active algorithm:

- Strong weighted topics
- Goal text
- Aliases and semantic intents
- Positive and negative rule terms
- Preferred formats
- Language
- Explicit `creator:` and `channel:` query terms
- Learned creator terms when available during sync

Recognized algorithm names such as `Gaming` are retained as retrieval topics when custom weights are weak. Concrete topics such as `Elden Ring`, `Game news`, and `IGN` remain important and should be prioritized before broad algorithm labels.

### Concept catalog and graph

[apps/web/lib/concepts.ts](../apps/web/lib/concepts.ts) provides deterministic fallback concepts and profile derivation. [apps/web/lib/semantic-catalog.ts](../apps/web/lib/semantic-catalog.ts) loads approved database concepts and relations, falling back when the database catalog is unavailable.

The database model includes:

- `concept_entries`
- `concept_aliases`
- `concept_relations`
- `algorithm_intent_profiles`
- `content_concepts`

Concept metadata includes aliases, intents, entities, positive/negative phrases, language, source, status, provenance, and version.

Approved graph relations can produce intent queries and explanation text. Pending or rejected concepts are excluded from approved explanation context.

### Candidate retrieval

Candidate retrieval runs during sync/activation, not on page mutations or ordinary feed reads.

Sources:

- Authenticated YouTube subscriptions and recent uploads
- YouTube liked videos where OAuth scope permits
- Bounded YouTube Search discovery
- Approved RSS seed channels
- Shared topic/channel discovery catalog

The Search budget is intentionally small. Query plans are deduplicated and capped. Current lanes include:

- `goal`
- `topic`
- `alias`
- `format`
- `intent`
- `creator`
- `freshness`

The freshness lane reserves a bounded query for the strongest topic and uses YouTube `publishedAfter` for approximately the last 30 days. This is generic and works for games, AI, science, engineering, or any other explicit topic.

Candidate provenance records the source, query, lane, topics, channel, retrieval time, and algorithm revision.

### Classification

[apps/web/lib/classifier.ts](../apps/web/lib/classifier.ts) uses a layered strategy:

1. Deterministic title and metadata rules.
2. Approved concept aliases and intents.
3. Cached classification facets.
4. Anthropic fallback only when deterministic confidence is low.

Classification produces topics, content type, language, format, confidence, quality score, and reasoning. Sync also persists canonical concept matches in `content_concepts`.

### Embeddings and vector retrieval

Supabase pgvector is deployed and verified with:

- `concept_embeddings`
- `content_embeddings`
- HNSW cosine index
- `match_content_embeddings` RPC

[apps/web/lib/vector-retrieval.ts](../apps/web/lib/vector-retrieval.ts) provides bounded, version-filtered similarity lookup with an empty fallback.

[apps/web/lib/embeddings.ts](../apps/web/lib/embeddings.ts) supports OpenAI-compatible embedding APIs using:

```text
EMBEDDING_API_KEY
EMBEDDING_API_URL
EMBEDDING_MODEL
EMBEDDING_MODEL_VERSION
```

The protected backfill endpoint is:

```text
POST /api/embeddings/backfill?limit=25
Authorization: Bearer $CRON_SECRET
```

The protected status endpoint is:

```text
GET /api/embeddings/status
Authorization: Bearer $CRON_SECRET
```

It reports provider configuration presence, model version, and stored row count without returning secrets.

### Ranking

[apps/web/lib/feed.ts](../apps/web/lib/feed.ts) computes a transparent score from:

- Explicit topic match
- Rule effects
- Learned topic/channel/format/language/source affinities
- Subscription affinity
- Channel quality
- Freshness
- Semantic similarity when present
- Positive/negative feedback
- Diversity and series suppression

Hard filters run before soft ranking:

- Watched/revisited/completed content
- Explicit language mismatch
- Explicit format mismatch
- Source controls
- Shorts/live controls
- Never-show rules
- Not-interested feedback

Semantic similarity cannot override hard exclusions.

### Extension

[apps/extension/src/content-scripts/youtube.ts](../apps/extension/src/content-scripts/youtube.ts) does the following:

- Detects native YouTube cards and extracts video IDs/title/channel.
- Sends current page candidates to `/api/rank`.
- Hides/reorders rejected or lower-scoring cards.
- Inserts personal replacement cards into rejected slots.
- Adds a separate personal-picks shelf from the cached feed.
- Keeps injected cards out of candidate collection.
- Records opened/revisited activity.
- Supports Shorts, live, discovery, and subscription filters.

The implementation is locally build-verified. Real browser validation across all YouTube surfaces remains incomplete.

## Observed Results

### Local authenticated run

A clean local run on port `3000` successfully authenticated against the real Supabase/Google setup and completed sync:

```text
Synced 129 items
5 discovered
129 classified
```

The local feed displayed two visible Gaming recommendations, including:

- A backlog video from an existing source
- A fresh discovery video from a new source

This proved that the latest-pool discovery gate can produce new candidates locally.

### Production authenticated run

Production authentication and feed APIs work:

- `/api/health`: `200`, Supabase `ok`
- `/api/feed`: `200` for the authenticated browser session
- `/api/recommendation-profile`: `200`
- Google OAuth callback completed for the approved account
- Feed displayed ranked content and explanations

Production has also verified the concept graph/content-concept/pgvector tables and vector RPC through read-only status checks.

### Production deployment history

The release workflow required several fixes:

- Explicit Vercel project linking
- Correct Vercel team/project identifiers
- Running Vercel from the repository root
- Replacing `vercel deploy --prebuilt` with a fresh source deployment
- Forcing `/api/health` to remain dynamic

The current release process is tag-driven through `.github/workflows/release.yml`.

## Known Negatives and Failure Modes

### 1. Feed coverage can still be too narrow

The user can have many synchronized items while only one or two pass the active algorithm. This happens when:

- Discovery is skipped based on an overly broad historical pool.
- Concrete topic weights are weak or discarded.
- Classifications contain only generic topics.
- Discovery candidates are not yet classified with the right facets.
- Watched/duplicate/source filters remove much of the pool.

The latest-pool discovery gate and algorithm-name retrieval fix address part of this, but production quality needs measurement.

### 2. Learned history can over-concentrate the feed

Liked videos and activity signals create positive channel/topic affinities. These are intentionally bounded, but the system can still feel too focused on previously watched themes. Explicit algorithm topics must remain stronger than learned affinity, and exploration/discovery needs a controlled allocation.

### 3. Sync is slow

A real YouTube sync can take roughly 25-30 seconds because it may:

- Refresh provider tokens
- Fetch subscription uploads
- Fetch channel metadata
- Fetch liked videos
- Run bounded Search
- Classify each candidate
- Persist content concepts and embeddings

This should eventually be split into asynchronous job progress, but the current architecture deliberately avoids queues until measured scale requires them.

### 4. Production environment configuration is fragile

The browser previously crashed when public Supabase variables were missing. The client/server guards now fail gracefully, but Vercel must still have the correct variables at build/runtime:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- OAuth and cron variables
- Embedding provider variables

Public variables are build-time inputs and require a fresh deployment after changes.

### 5. Local and production OAuth redirects differ

Local testing requires a localhost callback such as:

```text
http://localhost:3000/auth/callback
```

Production uses:

```text
https://my-algo-web.vercel.app/auth/callback
```

Supabase and Google must allow both where appropriate. A local server can otherwise redirect back to production or fail to persist the local session.

### 6. Database schema drift is possible

The application once queried concept metadata columns that were absent from the remote schema. The tracked migration fixed the source, but migration status must be checked after schema changes. The schema test suite catches repository drift; production verification scripts catch remote drift.

### 7. YouTube API access and quota are external dependencies

Subscription sync depends on valid Google provider tokens. Search is quota-expensive and shared across the project. RSS is preferred for recurring niche-channel coverage. Partial provider failures should not make the existing feed disappear.

### 8. Vercel deployment workflow can hide environment changes

Prebuilt Vercel deployments do not necessarily pick up current project settings/environment variables. The release workflow now creates a fresh source deployment. A tag must be pushed after environment changes.

## Quality and Evaluation

The system has deterministic offline evaluation helpers in [apps/web/lib/recommendation-evaluation.ts](../apps/web/lib/recommendation-evaluation.ts).

Tracked metrics include:

- Relevant@K
- False-positive rate
- Concept coverage
- Novelty
- Diversity
- Replacement success
- Correction rate
- Candidate duplicate rate
- Classification coverage
- Source diversity
- Topic coverage
- Freshness coverage

Production baselines are not yet collected systematically. The protected aggregate collector is:

```text
node scripts/collect-production-baseline.mjs
```

It requires a user access token and reports aggregate counts only.

## Current Non-Blocking Gaps

- Creator retrieval is now implemented for explicit and learned channel affinities, but learned creator quality needs evaluation.
- The candidate pool needs richer descriptions, provider taxonomy, entities, and creator metadata.
- User-interest embeddings are not yet generated as a distinct profile vector.
- Embedding backfill is implemented but production provider configuration/backfill must be verified.
- Graph-aware LLM enrichment needs quality comparison against deterministic classification.
- YouTube extension replacement behavior needs real Home/Search/Subscriptions/Shorts/infinite-scroll testing.
- Monitoring, backups, and RLS isolation need production validation.
- Visual/multimodal classification remains deferred.

## Immediate Next Steps

1. Confirm PR #97 and the concept metadata migration are deployed.
2. Run an authenticated production sync and record discovered/visible counts.
3. Run the protected embedding status and bounded backfill endpoints.
4. Collect the production aggregate baseline before increasing semantic score weights.
5. Test the extension on real YouTube surfaces and verify replacement behavior.
6. Tune explicit-topic weighting and controlled exploration based on metrics, not intuition.

## Verification Commands

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

## Source-of-Truth Documents

- [STATUS.md](STATUS.md)
- [TODO.md](../TODO.md)
- [RECOMMENDER_DESIGN.md](RECOMMENDER_DESIGN.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [DEPLOYMENT_AND_SCALING.md](../DEPLOYMENT_AND_SCALING.md)
