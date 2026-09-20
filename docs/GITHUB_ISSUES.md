# Recommendation Issue Register

Repository: `AsimovNo9/MyAlgo`

The authoritative recommendation requirements and delivery order are in [RECOMMENDER.md](RECOMMENDER.md). This file is only a compact register of GitHub execution issues; issue bodies are the detailed implementation contract.

## Remaining Issues In Priority Order

1. [#105 Establish offline and production recommendation quality baselines](https://github.com/AsimovNo9/MyAlgo/issues/105) — per-interest retrieval/classification/eligibility/visibility metrics, privacy-safe production aggregates, and regression fixtures.
2. [#110 Make activation coverage topic-specific and backfill thin lanes](https://github.com/AsimovNo9/MyAlgo/issues/110) — per-interest pipeline counts, balanced multi-topic planning, and bounded gap backfill.
3. [#100 Improve YouTube discovery depth and ordering](https://github.com/AsimovNo9/MyAlgo/issues/100) — bounded configurable Search depth, explicit ordering, useful-candidate and quota metrics.
4. [#103 Enrich YouTube candidates before semantic classification](https://github.com/AsimovNo9/MyAlgo/issues/103) — bounded metadata enrichment and richer classification facets.
5. [#111 Preserve multi-facet concept matches through classification](https://github.com/AsimovNo9/MyAlgo/issues/111) — retain all approved concept/alias/intent/entity matches with provenance and confidence.
6. [#102 Build a persistent historical taste profile](https://github.com/AsimovNo9/MyAlgo/issues/102) — durable affinities, short/long-term separation, confidence/evidence, rebuild/reset.
7. [#101 Make vector retrieval a first-class candidate source](https://github.com/AsimovNo9/MyAlgo/issues/101) — merge vector candidates with existing sources, preserve model provenance, retain safe fallback.
8. [#104 Add personal reranking, diversity, and exploration controls](https://github.com/AsimovNo9/MyAlgo/issues/104) — explicit-intent precedence, lane allocation, diversity, novelty, and explanations.
9. [#107 Add semantic-path recommendation explanations](https://github.com/AsimovNo9/MyAlgo/issues/107) — approved concept paths and inspectable debug provenance.
10. [#106 Build reviewed semantic-context repository ingestion](https://github.com/AsimovNo9/MyAlgo/issues/106) — governed, versioned, idempotent concept/context imports and embeddings.

11. [#3 Complete extension authentication in production](https://github.com/AsimovNo9/MyAlgo/issues/3) — production OAuth, bearer sessions, token persistence/refresh, and sign-out validation.
12. [#9 Finish launch security review](https://github.com/AsimovNo9/MyAlgo/issues/9) — secrets, CORS, RLS isolation, and environment separation.
13. [#8 Add production observability and health checks](https://github.com/AsimovNo9/MyAlgo/issues/8) — structured failures, provider quota/sync visibility, and error monitoring.
14. [#4 Make mode switching visibly change the YouTube feed](https://github.com/AsimovNo9/MyAlgo/issues/4) — production validation of mode-specific ranking and extension behavior.
15. [#10 Package and document the Edge release](https://github.com/AsimovNo9/MyAlgo/issues/10) — release workflow, extension ID/redirect setup, and store submission requirements.

## Closed Superseded Issues

- [#22 Add semantic topic concepts and intent resolution](https://github.com/AsimovNo9/MyAlgo/issues/22) — semantic foundation implemented; future governance work is #106.
- [#63 Build taste profile and candidate generation engine](https://github.com/AsimovNo9/MyAlgo/issues/63) — umbrella predecessor replaced by focused issues above.
- [#5 Improve classification quality beyond title heuristics](https://github.com/AsimovNo9/MyAlgo/issues/5) — superseded by #103.
- [#6 Add feedback and ranking regression coverage](https://github.com/AsimovNo9/MyAlgo/issues/6) — local coverage exists; broader baselines are #105.
- [#7 Add CI for the monorepo and extension artifact](https://github.com/AsimovNo9/MyAlgo/issues/7) — CI is implemented locally.

## Cross-cutting release gates

OAuth/token encryption, RLS isolation, cron authorization, production embedding configuration, and live extension smoke tests remain tracked in [../TODO.md](../TODO.md) and [STATUS.md](STATUS.md). They are prerequisites for production claims, not alternate recommender requirements.
