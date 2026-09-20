# Production Readiness TODO

This file tracks launch-blocking work, production hardening, and follow-up tasks for Personal Algorithm.

## Current focus
- Status definitions and the audited implementation matrix live in [docs/STATUS.md](docs/STATUS.md). Checkmarks are not production verification unless explicitly confirmed there.
- [ ] Move from feed filtering to a recommendation engine: taste profile + candidate generation + retrieval + reranking
- [ ] Integrate the semantic knowledge layer: concept graph, semantic enrichment, bounded vector retrieval, and low-confidence LLM fallback
- [ ] Quality-first feed relevance: unrelated items must be hidden or explained as fallback content
- [ ] Add purchaser-facing source controls: subscribed-only, hide Shorts, and discovery toggle
- [x] Add feed quality signals: adaptive relevance eligibility, empty state, and diversity limits
- [x] Resolve the extension ranking loop and stabilize the page-trigger behavior
- [x] Add a clearer enabled/paused state in the popup and on the YouTube page
- [x] Validate the extension locally with typecheck, tests, and a production build
- [ ] Repeat the full sign-in → profile creation → YouTube sync flow in production
- [ ] Run production validation and launch hardening for the live app and extension
- [ ] Complete the production OAuth/session validation pass for the Google + YouTube provider tokens

## Production Safety Baseline — Remaining Work

These are the unresolved items from the production safety review. The implementation status is summarized in [docs/STATUS.md](docs/STATUS.md); these checklist items are the execution queue.

### Real-user OAuth and YouTube flow

- [ ] Set `OAUTH_TOKEN_ENCRYPTION_KEY` in Vercel and local deployment environments.
- [ ] Reconnect the approved Google account so tokens created by the previous plaintext implementation are replaced with encrypted values.
- [ ] Complete production Google OAuth sign-in from a clean browser session.
- [ ] Fix deployed browser Supabase configuration: set valid `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel.
- [ ] Verify `/api/oauth/youtube/connect` persists encrypted access and refresh tokens.
- [ ] Verify access-token refresh after expiry and encrypted refresh-token rotation.
- [ ] Verify extension sign-in, bearer authentication, sign-out, and session restoration against the deployed API.
- [ ] Verify authenticated `/api/feed` and `/api/rank` with a real extension session.
- [ ] Verify real YouTube subscription sync and liked-video import where the granted scope permits it.

### Database and deployment safety

- [x] Confirm concept graph, content concept, and pgvector migrations are applied to the production project.
- [ ] Verify RLS isolation with two separate production users across algorithms, feed cache, feedback, activity, OAuth connections, and intent profiles.
- [ ] Set `CRON_SECRET` in production and verify unauthorized seed discovery/sync requests return `401`.
- [ ] Verify authorized cron requests execute successfully and record source/coverage metrics.
- [ ] Verify database backups and document a recovery procedure.
- [ ] Verify production and local environment separation, including server-only encryption and provider secrets.

### Observability and provider safety

- [ ] Configure production error monitoring for web, API, sync, OAuth, classifier, and extension failures.
- [ ] Confirm YouTube quota usage, retry behavior, timeout behavior, and partial-sync failures are observable without logging tokens.
- [ ] Add uptime monitoring for `/api/health` and alerting for failed cron/sync runs.
- [ ] Confirm deployment logs contain only redacted token diagnostics and no provider credentials.
- [ ] Compare production semantic-ranking metrics against the flat-label baseline before increasing semantic score weight.
- [x] Add offline regression coverage for semantic similarity ordering and hard-exclusion precedence.

### Live extension behavior

- [ ] Test native-card replacement on YouTube Home, Subscriptions, Search, and Shorts with the deployed API.
- [ ] Verify Shorts remain visible unless the user selects Hide Shorts.
- [ ] Verify watched/revisited videos are excluded from replacement recommendations.
- [ ] Verify injected personal cards have stable markers and are never re-collected as native candidates.
- [ ] Verify infinite-scroll and client-side navigation continue ranking and replacing cards without loops or duplicate injections.
- [ ] Verify extension pause/resume, mode switching, source controls, and stale-cache fallback in a real browser.

## Recommendation-engine architecture actions
- [x] Build a user taste profile with explicit preferences, learned affinities, source affinity, language, format, and negative signals.
- [x] Add a standalone candidate-generation coordinator with source budgets, coverage metrics, deduplication, and provenance.
- [x] Add learned creator-query retrieval; explicit `creator:`/`channel:` queries, subscriptions, liked videos, topic queries, RSS, bounded Search, and dedicated freshness queries are implemented.
- [x] Add a query planner that expands user preferences into multiple retrieval queries instead of a single broad keyword string.
- [x] Keep language and format as first-class ranking dimensions instead of treating them as generic tags.
- [x] Keep classification text-first and metadata-driven; defer image models until they solve a real gap.
- [x] Add a discovery lane separate from strong matches so the feed mixes relevance and exploration without turning into a bubble.
- [x] Add a “why am I seeing this” explanation layer that uses user-preference reasoning instead of raw implementation strings.

### Recommender steering decision
- The next recommender implementation is candidate generation and source orchestration, not image classification or a larger ranking model.
- RSS and the shared pool are the primary coverage sources; YouTube Search fills measured gaps within the existing quota budget.
- The feed and page-ranking paths must never trigger retrieval directly.

## Immediate next actions
- [x] Stabilize the YouTube ranking trigger flow and remove the re-trigger refresh loop
- [x] Confirm the local extension build is green and the active/pause UI is understandable
- [x] Point local web OAuth callbacks at `https://my-algo-web.vercel.app/auth/callback`
- [x] Verify the production health route, rank CORS preflight, and auth callback route
- [ ] Re-test the full OAuth and YouTube authorization flow after environment verification
- [ ] Validate the Vercel deployment against the real Supabase production project
- [ ] Rotate exposed secrets and confirm they are not embedded in the browser bundle
- [ ] Run the focused Google + YouTube production auth validation pass and capture non-secret provider-token diagnostics without logging raw token values

