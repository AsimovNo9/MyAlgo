# Personal Algorithm Status

**Status date:** 2026-09-20
**Authority:** This document is the canonical implementation and verification summary. Product requirements live in [personal-algorithm-requirements-architecture-todo.md](personal-algorithm-requirements-architecture-todo.md); execution tasks live in [../TODO.md](../TODO.md).

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
| Production candidate quality instrumentation | Verified locally | Sync responses now expose duplicate rate, classification coverage, source diversity, topic coverage, and freshness coverage; production baselines remain open. |
| Concept intent aliases and profiles | Verified locally | `apps/web/lib/concepts.ts`, persisted intent migration, normalized database catalog loader, fallback tests, and concepts API path. Query-planner/classifier-wide catalog consumption remains planned. |
| Catalog-aware query planning, classification, and explanations | Verified locally | Sync-time discovery queries, deterministic classification, and feed explanations consume approved catalog concepts and relationships. |
| Versioned concept graph schema | Verified in production | `20260920090000_add_concept_graph.sql` and relation tables are applied; production REST verification returns `200`. |
| Persisted content concept matches | Verified in production | `content_concepts` migration is applied and production REST verification returns `200`. |
| Candidate generation and bounded retrieval | Implemented, verified locally | RSS, subscriptions, liked content, bounded Search, provenance, and candidate-pool tests exist. Production coverage and quota behavior remain unverified. |
| Graph-aware candidate retrieval | Verified locally | Approved concept relations generate bounded intent queries during YouTube sync; broader source coverage metrics and production quality remain open. |
| Feed ranking and hard filters | Verified locally | Feed tests cover relevance, rules, diversity, source controls, and watched-state behavior. Real-user quality remains unverified. |
| Extension native-card ranking/replacement | Implemented, verified locally | Content-script build passes. Real YouTube Home/Search/Subscriptions/Shorts compatibility remains unverified. |
| Authentication and YouTube OAuth | Implemented, verified locally | AES-256-GCM token encryption and refresh paths are tested locally. Production sign-in, encrypted persistence, refresh, and extension bearer flow remain unverified. Requires server-only `OAUTH_TOKEN_ENCRYPTION_KEY`. |
| RLS and production database isolation | Implemented, verified locally | Schema tests pass. Separate production-user isolation test remains planned. |
| Embeddings / pgvector retrieval | Verified in production | pgvector tables, HNSW index, and `match_content_embeddings` RPC are applied and return `200`; provider configuration and real backfill remain unverified. |
| LLM semantic fallback and reranking | Implemented locally | Low-confidence Anthropic classification receives approved catalog context; optional semantic similarity contributes to transparent scoring. Production quality impact remains unmeasured. |
| Visual or multimodal classification | Deferred | No measured text/metadata gap justifies it yet. |
| Billing, monitoring, and launch hardening | Planned / partially implemented | Production configuration, token encryption, observability, backups, and release QA remain open. |

## Canonical Next Sequence

1. Complete production safety gates: OAuth, YouTube sync, token refresh/encryption, RLS isolation, cron secrets, and extension live smoke tests.
2. Configure the embedding provider/backfill route with cost and staleness controls, then run a real backfill.
3. Collect authenticated production candidate-quality and semantic-ranking baselines.
4. Compare graph-aware LLM enrichment and semantic reranking against the flat-label baseline.
5. Reconcile production metrics and update this document before marking any production status complete.
