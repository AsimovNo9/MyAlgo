# Development guide

This document covers the local workflow for the Personal Algorithm MVP.

## Prerequisites
- Node.js 20+
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
```

## Supabase setup

1. Create a Supabase project.
2. Apply the schema in `packages/db/schema.sql`.
3. Enable Row Level Security policies as defined in the schema.
4. Add the project URL and anon key to the local environment.

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
- The current build is an MVP scaffold with stubbed external integrations, matching the architecture spec's deferred complexity plan.
