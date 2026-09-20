# Recommendation Issue Register

Repository: `AsimovNo9/MyAlgo`

The authoritative recommendation requirements and delivery order are in [RECOMMENDER.md](RECOMMENDER.md). This file is only a compact register of GitHub execution issues; issue bodies are the detailed implementation contract.

## Remaining Issues In Priority Order

The recommender implementation milestone is complete in merged PRs #113, #115–#123. Remaining work is production validation and release readiness:

1. [#3 Complete extension authentication in production](https://github.com/AsimovNo9/MyAlgo/issues/3) — production OAuth, bearer sessions, token persistence/refresh, and sign-out validation.
2. [#9 Finish launch security review](https://github.com/AsimovNo9/MyAlgo/issues/9) — secrets, CORS, RLS isolation, and environment separation.
3. [#8 Add production observability and health checks](https://github.com/AsimovNo9/MyAlgo/issues/8) — structured failures, provider quota/sync visibility, and error monitoring.
4. [#4 Make mode switching visibly change the YouTube feed](https://github.com/AsimovNo9/MyAlgo/issues/4) — production validation of mode-specific ranking and extension behavior.
5. [#10 Package and document the Edge release](https://github.com/AsimovNo9/MyAlgo/issues/10) — release workflow, extension ID/redirect setup, and store submission requirements.

## Merged Recommender Implementation Issues

- Historical merged PRs #108 and #109 completed per-interest coverage and generalized approved-concept alias expansion.
- #108 — Build per-interest candidate coverage
- #109 — Expand every approved concept through aliases and intents
- #100 -> [PR #116](https://github.com/AsimovNo9/MyAlgo/pull/116)
- #101 -> [PR #120](https://github.com/AsimovNo9/MyAlgo/pull/120)
- #102 -> [PR #119](https://github.com/AsimovNo9/MyAlgo/pull/119)
- #103 -> [PR #117](https://github.com/AsimovNo9/MyAlgo/pull/117)
- #104 -> [PR #121](https://github.com/AsimovNo9/MyAlgo/pull/121)
- #105 -> [PR #113](https://github.com/AsimovNo9/MyAlgo/pull/113)
- #106 -> [PR #123](https://github.com/AsimovNo9/MyAlgo/pull/123)
- #107 -> [PR #122](https://github.com/AsimovNo9/MyAlgo/pull/122)
- #110 -> [PR #115](https://github.com/AsimovNo9/MyAlgo/pull/115)
- #111 -> [PR #118](https://github.com/AsimovNo9/MyAlgo/pull/118)

## Closed Superseded Issues

- [#22 Add semantic topic concepts and intent resolution](https://github.com/AsimovNo9/MyAlgo/issues/22) — semantic foundation implemented; future governance work is #106.
- [#63 Build taste profile and candidate generation engine](https://github.com/AsimovNo9/MyAlgo/issues/63) — umbrella predecessor replaced by focused issues above.
- [#5 Improve classification quality beyond title heuristics](https://github.com/AsimovNo9/MyAlgo/issues/5) — superseded by #103.
- [#6 Add feedback and ranking regression coverage](https://github.com/AsimovNo9/MyAlgo/issues/6) — local coverage exists; broader baselines are #105.
- [#7 Add CI for the monorepo and extension artifact](https://github.com/AsimovNo9/MyAlgo/issues/7) — CI is implemented locally.

## Cross-cutting release gates

OAuth/token encryption, RLS isolation, cron authorization, production embedding configuration, and live extension smoke tests remain tracked in [../TODO.md](../TODO.md) and [STATUS.md](STATUS.md). They are prerequisites for production claims, not alternate recommender requirements.