## Current environment state
- [x] The app-local config in [apps/web/.env.local](apps/web/.env.local) is aligned with the production Vercel domain for live deployment testing
- [x] Google access is working for the approved tester account
- [ ] YouTube connection and live subscription sync remain the active validation step

## General access and auth
- [ ] Add the approved Google test users for the current OAuth app
- [ ] Publish the Google OAuth app for general user access once launch is ready
- [ ] Confirm the production Supabase project is the active project for live users
- [ ] Verify Google OAuth callback URLs for both Supabase and the app redirect flow
- [ ] Add production sign-in smoke test for a real user account

## Production configuration
- [ ] Set production Vercel environment variables for Supabase, Google, and Anthropic
- [x] Confirm the deployed production URL responds from the expected Vercel app
- [ ] Confirm the Vercel project is deployed from the correct root directory
- [ ] Validate the production app domain and callback URLs match the live deployment
- [x] Add a health check endpoint to monitor uptime and deployment health
- [ ] Review environment segregation between local, preview, and production

## Supabase and database
- [x] Apply final schema and channel metadata migrations to the production Supabase project
- [x] Add automated schema coverage for RLS enablement and policy presence
- [x] Deduplicate user algorithm rows by name so ranking always uses the newest configured row
- [x] Enforce one case-insensitive name and one active algorithm per user at the database layer
- [ ] Confirm RLS policies are active and tested for user isolation in production
- [x] Verify profile creation and OAuth persistence for the approved test user
- [ ] Validate database backups and recovery expectations
- [ ] Add migration workflow for future schema changes

## YouTube and data pipeline
- [ ] Test YouTube OAuth token refresh flow in production
- [x] Validate subscription sync for a real account with live data
- [ ] Confirm API quota usage and failure handling for YouTube requests
- [ ] Review fallback behavior when no Google/YouTube token is available
- [x] Add retry and timeout handling for downstream API calls
- [x] Add RSS-based seed-channel ingestion for niche topics with no shared per-user quota cost
- [x] Add a shared Vercel Cron job to poll seed channels, replacing per-user background discovery search
- [x] Add a periodic shared search job to discover new candidate channels for the seed catalog
- [x] Queue discovered channels as pending review instead of automatically polluting the approved RSS catalog
- [x] Reuse the shared content pool before triggering RSS or cold-start discovery
- [ ] Return candidate-pool coverage and source contribution metrics from activation/sync
- [x] Add bounded cold-start discovery with per-topic weekly deduplication and high-confidence auto-approval
- [ ] Add admin/user review UI to approve or reject discovered channels
- [ ] Set the CRON_SECRET production environment variable and verify the cron job runs

