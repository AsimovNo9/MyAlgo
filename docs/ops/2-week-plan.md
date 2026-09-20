# Archived plan: production validation and launch hardening

**Original planning window:** two weeks
**Archived:** 2026-09-20
**Current status authority:** [docs/STATUS.md](../STATUS.md)

This document records the earlier feed-quality and launch-hardening plan. It is no longer the active execution plan. Its unfinished items remain launch gates in [../../TODO.md](../../TODO.md), but their status must be read from the status matrix rather than from this historical checklist.

The active sequence is now:

1. Configure Vercel embedding variables and deploy the hardened backfill route.
2. Run the authorized production embedding backfill and collect aggregate quality baselines.
3. Complete production OAuth, token, RLS, cron, monitoring, and extension smoke-test gates.
4. Compare semantic reranking and graph-aware LLM enrichment against the flat-label baseline.
