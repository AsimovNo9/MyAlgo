# Deployment & Scaling Specification — Personal Algorithm

*Infrastructure provisioning, deployment pathway, and growth plan for a solo, bootstrapped founder.*

---

## 1. Principles

- Target **$0–20/month** at MVP stage.
- **Zero servers to patch or babysit** — everything managed/serverless.
- Every component scales by **upgrading a tier**, not by re-architecting, up to a real usage threshold.
- Defer queues, dedicated workers, multi-region, and microservices until a specific bottleneck proves they're needed — not preemptively.

## 2. MVP Infrastructure Stack

| Component | Service | Free tier covers |
|---|---|---|
| Web app + API | Vercel (Next.js) | 100GB bandwidth/mo, generous serverless invocations |
| Database + Auth | Supabase | 500MB DB, 50k MAU auth, Row Level Security |
| Classification | Anthropic API | Pay-per-token, no minimum spend |
| Semantic retrieval | Supabase pgvector + embedding provider | Canonical concepts and aliases without a new vector service |
| Extension hosting | Chrome Web Store | One-time $5 developer registration fee |
| Error tracking | Sentry | 5k events/month free |
| Domain / DNS | Cloudflare | Free |
| Secrets | Vercel + Supabase environment variables | Built-in, no separate vault needed at this stage |

## 2.1 Recommendation Engine Rollout

The next major architecture shift is not a UI change; it is a retrieval-and-ranking pipeline.

The system should evolve from:

- fetch subscription pool
- classify items
- rank them

into:

- build taste profile
- generate candidates
- enrich candidates
- retrieve likely videos via search and subscription queries
- rerank against the active algorithm

This is the minimum product definition for a real personalized recommendation engine.

### Recommendation engine stages

1. **Taste profile** — explicit preferences, learned affinity, language, format, creator affinity, and negative signals.
2. **Candidate generation** — subscriptions, liked videos, creator queries, topic queries, and bounded discovery searches.
3. **Retrieval** — query planner and ranked candidate pull from YouTube search + known feeds.
4. **Enrichment** — classify title, description, channel, tags, and category; resolve canonical concepts.
5. **Reranking** — score aligned items and suppress duplicates or off-topic items.
6. **Feedback loop** — likes, dislikes, hide, and “less like this” update the taste profile.

### MVP retrieval decision

Candidate generation is a separate sync/activation concern, not part of `/api/feed` or page mutation handling. Approved RSS and the shared classified pool provide primary coverage; YouTube Search is bounded gap filling. Keep the current maximum of five queries and five results per query until coverage, quota, latency, and deduplication metrics justify an increase.

The first candidate-generation coordinator should report:

```text
pool size before retrieval
items reused from the shared pool
items ingested from RSS
Search queries attempted and results returned
deduplicated candidate count
classification coverage
```

This makes retrieval quality measurable independently from reranking quality.

### Scope guardrails for MVP

- Keep classification text-first and metadata-driven.
- Do not add an image classifier in the MVP.
- Model language, creator, format, and topic as separate dimensions.
- Do not treat channel names like IGN as a topic match.
- Use a separate exploration lane rather than one flat deterministic list.

**Estimated MVP cost (first few hundred users):** $0–20/month, driven almost entirely by Anthropic API usage — everything else stays in free tiers.

## 3. Environments

| Environment | Purpose | Where |
|---|---|---|
| `local` | Day-to-day development | Supabase CLI local stack + `next dev` |
| `preview` | Per-PR review builds | Vercel preview deploys (automatic), pointed at a Supabase staging project |
| `production` | Live users | Vercel production deploy on version tags, Supabase production project |

## 4. Deployment Diagram

```mermaid
flowchart TB
    DEV[Local Dev] -->|git push| GH[GitHub Repo]
    GH -->|PR opened| PREVIEW[Vercel Preview Deploy]
    GH -->|version tag v*| PROD[Vercel Production Deploy]
    PROD --> SUPA_PROD[(Supabase — Production)]
    PREVIEW --> SUPA_STAGE[(Supabase — Staging)]
    GH -->|CI| ACTIONS[GitHub Actions:<br/>lint, typecheck, test]
    ACTIONS -.gate.-> PROD
```

## 5. CI/CD Pipeline

- **On pull request:** install deps, typecheck, lint, run unit tests, build the extension bundle as a CI artifact for manual QA.
- **On merge to `main`:** CI validates the merged code; production is not deployed automatically.
- **On a version tag (`v*`):** `.github/workflows/release.yml` deploys `apps/web` to Vercel with the Vercel CLI.
- **Extension releases:** manual at MVP stage — `pnpm build:extension` → zip → upload via the Chrome Web Store developer dashboard. Automate later with the Chrome Web Store publish API once release frequency justifies it.

```yaml
# .github/workflows/ci.yml (abridged)
name: CI
on: [pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm --filter extension build
```

## 6. Step-by-Step Initial Provisioning

1. **Create a Supabase project.** Note the project URL and anon/service-role keys.
2. **Apply the schema:** `supabase db push` (runs `packages/db/schema.sql` + RLS policies).
3. **Google Cloud setup:** create a project, enable the YouTube Data API v3, create an OAuth 2.0 client (web application type for the backend flow).
4. **Set environment variables in Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_REDIRECT_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `ANTHROPIC_API_KEY`, and `CRON_SECRET`.
5. **Deploy a release:** create and push a version tag, for example `git tag v0.1.0 && git push origin v0.1.0`. GitHub Actions deploys that tag to Vercel production.
6. **Extension (dev):** load unpacked via `chrome://extensions` → "Load unpacked" pointing at `apps/extension/dist`.
7. **Extension (public):** package and submit through the Chrome Web Store developer dashboard once ready for outside users.

