# GitHub Issue Backlog

Repository: `AsimovNo9/MyAlgo`

This backlog is ordered by delivery risk. Each issue is intentionally scoped so a second developer can pick up one slice independently.

## 1. Deploy the live-page ranking API

**Labels:** `priority:high`, `area:backend`, `area:extension`

The extension calls `POST /api/rank` to rank videos currently rendered on YouTube. The production route and its CORS preflight are now deployed and verified; the remaining work is authenticated live ranking validation.

**Acceptance criteria**
- `/api/rank` is available in production.
- Authenticated extension requests return ranked candidates for `Work`, `Learning`, and `Relax`.
- CORS allows the approved extension origin.
- A production smoke test covers the endpoint.

## 2. Make extension YouTube card detection reliable

**Labels:** `priority:high`, `area:extension`

The content script loads, but some YouTube surfaces report `no cards`. YouTube DOM experiments vary across Home, Subscriptions, Search, Shorts, and navigation transitions.

**Acceptance criteria**
- Detects video IDs and titles on Home, Subscriptions, Search, and Shorts.
- Handles client-side navigation without a full reload.
- Shows a useful diagnostic when no candidates are found.
- Does not hide unrelated page containers.
- Adds content-script tests using representative DOM fixtures.

## 3. Complete extension authentication in production

**Labels:** `priority:high`, `area:auth`, `area:extension`

The extension has Supabase PKCE code and token storage, but the deployed OAuth redirect and bearer-session flow need a complete production test. The next pass should focus on confirming the live session state, the YouTube provider tokens, and whether the authentication callback reaches the backend with enough token data for `oauth_connections` persistence.

**Acceptance criteria**
- The extension signs in through Edge using Google.
- The extension redirect URL is configured in Supabase.
- `/api/feed`, `/api/rank`, and `/api/feedback` accept the extension bearer token.
- The OAuth callback logs only non-secret provider-token/refresh-token state and callback outcome metadata so a missing token is diagnosable in production without exposing raw token values.
- `oauth_connections` persists a valid YouTube access/refresh pair for the active user.
- Token refresh works after access-token expiry.
- Sign-out removes local tokens and cached personalized feed data.

## 4. Make mode switching visibly change the YouTube feed

**Labels:** `priority:high`, `area:ranking`, `area:extension`

`Work`, `Learning`, and `Relax` now select different algorithms, but this needs a production validation pass and stronger candidate scoring so the change is obvious to users.

**Acceptance criteria**
- Each mode has a distinct default topic/rule profile.
- Switching modes re-ranks current page candidates without a page refresh.
- A visible mode/score marker is shown while debugging is enabled.
- Automated tests prove that the same candidate set receives different ordering across modes.

## 5. Improve classification quality beyond title heuristics

**Labels:** `priority:medium`, `area:ranking`, `area:ai`

The current classifier is deterministic and title-based. It supports common topics but cannot reliably understand descriptions, channel context, language, or nuanced content types.

**Acceptance criteria**
- Classifications use title plus channel description and available metadata.
- AI/computer vision, tutorials, entertainment, engineering, and business cases are covered.
- False substring matches are prevented.
- Classification results are cached and failures have a safe fallback.
- Cost and rate-limit behavior are documented before enabling an external LLM.

## 6. Add feedback and ranking regression coverage

**Labels:** `priority:medium`, `area:ranking`, `area:testing`

Dashboard feedback works, but the extension and API need broader behavioral coverage.

**Acceptance criteria**
- Tests cover `more_like_this`, `not_interested`, and `never_show_channel`.
- Tests cover positive feedback scoring and never-show versus always-show precedence.
- Channel-wide suppression is tested across multiple videos.
- Rule precedence is explicit and tested.
- Extension feedback sends YouTube video IDs rather than titles.
- Feed refresh/re-ranking after feedback is covered.

## 7. Add CI for the monorepo and extension artifact

**Labels:** `priority:medium`, `area:infra`

The repository workflow now covers the monorepo checks and uploads the built extension artifact; keep this issue focused on maintaining that release gate as the project changes.

**Acceptance criteria**
- Pull requests run install, typecheck, tests, lint, and extension build.
- The extension `dist` output is uploaded as a CI artifact.
- CI uses Node 22 and pnpm 9.
- Secrets are not printed in logs.

## 8. Add production observability and health checks

**Labels:** `priority:medium`, `area:infra`, `area:backend`

The app has a health route with a server-side Supabase connectivity check; feed generation and downstream API failures still need richer structured observability.

**Acceptance criteria**
- Health check reports Supabase connectivity without exposing secrets.
- Feed, YouTube, OAuth, and classification failures include structured context.
- Sentry or an equivalent error tracker is configured for web and extension paths.
- YouTube quota and sync duration are observable.

## 9. Finish launch security review

**Labels:** `priority:high`, `area:security`

Before sharing the extension, review token handling, CORS, RLS, and production configuration.

**Acceptance criteria**
- No service-role key or third-party secret appears in extension output.
- CORS is restricted to known origins.
- RLS policy coverage is guarded by a schema test; production user-isolation behavior still needs verification with separate accounts.
- Production and local environment variables are separated.
- OAuth callback URLs are documented and verified.

## 10. Package and document the Edge release

**Labels:** `priority:low`, `area:extension`, `area:docs`

The extension currently builds successfully as an unpacked MV3 artifact, but release steps are not yet documented for another developer.

**Acceptance criteria**
- Edge loading instructions use the WSL path format.
- A release build command is documented.
- Extension ID and Supabase redirect setup are documented.
- Chrome Web Store / Edge Add-ons submission requirements are tracked separately.

## 11. Make discovery intent-driven with format-aware queries

See [Issue #20](https://github.com/AsimovNo9/MyAlgo/issues/20). The first implementation generates bounded tutorial, lecture, course, and explainer queries from user goals and strong topics, and classifies richer YouTube metadata.

## 12. Add semantic topic concepts and intent resolution

See [Issue #22](https://github.com/AsimovNo9/MyAlgo/issues/22). This is the next semantic layer: Supabase pgvector concepts, aliases, embeddings, structured intent, and low-confidence AI disambiguation with deterministic fallback.

## 13. Persist semantic concept catalogs and algorithm intent profiles

The tracked Supabase migration creates the canonical concept catalog and per-algorithm intent profiles with RLS. `GET /api/concepts` now exposes both persisted catalog entries and user-scoped profiles; future work is low-confidence AI disambiguation and production validation of the API path.
