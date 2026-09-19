# Production Readiness TODO

This file tracks launch-blocking work, production hardening, and follow-up tasks for Personal Algorithm.

## Current focus
- [x] Resolve the extension ranking loop and stabilize the page-trigger behavior
- [x] Add a clearer enabled/paused state in the popup and on the YouTube page
- [x] Validate the extension locally with typecheck, tests, and a production build
- [ ] Repeat the full sign-in → profile creation → YouTube sync flow in production
- [ ] Run production validation and launch hardening for the live app and extension

## Immediate next actions
- [x] Stabilize the YouTube ranking trigger flow and remove the re-trigger refresh loop
- [x] Confirm the local extension build is green and the active/pause UI is understandable
- [x] Point local web OAuth callbacks at `https://my-algo-web.vercel.app/auth/callback`
- [x] Verify the production health route, rank CORS preflight, and auth callback route
- [ ] Re-test the full OAuth and YouTube authorization flow after environment verification
- [ ] Validate the Vercel deployment against the real Supabase production project
- [ ] Rotate exposed secrets and confirm they are not embedded in the browser bundle

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
- [ ] Confirm RLS policies are active and tested for user isolation in production
- [x] Verify profile creation and OAuth persistence for the approved test user
- [ ] Validate database backups and recovery expectations
- [ ] Add migration workflow for future schema changes

## YouTube and data pipeline
- [ ] Test YouTube OAuth token refresh flow in production
- [x] Validate subscription sync for a real account with live data
- [ ] Confirm API quota usage and failure handling for YouTube requests
- [ ] Review fallback behavior when no Google/YouTube token is available
- [ ] Add retry and timeout handling for downstream API calls

## Feed ranking and scoring
- [ ] Validate ranking logic against real user subscriptions and content
- [ ] Check rule precedence and feedback weighting in production conditions
- [ ] Review empty-state and fallback feed behavior
- [ ] Confirm classification quality for live content and tune heuristics if needed
- [ ] Add observability around scoring decisions and feed generation
- [x] Add a visible “why this item was ranked” explanation for each feed item, including matched topics, rule effects, and feedback adjustments
- [x] Add bounded format-aware discovery queries for user-defined algorithm goals
- [x] Add canonical topic concepts, aliases, and semantic intent resolution for user-defined topics
- [x] Add a generic algorithm intent profile for arbitrary concepts beyond hand-coded defaults
- [x] Add tracked Supabase migration for concept catalog and algorithm intent profiles with RLS
- [ ] Expose persisted concept catalog + algorithm intent profiles through the API layer
- [ ] Add AI disambiguation only for low-confidence semantic matches

## Extension and browser experience
- [x] Package the Chrome extension for local Edge testing
- [x] Stabilize the YouTube trigger flow and remove the refresh loop
- [x] Add a visible enabled/paused status in the popup and content script UI
- [ ] Verify MV3 extension permissions and storage requirements in the production deployment context
- [ ] Test the extension flow against the live API and deployed app
- [ ] Review YouTube DOM compatibility and fallback behavior against production content
- [ ] Add representative YouTube DOM fixtures for Home, Subscriptions, Search, and Shorts
- [ ] Prepare Chrome Web Store submission requirements and assets

## Security and compliance
- [x] Rotate the exposed Supabase service-role, Anthropic, and Google OAuth secrets
- [x] Verify rotated values are set in Vercel/local environments and redeploy
- [ ] Confirm secrets are never included in the browser extension bundle
- [ ] Review access patterns for service-role usage and server-only code
- [ ] Add basic error monitoring and alerts for API failures
- [ ] Document ownership of production credentials and deployment access
- [ ] Review privacy expectations for user YouTube data and OAuth tokens

## Launch readiness
- [ ] Run a full end-to-end sign-in and feed flow in production
- [ ] Validate a real user can sync subscriptions and view ranked results
- [ ] Confirm logout and session reset behavior works correctly
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
