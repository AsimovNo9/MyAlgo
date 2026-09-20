# Architecture — Personal Algorithm (YouTube MVP)

*Solo-founder, bootstrapped, lean stack. Scope: Chrome extension + web dashboard controlling a user's YouTube feed via their own subscriptions/rules.*

---

## 1. Product Summary

A Chrome extension (MV3) + lightweight web dashboard that helps a user define a taste profile and then reshapes what they see on YouTube using a recommendation engine: generate relevant candidates, classify them with metadata-first signals, and rerank them against the active algorithm.

The product should evolve from a "feed filter" into a retrieval + ranking system that uses explicit preferences, learned affinities, source controls, and candidate generation instead of only trimming a single fetched feed.

## 2. Guiding Principles

- **Profile before ranking.** The user's algorithm is a taste model, not just a list of keywords.
- **Candidates before feed.** Retrieval and candidate generation happen before scoring, not after.
- **Text-first classification.** Use title, description, tags, channel metadata, and user feedback before adding visual understanding.
- **No image classifier in MVP.** Keep visual analysis as a later phase when text and metadata are insufficient.
- **No servers to manage.** Everything serverless/managed (Vercel + Supabase).
- **One language.** TypeScript everywhere — extension, API, scripts.
- **Defer complexity.** No queues, no microservices, no k8s until usage data demands it.
- **Cheap by default.** Every chosen service has a real free tier.

## 3. Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Extension | Manifest V3, TypeScript, Vite + CRXJS, React (popup/options) | Modern MV3 tooling, fast HMR, small bundle |
| Web app + API | Next.js (App Router), deployed on Vercel | Serverless API routes, same repo as dashboard, zero ops |
| Database | Supabase (managed Postgres) | Postgres + Auth + Row Level Security, generous free tier |
| Auth | Supabase Auth + Google OAuth | Same OAuth flow doubles as YouTube API authorization |
| Classification | Deterministic metadata classifier first; optional AI resolver later | Cheap fallback path with room for semantic disambiguation |
| Semantic retrieval (next stage) | Supabase Postgres + pgvector | Canonical concepts, aliases, embeddings, and semantic topic matching |
| Cache (later, Stage 2+) | Upstash Redis | Serverless, pay-per-request, add only when Postgres read load justifies it |
| Error tracking | Sentry | Free tier covers extension + backend |
| Extension distribution | Chrome Web Store | Required for public MV3 distribution |
| Monorepo tooling | pnpm workspaces (+ Turborepo optional) | One repo, shared types between extension and web |

## 4. High-Level Architecture

```mermaid
flowchart LR
  subgraph User[User + Browser]
    CS[Content Script<br/>youtube.com]
    BG[Background Service Worker]
    POPUP[Popup / Options UI<br/>React]
    LS[(chrome.storage.local)]
    FEEDBACK[Feedback: like, dislike, hide, less-like-this]
  end

  subgraph Profile[Taste + Retrieval Layer]
    TP[User Taste Profile<br/>explicit + learned]
    CG[Candidate Generation<br/>subscriptions, likes, search, creators]
    QP[Query Planner / Retrieval Engine]
  end

  subgraph Vercel[Vercel — Next.js]
    API[API Routes<br/>/api/*]
    RANK[Personal Reranker]
  end

  subgraph Supabase[Supabase]
    PG[(Postgres)]
    AUTH[Auth]
    CATALOG[Concept catalog + intent profiles]
  end

  subgraph External[External APIs]
    YT[YouTube Data API v3]
    RSS[RSS seed feeds]
    LLM[Anthropic / semantic resolver<br/>low-confidence only]
  end

  POPUP <-->|preferences, rules| API
  BG <-->|fetch feed / page rank| API
  CS <-->|DOM refs, video ids| BG
  BG <--> LS
  FEEDBACK --> TP
  TP --> CG
  CG --> QP
  QP --> YT
  QP --> RSS
  YT --> API
  RSS --> API
  API --> CATALOG
  API <--> PG
  API <--> AUTH
  API --> RANK
  API --> LLM
  RANK --> BG
```

## 5. Current Ownership Map