### Deployment smoke check

After a production deploy, verify the health route and extension CORS contract:

```bash
DEPLOYMENT_URL=https://your-app.vercel.app pnpm verify:deployment
```

To also exercise authenticated live-page ranking, provide a short-lived Supabase access token without printing it:

```bash
DEPLOYMENT_URL=https://your-app.vercel.app SUPABASE_ACCESS_TOKEN="$TOKEN" pnpm verify:deployment
```

The Vercel project must deploy the `apps/web` Next.js app using `pnpm --filter web build`. The deployed app must include `apps/web/app/api/rank/route.ts` and `apps/web/middleware.ts`; a `404` for `/api/rank` means the deployment is stale or pointed at the wrong project/root.

`apps/web/vercel.json` disables Vercel's automatic Git deployments. Add GitHub Actions production secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; application secrets stay in Vercel's production environment variables.

## 7. Secrets Management

- The extension bundle is client-visible code — **never** put the Google OAuth client secret or Anthropic API key in it. The extension only ever talks to your own API; your API holds the secrets.
- Vercel encrypted environment variables cover secrets at MVP scale.
- Store YouTube refresh tokens encrypted at rest before public launch (Supabase Vault, or `pgcrypto` if Vault isn't available on your plan). The current route keeps them server-side but still needs this encryption step.

## 8. Growth Pathway

### Stage 1 — MVP (0–1k users)
Current stack as-is. No changes needed.

### Stage 2 — Early traction (1k–20k users)
- Add **Upstash Redis** in front of `feed_cache` for hot reads, reducing Postgres load.
- Move classification off the request path into a queue (Upstash QStash, or Supabase `pg_cron` + an edge function) so `/api/feed` isn't blocked waiting on the Anthropic API.
- Add a quota-tracking table for the YouTube Data API (shared 10,000 units/day free quota) and request a quota increase from Google once usage approaches it.

Discovery search is deliberately bounded at MVP scale: each sync derives at most three queries and requests at most five videos per query. YouTube `search.list` is quota-expensive, so discovery must remain a sync-time operation with cached results; page mutations and feed reads must never trigger a new search.

Niche-topic content that no user is subscribed to is sourced separately via free RSS polling (`apps/web/lib/rss.ts`, `apps/web/lib/seed-channels.ts`), driven by a shared Vercel Cron job (`apps/web/vercel.json`, daily at 02:00 UTC on Hobby) hitting `/api/seed-channels/sync`. This ingestion path consumes no YouTube Data API quota and runs once for the whole project, not per user, which is why it is the primary mechanism for topics like niche engineering or research content rather than per-user `search.list` polling.

Semantic retrieval adds a second budget: embedding and resolver calls. Embed canonical concepts and algorithm intent, not every page mutation. Cache by content hash and algorithm revision; use deterministic aliases as the outage and cost fallback. Do not add a separate vector database before Supabase `pgvector` volume proves it necessary.

### Stage 3 — Scale (20k–200k users)
- Split classification into its own long-running worker (Fly.io or Railway) if serverless cold-starts or per-invocation cost become an issue.
- Move to a dedicated Postgres tier / add read replicas on Supabase.
- Introduce per-user classification cache windows to control Anthropic API spend as volume grows.
- Add CDN caching for static extension assets.

### Stage 4 — Platform (200k+ users)
- Multi-region deployment: Vercel edge functions + regional Supabase read replicas.
- Dedicated content-ingestion pipeline — scheduled workers continuously pulling subscription data, decoupled from the request path.
- Evaluate migrating off shared managed Postgres to a dedicated instance if connection limits become binding.
- Add further platform adapters (Reddit, X) as independent ingestion services feeding the same `content_items` schema.

```mermaid
flowchart LR
    S1[Stage 1: MVP<br/>Vercel + Supabase<br/>0–1k users] --> S2[Stage 2: +Redis, +Queue<br/>1k–20k users]
    S2 --> S3[Stage 3: +Dedicated worker<br/>+Read replicas<br/>20k–200k users]
    S3 --> S4[Stage 4: Multi-region<br/>+Platform adapters<br/>200k+ users]
```

## 9. Monitoring & Observability

- **Sentry** — errors from both the extension and the API.
- **Vercel** — built-in request logs and analytics, no setup required.
- **Supabase** — built-in query performance dashboard.
- **Uptime check** — a free-tier monitor (e.g. Better Uptime) hitting a simple `/api/health` route.

## 10. Backup & Disaster Recovery

- Supabase automatic daily backups on the free tier; upgrade for point-in-time recovery once real users depend on the product.
- `packages/db/schema.sql` and its migrations are tracked in git as the actual source of truth — the database can always be rebuilt from the repo.

## 11. Security Notes

- Row Level Security enforced on every table containing user data.
- OAuth tokens are server-side and never exposed to the client; at-rest encryption remains a launch blocker and must be implemented before public access.
- The extension never holds a secret capable of calling Google or Anthropic directly — all third-party calls are proxied through your own API.
