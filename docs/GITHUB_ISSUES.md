# Recommendation Issue Register

Repository: `AsimovNo9/MyAlgo`

The authoritative recommendation requirements and delivery order are in [RECOMMENDER.md](RECOMMENDER.md). This file is only a compact register of GitHub execution issues; issue bodies are the detailed implementation contract.

## Active sequence

1. [#105 Establish offline and production recommendation quality baselines](https://github.com/AsimovNo9/MyAlgo/issues/105) — per-interest retrieval/classification/eligibility/visibility metrics, privacy-safe production aggregates, and regression fixtures.
2. [#110 Make activation coverage topic-specific and backfill thin lanes](https://github.com/AsimovNo9/MyAlgo/issues/110) — per-interest pipeline counts, balanced multi-topic planning, and bounded gap backfill.
3. [#100 Improve YouTube discovery depth and ordering](https://github.com/AsimovNo9/MyAlgo/issues/100) — bounded configurable Search depth, explicit ordering, useful-candidate and quota metrics.
4. [#111 Preserve multi-facet concept matches through classification](https://github.com/AsimovNo9/MyAlgo/issues/111) — retain all approved concept/alias/intent/entity matches with provenance and confidence.
5. [#102 Build a persistent historical taste profile](https://github.com/AsimovNo9/MyAlgo/issues/102) — durable affinities, short/long-term separation, confidence/evidence, rebuild/reset.
6. [#101 Make vector retrieval a first-class candidate source](https://github.com/AsimovNo9/MyAlgo/issues/101) — merge vector candidates with existing sources, preserve model provenance, retain safe fallback.
7. [#104 Add personal reranking, diversity, and exploration controls](https://github.com/AsimovNo9/MyAlgo/issues/104) — explicit-intent precedence, lane allocation, diversity, novelty, and explanations.
8. [#107 Add semantic-path recommendation explanations](https://github.com/AsimovNo9/MyAlgo/issues/107) — approved concept paths and inspectable debug provenance.
9. [#106 Build reviewed semantic-context repository ingestion](https://github.com/AsimovNo9/MyAlgo/issues/106) — governed, versioned, idempotent concept/context imports and embeddings.

## Superseded or umbrella issues

- [#63 Build taste profile and candidate generation engine](https://github.com/AsimovNo9/MyAlgo/issues/63) is an umbrella predecessor. Close it after the focused issue sequence is accepted; do not add new work there.
- [#22 Add semantic topic concepts and intent resolution](https://github.com/AsimovNo9/MyAlgo/issues/22) is the historical semantic foundation. New semantic-context work belongs in #106; current implementation status is in [STATUS.md](STATUS.md).

## Cross-cutting release gates

OAuth/token encryption, RLS isolation, cron authorization, production embedding configuration, and live extension smoke tests remain tracked in [../TODO.md](../TODO.md) and [STATUS.md](STATUS.md). They are prerequisites for production claims, not alternate recommender requirements.