```
Current implementation ownership:
apps/extension/src/background/index.ts       # session, sync, messaging, feed cache
apps/extension/src/content-scripts/youtube.ts # native detection, ranking, replacement UI
apps/extension/src/lib/                       # API, auth, storage, messages, helpers
apps/web/app/api/                             # Next.js API routes and sync jobs
apps/web/lib/feed.ts                          # deterministic ranking and hard filters
apps/web/lib/concepts.ts                      # current deterministic concept fallback
apps/web/lib/recommendation-profile.ts        # explicit profile and query planning
apps/web/lib/youtube.ts                       # YouTube retrieval and sync
apps/web/lib/classifier.ts                    # metadata classifier and low-confidence AI fallback
packages/shared-types/src/index.ts            # shared API and semantic contracts
packages/db/schema.sql                        # canonical database schema
supabase/migrations/                           # deployable schema changes
docs/STATUS.md                                 # implementation and verification authority
```

Recommendation requirements and planned semantic modules are maintained in [docs/RECOMMENDER.md](docs/RECOMMENDER.md); this document only records product-wide architecture and ownership.

```

## 6. What Each Part Does

### Extension
- **Content script (`youtube.ts`)** — runs on youtube.com; reads video card metadata from the rendered DOM, sends candidate items to the background worker, then hides/reorders/visually marks elements based on the scores it gets back.
- **Background service worker** — holds the user's session token, periodically calls `/api/feed`, caches results in `chrome.storage.local`, relays messages between popup, options page, and content script.
- **Popup** — lightweight: shows which "algorithm" (mode) is active, quick toggle between modes, link to the full options page.
- **Options page** — full editor: topic weight sliders, always-show/never-show rule builder, "why am I seeing this" explanations.

### Web app (Next.js on Vercel)
- **Dashboard** — same rule/weight editor as the options page (shares components + `shared-types`); lets a user configure preferences before even installing the extension, useful for onboarding.
- **API routes** — stateless serverless functions, nothing persistent to patch or restart.
  - `/api/feed` — reads the cached candidate pool, scores it against the user's active algorithm, and returns ranked + filtered content. It does not trigger YouTube Search or RSS retrieval.
  - `/api/algorithms/activate` and sync jobs — coordinate shared-pool reuse, approved RSS ingestion, subscription refresh, and bounded YouTube Search gap filling before feed reads.
  - `/api/classify` — internal job: for new content_items, calls the Anthropic API to tag topic/type/quality, stores the result.
  - `/api/feedback` — records not-interested / more-like-this / never-show events for future scoring adjustments.

### Database (Supabase Postgres)
- Single source of truth for everything except ephemeral UI state.
- Row Level Security (RLS) scopes every table to `auth.uid()`, so a user can only ever read/write their own rows — removes an entire class of authorization bugs for a solo dev with no time to hand-roll access control.

## 7. Where State Lives

| State | Location | Why |
|---|---|---|
| Auth session | Supabase Auth JWT (extension: `chrome.storage.local`; web: cookie) | Standard, secure, shared across both surfaces |
| Rules/weights (source of truth) | Postgres: `algorithms`, `topic_weights`, `rules` | Durable, queryable, portable across devices |
| YouTube OAuth tokens | Postgres: `oauth_connections`, server-side only; encryption at rest is a launch blocker | Never stored in the browser |
| Raw fetched content metadata | Postgres: `content_items` | Reusable across users with overlapping subscriptions — avoids refetching |
| Classification scores | Postgres: `classifications` | Cached per item, avoids re-calling the classifier every load |
| Topic concepts and intent | Postgres + pgvector: concept table and intent cache | Maps custom terms, slang, aliases, and goals to canonical concepts; persists algorithm intent profiles per user algorithm |
| Current visible feed / rank | Postgres: `feed_cache` (short TTL), mirrored into `chrome.storage.local` | DB is the source of truth; local storage is a fast read cache for the content script |
| "Hidden this session" video IDs | `chrome.storage.local` only | Ephemeral UI state, no reason to sync to the server |

## 8. Data Flow — "User opens youtube.com"

```mermaid
sequenceDiagram
    participant U as User
    participant CS as Content Script
    participant BG as Background Worker
    participant API as Next.js API
    participant DB as Postgres
    participant YT as YouTube API
    participant AI as Anthropic API

    U->>CS: navigates to youtube.com
    CS->>BG: request current feed
    BG->>API: GET /api/feed (auth token)
    API->>DB: fetch active algorithm + rules
    API->>DB: fetch cached content_items + classifications
    API->>API: score + rank per user's weights/rules
    API-->>BG: ranked feed (video_id, score, visible)
    BG-->>CS: apply to page
    CS->>CS: hide/reorder/mark DOM elements
    U->>CS: clicks "Not interested"
    CS->>BG: feedback event
    BG->>API: POST /api/feedback
    API->>DB: store feedback_event, adjust future scoring
