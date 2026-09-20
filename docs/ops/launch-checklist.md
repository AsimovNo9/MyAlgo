# Launch checklist

## Production readiness
- [x] Verify the production Vercel app responds at `https://my-algo-web.vercel.app`
- [ ] Confirm Supabase production project matches the live app
- [ ] Validate all environment variables for Supabase, Google OAuth, and Anthropic
- [ ] Confirm callback URLs and redirect configuration are correct
- [ ] Run a production smoke test for sign-in and YouTube OAuth
- [ ] Validate YouTube subscription sync against a real account
- [ ] Confirm ranked feed output is correct in production conditions
- [x] Verify `/api/health`, `/api/rank` CORS preflight, and `/auth/callback` routes
- [x] Rotate exposed secrets
- [x] Verify rotated values are set in Vercel/local environments and redeploy
- [x] Implement server-side encryption for YouTube OAuth tokens
- [ ] Set `OAUTH_TOKEN_ENCRYPTION_KEY` in production and verify encrypted persistence/refresh
- [ ] Verify the extension never ships secrets in the client bundle
- [ ] Add uptime/health monitoring and Sentry tracking
- [x] Review MV3 permission requirements and final extension packaging
- [ ] Prepare Chrome Web Store submission assets and checklist

## Release gate
- [ ] End-to-end sign-in works in production
- [ ] Real user can sync subscriptions and see ranked results
- [ ] Pause/resume and mode switching work properly in the live extension
- [ ] Errors and failures are visible and diagnosable
- [ ] Launch notes and support path are prepared
