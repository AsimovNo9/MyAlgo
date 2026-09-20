# Developer Onboarding

## Product

Personal Algorithm is a Next.js dashboard plus a Manifest V3 Edge extension. Users define algorithms made of topic weights and rules. The extension ranks videos currently visible on YouTube and hides or emphasizes them without requiring a page refresh.

## Current architecture

- Web app: `apps/web` (Next.js App Router)
- Extension: `apps/extension` (Vite + CRXJS + React)
- Shared types: `packages/shared-types`
- Canonical schema: `packages/db/schema.sql`
- Supabase CLI migrations: `supabase/migrations`
- Ranking logic: `apps/web/lib/feed.ts`
- YouTube ingestion: `apps/web/lib/youtube.ts`
- Live page ranking endpoint: `apps/web/app/api/rank/route.ts`
- Extension content script: `apps/extension/src/content-scripts/youtube.ts`
- Discovery query generation: `apps/web/lib/discovery.ts`

## Local setup

```bash
node --version # Node 22+
pnpm install
cd apps/web
npx next dev -p 3000
```

The `pnpm --filter web dev -- --port 3000` form is not reliable in this repository because the extra separator is passed to Next as a project path. Use `npx next dev -p 3000` when a fixed port is needed.

## Extension build in WSL + Edge

```bash
pnpm --filter extension typecheck
pnpm --filter extension build
```

In Edge, open `edge://extensions`, enable Developer mode, and load:

```text
\\wsl.localhost\Ubuntu-26.04\home\damola\myalgo\apps\extension\dist
```

Reload the extension after every build. The extension popup supports Google sign-in, mode selection, and API URL configuration.

## Important runtime details

- The extension defaults to `https://my-algo-web.vercel.app` but can be pointed to `http://localhost:3000` from its options page.
- The local web app must be running for the local API URL to work.
- The deployed app includes `/api/rank`; live-page ranking still requires an authenticated production smoke test with the extension.
- Production deploys happen only from version tags (`v*`) through `.github/workflows/release.yml`; ordinary pushes to `main` run CI without deploying.
- Discovery currently uses bounded YouTube Search queries and metadata classification. It is not yet a full semantic/RAG system.
- The planned semantic layer uses Supabase `pgvector` for canonical concepts, aliases, embeddings, and cached algorithm intent. See GitHub issues #20 and #22.
- The content script displays a temporary diagnostic pill on YouTube. It reports whether cards were found, ranked, or rejected by the API.
- Supabase OAuth for the extension requires an allowed redirect URL in the form `https://EXTENSION_ID.chromiumapp.org/supabase-auth`.

## Validation commands

```bash
pnpm --filter web typecheck
pnpm --filter extension typecheck
pnpm --filter extension build
node --experimental-strip-types --test apps/web/lib/feed.test.mjs
node --test packages/db/schema.test.mjs
```

## First task for a new developer

Start with the current gates in [STATUS.md](STATUS.md): complete the production Google OAuth, YouTube sync, token refresh, RLS isolation, and authenticated `/api/rank` smoke test. Then implement database-backed concept catalog loading with deterministic fallback. Do not start pgvector or broad LLM enrichment before the semantic contracts and evaluation fixtures are complete.