```

  Candidate retrieval runs separately during algorithm activation and scheduled sync:

  ```mermaid
  flowchart LR
    ACT[Activation or sync job] --> POOL[Reuse shared classified pool]
    POOL --> RSS[Poll approved RSS seed channels]
    RSS --> GAP[Measure topic coverage]
    GAP --> SEARCH[Bounded YouTube Search gap filling]
    SEARCH --> ENRICH[Classify and enrich]
    ENRICH --> STORE[(content_items + classifications)]
    STORE --> FEED[/api/feed and extension ranking/]
  ```

## 9. Database Schema

```sql
-- Supabase manages auth.users; this extends it with app-specific fields
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  plan text not null default 'free'
);

create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,                       -- 'youtube'
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  scope text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.algorithms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,                            -- 'Work' / 'Learning' / 'Relax'
  is_active boolean not null default false,
  goal_text text,                                -- free-text objective, e.g. "learn AI agents"
  created_at timestamptz not null default now()
);

create table public.topic_weights (
  id uuid primary key default gen_random_uuid(),
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  topic text not null,
  weight numeric not null check (weight >= 0 and weight <= 100)
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  type text not null check (type in ('always_show','never_show','priority')),
  condition_text text not null,                  -- e.g. "no celebrity gossip"
  created_at timestamptz not null default now()
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'youtube',
  external_id text not null,                     -- YouTube video id
  title text not null,
  channel_name text,
  channel_id text,
  published_at timestamptz,
  raw_metadata jsonb,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.classifications (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  topics text[] not null default '{}',
  content_type text,                             -- 'tutorial' | 'news' | 'opinion' | 'entertainment' ...
  quality_score numeric,                         -- 0-100
  reasoning text,
  classified_at timestamptz not null default now()
);

create table public.feed_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  score numeric not null,
  rank int not null,
  visible boolean not null default true,
  generated_at timestamptz not null default now()
);

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  event_type text not null check (event_type in ('not_interested','more_like_this','never_show_channel')),
  created_at timestamptz not null default now()
);

-- indexes
create index on public.feed_cache (user_id, algorithm_id, rank);
create index on public.classifications (content_item_id);
create index on public.content_items (channel_id);

-- Row Level Security (repeat pattern per table)
alter table public.algorithms enable row level security;
create policy "own rows only" on public.algorithms
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 10. Entity Relationship Diagram

```mermaid
erDiagram
    PROFILES ||--o{ OAUTH_CONNECTIONS : has
    PROFILES ||--o{ ALGORITHMS : owns
    ALGORITHMS ||--o{ TOPIC_WEIGHTS : has
    ALGORITHMS ||--o{ RULES : has
    PROFILES ||--o{ FEED_CACHE : has
    ALGORITHMS ||--o{ FEED_CACHE : scopes
    CONTENT_ITEMS ||--o{ FEED_CACHE : ranked_in
    CONTENT_ITEMS ||--o{ CLASSIFICATIONS : has
    PROFILES ||--o{ FEEDBACK_EVENTS : generates
    CONTENT_ITEMS ||--o{ FEEDBACK_EVENTS : target
```

## 11. Scoring Logic (summary)

For each candidate `content_item`:
1. Look up its `classifications.topics` and match against the active algorithm's `topic_weights` → base score.
2. Apply `rules`: `always_show` forces inclusion regardless of score; `never_show` zeroes it out; `priority` boosts matching items to the top.
3. Adjust using recent `feedback_events` for the same channel/topic (simple decay-weighted signal — e.g. 3+ "not interested" on a channel suppresses it going forward).
4. Sort, write to `feed_cache`, return to the extension.

## 12. Known Fragility Points (carry-over from product discussion)
- YouTube's homepage/"Up Next" recommendation surfaces aren't exposed via the official API — this MVP intentionally scopes to **subscriptions + search**, which are stable and sanctioned, to avoid depending on undocumented internal endpoints.
- Any DOM-based hiding/reordering on youtube.com will need occasional maintenance when YouTube changes its frontend markup.
