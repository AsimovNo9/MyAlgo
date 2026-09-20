# Archived plan: production validation and launch hardening

**Original planning window:** two weeks
**Archived:** 2026-09-20
**Current status authority:** [docs/STATUS.md](../STATUS.md)

This document records the earlier feed-quality and launch-hardening plan. It is no longer the active execution plan. Its unfinished items remain launch gates in [../../TODO.md](../../TODO.md), but their status must be read from the status matrix rather than from this historical checklist.

The active sequence is now:

1. Complete production OAuth, token, RLS, cron, monitoring, and extension smoke-test gates.
2. Load the database-backed concept catalog with deterministic fallback.
3. Add semantic candidate fixtures and concept matches before enabling vector retrieval.
4. Add bounded, versioned pgvector retrieval only when measured coverage gaps justify it.
5. Add low-confidence, context-aware LLM enrichment and semantic reranking.