## Feed ranking and scoring
- [x] Enforce strict topic relevance in the normal feed path and return a useful empty state when nothing matches
- [x] Add adaptive topic eligibility so low-weight secondary topics cannot independently admit content
- [x] Add source controls for subscriptions, discovery, Shorts, and live content
- [x] Discover content from every strong topic in a multi-topic algorithm, not just the top one
- [x] Make never_show filter by classifier content_type, independent of the source channel
- [x] Let always_show/never_show rules pin or exclude a channel by name (no schema change)
- [x] Add channel diversity and numbered-series suppression to improve perceived feed quality
- [ ] Validate ranking logic against real user subscriptions and content
- [x] Add regression coverage for positive feedback and rule precedence
- [ ] Check rule precedence and feedback weighting in production conditions
- [ ] Review empty-state and fallback feed behavior
- [ ] Confirm classification quality for live content and tune heuristics if needed
- [x] Add metrics-only observability around scoring decisions and feed generation
- [x] Add a visible “why this item was ranked” explanation for each feed item, including matched topics, rule effects, and feedback adjustments
- [x] Add bounded format-aware discovery queries for user-defined algorithm goals
- [x] Add canonical topic concepts, aliases, and semantic intent resolution for user-defined topics
- [x] Add a generic algorithm intent profile for arbitrary concepts beyond hand-coded defaults
- [x] Add tracked Supabase migration for concept catalog and algorithm intent profiles with RLS
- [x] Expose persisted concept catalog + algorithm intent profiles through the API layer
- [x] Add AI disambiguation only for low-confidence semantic matches

## Extension and browser experience
- [x] Package the Chrome extension for local Edge testing
- [x] Stabilize the YouTube trigger flow and remove the refresh loop
- [x] Add a visible enabled/paused status in the popup and content script UI
- [x] Verify MV3 extension permissions and storage requirements in the production deployment context
- [ ] Test the extension flow against the live API and deployed app
- [x] Expose subscribed-only, hide Shorts, and discovery controls in the extension
- [x] Trigger background YouTube subscription + discovery sync from the extension so matching videos are actually persisted
- [x] Show which topics and sources are driving the visible feed in the popup
- [x] Review YouTube DOM compatibility and fallback behavior against production content
- [x] Add representative YouTube DOM fixtures for Home, Subscriptions, Search, and Shorts
- [ ] Prepare Chrome Web Store submission requirements and assets

## Security and compliance
- [x] Rotate the exposed Supabase service-role, Anthropic, and Google OAuth secrets
- [x] Verify rotated values are set in Vercel/local environments and redeploy
- [x] Implement AES-256-GCM encryption for YouTube OAuth tokens at rest
- [ ] Set `OAUTH_TOKEN_ENCRYPTION_KEY` in production and verify encrypted persistence/refresh with a real account
- [ ] Configure `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, and `EMBEDDING_MODEL_VERSION` in Vercel production.
- [x] Verify the pgvector migration and `match_content_embeddings` RPC in the production Supabase project.
- [ ] Run an authorized `/api/embeddings/backfill` job and verify model-versioned rows are created.
- [ ] Run the authorized `/api/embeddings/status` check before and after backfill; confirm provider configuration and stored row count without exposing secrets.
- [x] Run `node scripts/verify-production-pgvector.mjs` after applying migrations; production tables and RPC return `200`.
- [ ] Run `node scripts/collect-production-baseline.mjs` with an authenticated `SUPABASE_ACCESS_TOKEN` and record aggregate feed/rank metrics without exporting content identifiers.
- [ ] Confirm secrets are never included in the browser extension bundle
- [ ] Review access patterns for service-role usage and server-only code
- [ ] Add basic error monitoring and alerts for API failures
- [ ] Document ownership of production credentials and deployment access
- [ ] Review privacy expectations for user YouTube data and OAuth tokens

## Launch readiness
- [ ] Run a full end-to-end sign-in and feed flow in production
- [ ] Validate a real user can sync subscriptions and view ranked results
- [x] Confirm logout and session reset behavior works correctly
- [ ] Add final QA checklist before open access launch
- [ ] Publish launch notes and support/contact path for testers

## Backlog / future improvements
- [ ] Add scheduled/background sync for content refresh
- [ ] Add analytics and retention tracking for feed engagement
- [ ] Consider Redis caching for hot feed reads as usage grows
- [x] Add automated CI for linting, typecheck, tests, and extension build verification
- [ ] Add Sentry monitoring and error dashboards
- [ ] Plan the next feature set after MVP validation

## Notes
- Keep this file updated as new work is discovered or completed.
- Treat production access, OAuth verification, and deployment checks as launch blockers.
