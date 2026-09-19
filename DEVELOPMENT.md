# Development guide

This document covers the local workflow for the Personal Algorithm MVP.

## Prerequisites
- Node.js 22+
- pnpm 9+
- A local or remote Supabase project for database work
- A Chrome browser for extension loading

## Install

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
pnpm install
```

## Local development commands

```bash
# start the dashboard
pnpm --filter web dev

# build the full monorepo
pnpm build

# run type checks across the workspace
pnpm typecheck
```

## Environment variables

Copy the sample environment file and update values for your local setup.

```bash
cp .env.example .env.local
```

Example values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ALLOWED_ORIGINS=
```

The production API accepts valid `chrome-extension://` origins and authenticates every request with the extension's Supabase bearer token, so users do not need per-installation CORS configuration. Use `CORS_ALLOWED_ORIGINS` only for additional trusted web origins; multiple origins may be separated with commas.

## Supabase setup

1. Create a Supabase project.
2. Authenticate the CLI with `npx supabase login`.
3. Apply tracked migrations with `npx supabase db push --project-ref YOUR_PROJECT_REF`.
4. Keep `packages/db/schema.sql` aligned with the migrations for reference and tests.
5. Enable Row Level Security policies as defined in the schema.
6. Add the project URL and anon key to the local environment.

## Extension setup

1. Run the web app locally on port 3000.
2. Build the extension bundle:

```bash
pnpm --filter extension build
```

3. Open Chrome and load the unpacked extension from `apps/extension/dist`.
4. Open the extension options page to adjust algorithm weights and rules.

## Notes
- The extension never ships secrets. All external API calls are proxied through the app layer.
- The content script is intentionally scoped to `youtube.com` and uses typed runtime messaging.
- YouTube OAuth, subscription upload sync, channel metadata enrichment, Supabase persistence, feedback, and live-page ranking are implemented; production deployment and DOM compatibility remain active work.
- Discovery currently uses bounded format-aware YouTube queries and deterministic metadata classification. Issues #20 and #22 track the next semantic stage: pgvector concepts, aliases, embeddings, and optional AI disambiguation with deterministic fallback.
- See [docs/ONBOARDING.md](docs/ONBOARDING.md) and [docs/GITHUB_ISSUES.md](docs/GITHUB_ISSUES.md) before picking up a task.
