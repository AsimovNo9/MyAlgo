# Personal Algorithm

Personal Algorithm is a Chrome extension + web dashboard that lets a user define weighted topic preferences and always/never-show rules, then apply those preferences to their own YouTube feed via the official YouTube Data API.

## Goals
- Keep the stack lean and serverless for MVP usage.
- Use Supabase Auth and Postgres to own user state and RLS.
- Keep secrets entirely on the API side, never in the browser extension bundle.
- Support a typed, shared contract between the extension and the Next.js API.

## Stack
- pnpm workspaces
- Next.js (App Router) on Vercel
- Supabase (Postgres + Auth + RLS)
- Manifest V3 Extension with Vite + CRXJS + React
- TypeScript everywhere

## Folder structure
- apps/extension
- apps/web
- packages/shared-types
- packages/db

## Core product flow
1. The user configures a mode and set of topic weights in the dashboard or extension options page.
2. The extension requests a ranked feed from the web API.
3. The API fetches relevant content, applies weighting and rule logic, and returns a filtered feed.
4. The extension updates the YouTube UI by hiding or emphasizing candidate items.

## Notes
- The architecture and deployment specs in the repo root are binding requirements.
- Supabase schema RLS is defined in `packages/db/schema.sql`.
- The current implementation is a scaffold, with stubbed external API calls that will be replaced with real integrations when product logic is wired up.
- Secrets are intentionally not embedded in the extension bundle.
