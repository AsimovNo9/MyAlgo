# Personal Algorithm Status

**Status date:** 2026-09-20
**Authority:** This document is the canonical implementation and verification summary. Recommendation requirements, architecture, delivery order, and acceptance criteria live in [RECOMMENDER.md](RECOMMENDER.md); execution tasks live in [../TODO.md](../TODO.md).

## Status Vocabulary

- **Implemented**: the relevant code, migration, or documentation exists in the repository.
- **Verified locally**: implemented and validated by focused local tests, typecheck, build, or schema checks.
- **Verified in production**: validated against the deployed app, production database, real OAuth/provider flow, or a real extension installation.
- **Planned**: agreed work with no complete implementation yet.
- **Deferred**: intentionally excluded until a measured need or prerequisite exists.

Implemented does not imply verified locally. Verified locally does not imply verified in production.

## Current Matrix

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Shared TypeScript contracts | Verified locally | `packages/shared-types/src/index.ts`; shared contract tests and root typecheck pass. |
| Recommendation evaluation contracts and metrics | Verified locally | `apps/web/lib/recommendation-evaluation.ts` fixtures/metrics and route-boundary tests pass; production baselines are not collected yet. |
| Recommendation baseline collector | Verified locally | `/api/feed` now exposes privacy-safe per-interest pipeline counts and the production collector reports aggregate candidate, semantic-hit, and topic-coverage metrics; authenticated production collection remains open. |
| Semantic reranking evaluation | Verified locally | Feed regression coverage proves bounded semantic similarity improves ordering without bypassing language exclusions; production comparison remains open. |
| Production candidate quality instrumentation | Verified locally | Sync responses now expose duplicate rate, classification coverage, source diversity, topic coverage, and freshness coverage; production baselines remain open. |
| Concept intent aliases and profiles | Verified locally | `apps/web/lib/concepts.ts`, persisted intent migration, normalized database catalog loader, fallback tests, and concepts API path. Query planning, classification, and explanations consume the catalog. |
| Catalog-aware query planning, classification, and explanations | Verified locally | Sync-time discovery queries, deterministic classification, and feed explanations consume approved catalog concepts and relationships. |
| Versioned concept graph schema | Verified in production | `20260920090000_add_concept_graph.sql` and relation tables are applied; production REST verification returns `200`. |
| Persisted content concept matches | Partially verified in production | Existing `content_concepts` matches are production-verified; multi-facet matching and the new `concept_version` migration are locally verified and require production migration/application verification. |
| Candidate generation and bounded retrieval | Implemented, verified locally | RSS, subscriptions, liked content, bounded Search, provenance, and candidate-pool tests exist. Production coverage and quota behavior remain unverified. |
| Discovery ordering and depth controls | Verified locally | Normal Search lanes use relevance ordering, freshness alone uses date ordering, result depth is bounded/configurable, and sync returns aggregate query/result/quota metrics; production quota behavior remains open. |
| YouTube candidate metadata enrichment | Verified locally | Search candidates receive bounded batched `videos.list` metadata for descriptions, tags, category, duration, statistics, channel facets, and language hints; provider fallback is preserved, while cache reuse and production quota/quality remain open. |
| Durable historical taste profile | Verified locally | `taste_profile_affinities` stores bounded facet affinities, evidence, timestamps, source signals, and revisions; protected rebuild and feed/profile consumption paths are implemented, while production migration and historical-data verification remain open. |
| Lane-aware personal reranking | Verified locally | Feed ranking now applies configurable weighted matched/discovery/explore lane interleaving after hard filters and diversity, while preserving every eligible item; production quality and proportion tuning remain open. |
| Graph-aware candidate retrieval | Verified locally | Approved concept relations generate bounded intent queries during YouTube sync; broader source coverage metrics and production quality remain open. |
| Freshness candidate retrieval | Verified locally | Discovery planning adds bounded `topic latest` queries within the existing sync budget; creator-query retrieval remains planned. |
| Explicit creator candidate retrieval | Verified locally | `creator:` and `channel:` positive rules now generate bounded creator query plans; learned creator retrieval remains planned. |
| Learned creator candidate retrieval | Verified locally | Strong channel affinities from liked content and feedback now feed bounded creator queries during YouTube sync. |
| Active algorithm coverage | In progress | Recognized algorithm names now seed retrieval when custom topic weights are weak; live sync should be rerun to populate discovery candidates. |
| Per-interest candidate coverage | Verified locally | Sync and activation gates count coverage per strong topic and trigger when any interest is underrepresented; production sync metrics remain open. |
| Topic-specific activation backfill gate | Verified locally | `POST /api/algorithms/activate` now requires every eligible topic to meet the bounded per-topic threshold and returns aggregate topic coverage; live activation remains unverified. |
| Feed ranking and hard filters | Verified locally | Feed tests cover relevance, rules, diversity, source controls, and watched-state behavior. Real-user quality remains unverified. |
| Extension native-card ranking/replacement | Implemented, verified locally | Content-script build passes. Real YouTube Home/Search/Subscriptions/Shorts compatibility remains unverified. |
| Authentication and YouTube OAuth | Production blocked | Local encryption/refresh paths pass, but the deployed browser currently reports invalid/missing Supabase public configuration before sign-in. Vercel must set valid `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then OAuth/browser smoke tests remain. |
| RLS and production database isolation | Implemented, verified locally | Schema tests pass. Separate production-user isolation test remains planned. |
| Embeddings / pgvector retrieval | Implemented locally / partially verified in production | Sync can optionally generate one profile-anchor embedding, retrieve bounded content matches, preserve similarity/model provenance, and merge vector candidates with existing sources; pgvector tables/RPC are production-verified, while provider configuration, backfill, and live sync quality remain open. |
| LLM semantic fallback and reranking | Implemented locally | Low-confidence Anthropic classification receives approved catalog context; optional semantic similarity contributes to transparent scoring. Production quality impact remains unmeasured. |
| Visual or multimodal classification | Deferred | No measured text/metadata gap justifies it yet. |
| Billing, monitoring, and launch hardening | Planned / partially implemented | Production configuration, token encryption, observability, backups, and release QA remain open. |

## Canonical Next Sequence

1. Complete production safety gates: OAuth, YouTube sync, token refresh/encryption, RLS isolation, cron secrets, and extension live smoke tests.
2. Confirm the merged release deploys the hardened backfill route and configure Vercel embedding variables.
3. Run the authorized production embedding backfill and collect authenticated candidate-quality baselines.
4. Complete real-user OAuth and YouTube browser smoke tests, then compare semantic ranking against the flat-label baseline.
5. Reconcile production metrics and update this document before marking any production status complete.
