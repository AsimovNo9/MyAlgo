# Personal Algorithm — Requirements, Architecture & TODO

**Document status:** Consolidated working specification  
**Product:** Browser extension + web application for a user-controlled personal recommendation layer  
**Initial platform:** YouTube Web  
**Operating principle:** The user controls the recommendation objective; the platform remains the underlying content source.

## 0. Documentation Authority and Status

This document is the canonical product and target-architecture specification. The audited implementation matrix is [docs/STATUS.md](STATUS.md), the short execution checklist is [TODO.md](../TODO.md), and [docs/GITHUB_ISSUES.md](GITHUB_ISSUES.md) contains actionable issue scopes only.

Use these status meanings consistently:

- **Implemented**: the code, migration, or document exists.
- **Verified locally**: focused local tests, typecheck, build, or schema checks pass.
- **Verified in production**: validated against the deployed app, production database, real provider flow, or real extension installation.
- **Planned**: agreed work not complete.
- **Deferred**: intentionally postponed until a measured need or prerequisite exists.

An implemented feature is not automatically locally verified; local verification is not production verification. Checkboxes in older documents are historical unless they agree with [docs/STATUS.md](STATUS.md).

---

## 1. Product Definition

### 1.1 Core product

The product is a browser extension and web dashboard that allows a user to define a personal recommendation algorithm and apply it to an existing platform feed.

The system should not merely hide unwanted content. It should:

1. Understand the user's explicit preferences.
2. Learn the user's taste from available signals.
3. Build a semantic representation of the user's interests.
4. Retrieve additional candidate content relevant to those interests.
5. Classify and enrich candidate content.
6. Rank and diversify the candidates according to the user's personal algorithm.
7. Replace low-value or rejected feed slots with better-matching content where technically possible.
8. Continuously learn from explicit and behavioural feedback.

### 1.2 Product promise

> **Your algorithm. Your rules. Your feed.**

The user's intent should remain authoritative. The system may learn nuance, but it should not silently replace the user's explicit constraints.

---

# 2. Current Product Problem

The existing implementation has demonstrated that basic topic filtering/ranking is insufficient.

The current flow can fetch and classify a pool of YouTube items, but the recommendation quality is limited when:

- the required content is not already in the fetched pool;
- topics are represented only as flat labels;
- aliases/case variants are treated as separate topics;
- language is not treated as a first-class signal;
- the user's historical taste is not incorporated into candidate retrieval;
- the system uses generic topic matching rather than semantic context;
- only existing platform cards are ranked, rather than retrieving new candidates;
- repeated/watched content can reappear unless explicitly excluded;
- injected recommendations are not reliably replaced into the native feed.

The major architectural change is therefore:

```text
Current
YouTube/API pool -> classify -> rank -> feed

Target
User intent + taste
        -> candidate retrieval
        -> semantic enrichment/classification
        -> personal ranking
        -> diversity/exploration
        -> feed replacement/reranking
        -> feedback
        -> taste update
```

---

# 3. Requirements

## 3.1 Functional requirements

### FR-01 — User-defined algorithms

Users must be able to define one or more algorithm profiles.

Each profile may contain:

- weighted topics;
- positive preferences;
- negative preferences;
- always-show rules;
- never-show rules;
- language preferences;
- preferred content formats;
- creator/channel preferences;
- exploration/discovery preference;
- active/inactive status.

Example:

```text
Gaming                 40%
RPG                    25%
Nintendo               15%
Game development       10%
Strategy                5%
Other                   5%

Language: English

Prefer:
- reviews
- developer commentary
- deep analysis

Avoid:
- generic gaming news
- ragebait
- repetitive/reposted content
- unwanted languages
```

### FR-02 — Natural-language algorithm creation

A user should eventually be able to describe an objective in natural language:

> "I want to become knowledgeable about AI agents without getting generic AI hype."

The system should translate that intent into structured preferences, rules, semantic concepts, and candidate queries.

### FR-03 — Taste profiling

The system must maintain a learned taste profile independent from the explicit algorithm.

Potential signals:

- subscriptions;
- liked videos;
- user-created feedback actions;
- videos opened;
- videos revisited;
- meaningful watch-progress signals captured by the extension;
- repeated selections;
- hidden channels/topics;
- preferred formats;
- preferred languages.

Important constraint: platform APIs may not expose complete historical activity. For YouTube, watch history should therefore be treated as a first-party signal captured after extension installation rather than an assumed importable API dataset.

### FR-04 — Semantic concept model

The system must represent concepts as more than flat keywords.

A concept should support:

- canonical name;
- aliases;
- language variants;
- parent concepts;
- child concepts;
- related concepts;
- entities;
- representative phrases;
- positive indicators;
- negative indicators;
- content formats;
- embedding/vector representation;
- provenance/source;
- confidence/version.

### FR-05 — Candidate generation

The recommendation system must be able to retrieve content that is not already present in the current native feed.

Candidate sources should include, where supported:

- subscribed channels;
- creators associated with positive feedback;
- topic searches;
- subtopic searches;
- semantic expansions;
- entity searches;
- recent/fresh content;
- controlled discovery candidates.

### FR-06 — Semantic content classification

Each candidate should be classified across multiple dimensions, not merely assigned a single topic label.

Recommended facets:

- topic;
- subtopic;
- entity;
- creator/channel;
- publisher/source;
- language;
- format;
- category;
- freshness;
- semantic similarity;
- confidence.

### FR-07 — Hard constraints

Explicit exclusions must override soft scoring.

Examples:

```text
Language = English only
        -> non-English item is rejected

Never show celebrity gossip
        -> item is rejected
```

An always-show rule should only override a soft ranking penalty; it should not override a higher-level safety or product-level exclusion policy.

### FR-08 — Personal ranking

Each candidate must receive a user-specific score based on explicit preferences, learned taste, semantic similarity and other ranking features.

Conceptual model:

```text
final_score =
    explicit_preference_match
  + learned_taste_match
  + semantic_similarity
  + creator_affinity
  + format_affinity
  + freshness
  + novelty
  + discovery_bonus
  - explicit_negative
  - repetition_penalty
  - language_penalty
```

### FR-09 — Diversity

The highest-scoring candidates must not automatically become the entire feed.

The final feed should balance:

- strong matches;
- related content;
- discovery;
- novelty;
- source/creator diversity;
- format diversity.

### FR-10 — Feed replacement

When a native platform card is rejected by the personal algorithm, the extension should replace that slot with a personalized recommendation when sufficient candidate metadata is available.

The extension must distinguish between:

- native platform cards;
- personal recommendation cards;
- extension UI/shelves.

Injected cards must not be re-collected as native candidate inputs.

### FR-11 — Feedback loop

The user must be able to provide explicit feedback such as:

- More like this;
- Less like this;
- Hide channel;
- Never show this type;
- Undo.

Feedback should influence future ranking and taste updates.

### FR-12 — Explainability

Each personalized recommendation should expose a human-readable explanation.

Example:

```text
82% match

Why you're seeing this:
+ Matches RPG
+ Matches Nintendo
+ English
+ Developer commentary
+ Similar to creators you engage with
- Slightly older content
```

The current internal scoring/debug language should not be presented directly to users.

### FR-13 — Watched-content exclusion

Previously watched or meaningfully consumed content must not reappear as a fresh recommendation unless the user explicitly permits revisiting it.

The learned activity layer must therefore be joined into candidate visibility/ranking decisions.

### FR-14 — Language-aware discovery

Language should participate in candidate retrieval and ranking, not merely post-hoc filtering.

For YouTube, the retrieval layer should use available language controls where applicable and maintain an explicit language preference in the user model.

### FR-15 — Local-first classification

Cheap deterministic classification should happen before expensive semantic inference.

Recommended pipeline:

```text
1000 candidates
    -> deterministic filters
    -> metadata rules
    -> local/cheap classifier
    -> semantic classifier for uncertain cases
    -> optional LLM for ambiguous cases
    -> optional visual/multimodal analysis
```

### FR-16 — Privacy

Do not unnecessarily store:

- complete browsing history;
- private messages;
- full third-party page content;
- platform credentials;
- complete feed snapshots;
- raw content in analytics.

Store only what is needed for product functionality, ranking improvement and operational support.

### FR-17 — Authentication and billing

The web application must support:

- Supabase authentication;
- Google OAuth;
- user-scoped persisted preferences;
- Stripe subscriptions;
- server-authoritative entitlement checks.

### FR-18 — Extension security

No privileged secrets may ship in the extension bundle.

The extension communicates with the first-party API and uses the minimum necessary browser permissions.

---

# 4. Non-Functional Requirements

## NFR-01 — Lean operations

Initial infrastructure must remain Stage 1:

- Vercel;
- Supabase/Postgres;
- Stripe;
- Sentry;
- PostHog;
- Resend;
- GitHub Actions.

Do not add Redis, queues, Kubernetes, managed worker fleets, Kafka, data warehouses or separate inference clusters until measured bottlenecks justify them.

## NFR-02 — Low latency

The feed must render without a noticeable pause while expensive classification happens asynchronously where possible.

Preferred pattern:

```text
cached model/config
      -> fast initial render
      -> background enrichment
      -> updated ranking
```

## NFR-03 — Type safety

TypeScript across web, extension and shared contracts.

Use Zod for runtime validation at API boundaries.

## NFR-04 — Testability

Core ranking and classification logic must be deterministic and testable independently of the UI.

## NFR-05 — Explainability and debugging

Store scoring reasons and model/version metadata in a form suitable for debugging without exposing implementation noise in the user interface.

## NFR-06 — Resilience

The system must tolerate:

- stale extension configuration;
- missing network connectivity;
- upstream API errors;
- expired auth;
- third-party schema/UI changes;
- partial candidate retrieval;
- classifier failures.

---

# 5. Target Architecture

## 5.1 High-level architecture

```text
                               USER
                                 │
              ┌──────────────────┴───────────────────┐
              │                                      │
              ▼                                      ▼
       Browser Extension                         Web App
              │                                      │
              └──────────────────┬───────────────────┘
                                 │ HTTPS
                                 ▼
                       Next.js Modular Monolith
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
   Preference/Taste         Recommendation         Auth/Billing
      Services                Pipeline                Services
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 ▼
                         Supabase PostgreSQL
                                 │
                        pgvector / relational data
                                 │
              ┌──────────────────┼─────────────────┐
              ▼                  ▼                 ▼
        Concept graph       User taste         Content index
                                 │
                                 ▼
                         Candidate retrieval
                                 │
                   ┌─────────────┼─────────────┐
                   ▼             ▼             ▼
               YouTube API   semantic search  future sources
                   │             │             │
                   └─────────────┼─────────────┘
                                 ▼
                          Personal reranker
                                 │
                                 ▼
                            Feed renderer
```

## 5.2 Core recommendation pipeline

```text
User intent
    │
    ▼
Explicit algorithm
    │
    +
Learned taste profile
    │
    +
Semantic concept graph
    │
    ▼
Query / candidate generator
    │
    ▼
200–1000 candidates
    │
    ▼
Hard filtering
(language, watched, explicit exclusions)
    │
    ▼
Metadata enrichment
    │
    ▼
Semantic classification
    │
    ▼
Personal reranking
    │
    ▼
Diversity / exploration
    │
    ▼
Final feed
    │
    ▼
User feedback
    │
    ▼
Taste update
```

---

# 6. Monorepo Structure

The repository structure remains aligned to the existing project constraint.

```text
algorithm-control/
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   │   ├── background/
│   │   │   ├── content-scripts/
│   │   │   ├── popup/
│   │   │   ├── options/
│   │   │   ├── lib/
│   │   │   └── platform/
│   │   ├── public/
│   │   ├── manifest.json
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── web/
│       ├── app/
│       │   ├── (marketing)/
│       │   ├── (dashboard)/
│       │   ├── api/
│       │   │   ├── algorithms/
│       │   │   ├── rules/
│       │   │   ├── feed/
│       │   │   ├── classify/
│       │   │   ├── feedback/
│       │   │   ├── activity/
│       │   │   ├── discover/
│       │   │   └── stripe/
│       │   └── auth/
│       ├── lib/
│       │   ├── auth/
│       │   ├── db/
│       │   ├── recommendation/
│       │   ├── retrieval/
│       │   ├── classification/
│       │   ├── semantic/
│       │   └── integrations/
│       └── package.json
│
├── packages/
│   ├── shared-types/
│   └── db/
│
├── supabase/
│   ├── migrations/
│   └── config.toml
│
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── recommender.md
│   ├── semantic-knowledge-layer.md
│   └── platform-integrations/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── .github/
│   └── workflows/
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

# 7. Component Responsibilities

## 7.1 Extension

### Background service worker

Responsible for:

- extension lifecycle;
- authenticated API requests;
- feed synchronization;
- cached configuration;
- message routing;
- batched activity/feedback uploads.

### Content script

Responsible for:

- detecting supported platform pages;
- finding native feed cards;
- normalizing cards into `FeedItem` records;
- observing dynamic page changes;
- hiding/replacing/rerendering cards;
- displaying explanation UI;
- recording interaction signals.

### Platform adapter

Platform-specific code should be isolated.

For YouTube:

```text
YouTube adapter
  -> detect cards
  -> extract title/channel/url/thumbnail
  -> detect Shorts
  -> render replacement card
  -> track native vs injected cards
```

No generic recommender logic should depend on YouTube DOM selectors.

---

# 8. Semantic Knowledge Layer

This is the core new capability required to move beyond keyword filtering.

## 8.1 Concept object

Example:

```json
{
  "id": "rpg",
  "canonicalName": "Role-playing games",
  "description": "Video games centered on character progression, role systems, narrative or strategic decision-making.",
  "aliases": [
    "RPG",
    "role playing game",
    "roleplaying game",
    "JRPG"
  ],
  "parents": [
    "gaming",
    "video-games"
  ],
  "children": [
    "JRPG",
    "CRPG",
    "action RPG",
    "tactical RPG"
  ],
  "related": [
    "game design",
    "character progression",
    "narrative games",
    "turn-based combat"
  ],
  "entities": [
    "Final Fantasy",
    "Dragon Quest",
    "Persona",
    "Baldur's Gate"
  ],
  "formats": [
    "review",
    "analysis",
    "developer interview",
    "retrospective"
  ],
  "positivePhrases": [
    "RPG mechanics",
    "RPG combat",
    "RPG design",
    "best JRPGs"
  ],
  "negativePhrases": [],
  "embedding": "...",
  "language": "en",
  "version": 1
}
```

## 8.2 Relationship types

Recommended initial relations:

```text
parent_of
child_of
related_to
alias_of
example_of
contrasts_with
often_cooccurs_with
format_for
entity_of
```

## 8.3 Data sources

The semantic repository should be seeded from:

1. Curated domain concepts.
2. Public knowledge/ontology sources.
3. User language and natural-language intent.
4. Repeated expressions found in analysed content.
5. Existing platform taxonomy where useful.

External sources should provide seed/enrichment data, not become the sole product source of truth.

---

# 9. Vector / Semantic Retrieval

## 9.1 Vector strategy

Use `pgvector` in Supabase/Postgres initially rather than introducing a separate vector database.

Store embeddings for:

- concepts;
- aliases/phrases where useful;
- content items;
- creators/channels where justified;
- user taste profiles;
- algorithm intents.

## 9.2 User embedding

Construct a user-interest representation from:

```text
explicit weighted topics
+
positive learned affinities
+
negative learned affinities
+
preferred formats
+
preferred creators/entities
```

Use that representation to retrieve semantically nearby candidates.

## 9.3 Important distinction

Embeddings should help answer:

> "What is this content semantically close to?"

The recommender still needs a separate answer to:

> "How much does this particular user want it?"

Therefore:

```text
embedding similarity != final recommendation score
```

---

# 10. Classifier Design

## 10.1 Multi-stage classification

```text
Candidate
   │
   ▼
Metadata parser
   │
   ├── language
   ├── category
   ├── channel
   ├── duration
   └── title/description/tags
   │
   ▼
Deterministic classification
   │
   ▼
Semantic concept retrieval
   │
   ▼
Semantic classifier
   │
   ▼
LLM fallback for ambiguous cases
   │
   ▼
Optional multimodal classifier
```

## 10.2 Image classifier requirement

An image classifier is **not an MVP requirement**.

Add visual understanding only when user data shows a meaningful preference that text/metadata cannot represent, for example:

- gameplay vs talking-head content;
- visual style;
- thumbnail conventions;
- presentation format.

The intended progression is:

```text
metadata
  -> semantic text
  -> visual signals
  -> multimodal/video understanding
```

---

# 11. Retrieval / Candidate Generation

## 11.1 Candidate generators

### Generator A — Subscription uploads

Recent videos from subscribed channels.

### Generator B — Positive creator retrieval

Creators/channels associated with positive user interactions.

### Generator C — Concept retrieval

Queries generated from weighted concepts and semantic neighbourhoods.

### Generator D — Entity retrieval

Queries around highly relevant named entities.

### Generator E — Format retrieval

Queries constrained to preferred formats such as reviews, tutorials or developer commentary.

### Generator F — Freshness retrieval

Recent candidate content for time-sensitive topics.

### Generator G — Discovery

Candidates adjacent to, but not identical to, established user interests.

---

# 12. Candidate Query Generation

Do not concatenate all preferences into one generic query.

Instead, create a query planner that generates multiple focused searches.

Example user intent:

```text
Gaming 40%
RPG 25%
Nintendo 15%
Developer commentary 10%
Strategy 10%
```

Possible queries:

```text
Nintendo RPG deep dive
Nintendo RPG developer commentary
JRPG developer interview
Nintendo game design analysis
RPG mechanics analysis
Nintendo RPG review
```

Query generation should consider:

- semantic neighbourhood;
- explicit weights;
- entities;
- formats;
- language;
- region;
- freshness;
- excluded concepts.

---

# 13. Personal Ranking Model

## 13.1 Inputs

```text
Explicit preference match
Learned topic affinity
Creator affinity
Format affinity
Entity affinity
Language match
Semantic similarity
Freshness
Novelty
Discovery/exploration bonus
Repetition penalty
Watched penalty/exclusion
Negative preference
```

## 13.2 Hard vs soft logic

```text
Hard filter
  -> removes candidate

Soft ranking signal
  -> changes candidate score
```

This prevents the common mistake of allowing a large positive score to overpower an explicit exclusion.

## 13.3 Initial deterministic implementation

Start with a transparent feature-weighted scorer before training a learned ranking model.

```ts
function score(candidate, user) {
  return (
    candidate.explicitPreferenceMatch +
    candidate.learnedTasteMatch +
    candidate.semanticSimilarity +
    candidate.creatorAffinity +
    candidate.formatAffinity +
    candidate.freshness +
    candidate.novelty +
    candidate.discoveryBonus -
    candidate.negativePreference -
    candidate.repetitionPenalty
  );
}
```

Every feature should have a bounded range and documented meaning.

---

# 14. Diversity / Exploration

## 14.1 Feed lanes

The final feed should conceptually include:

```text
MATCHED
Strong fit for known interests

DISCOVERY
Close to known interests but introduces something new

EXPLORE
Controlled novelty outside the established profile
```

## 14.2 Diversity controls

Avoid consecutive repetition of:

- same channel;
- same exact concept;
- same format;
- near-duplicate title/topic;
- previously surfaced content.

---

# 15. Data Model

The following is the target logical schema. The existing repository should remain the implementation source of truth where its documented schema is binding.

## 15.1 Core user tables

```sql
users
  id
  auth_provider_id
  email
  created_at
  updated_at

subscriptions
  id
  user_id
  provider
  provider_customer_id
  provider_subscription_id
  status
  plan
  current_period_end
  created_at
  updated_at
```

## 15.2 Algorithm tables

```sql
preference_profiles
  id
  user_id
  name
  description
  is_default
  version
  created_at
  updated_at

topic_preferences
  id
  profile_id
  topic_key
  label
  weight
  created_at
  updated_at

rules
  id
  profile_id
  name
  rule_type
  enabled
  priority
  config_json
  created_at
  updated_at
```

## 15.3 Semantic tables

```sql
concepts
  id
  canonical_name
  description
  parent_concept_id
  metadata_json
  embedding
  language
  version
  created_at
  updated_at

concept_aliases
  concept_id
  phrase
  language
  weight

concept_relations
  source_concept_id
  target_concept_id
  relation_type
  weight
  provenance
```

## 15.4 Content tables

```sql
content_items
  id
  platform
  external_content_id
  title
  description
  creator_id
  channel_id
  language
  format
  published_at
  metadata_json
  content_hash
  created_at
  updated_at

content_embeddings
  content_id
  embedding
  model_version

content_concepts
  content_id
  concept_id
  confidence
  model_version
```

## 15.5 User taste/activity tables

```sql
user_taste
  user_id
  concept_id
  affinity
  confidence
  evidence_count
  updated_at

user_creator_affinity
  user_id
  creator_id
  affinity
  confidence
  updated_at

user_format_affinity
  user_id
  format
  affinity
  confidence
  updated_at

user_taste_embeddings
  user_id
  embedding
  model_version
  updated_at

activity_events
  id
  user_id
  platform
  external_content_id
  event_type
  metadata_json
  occurred_at
  received_at
```

## 15.6 Operational tables

```sql
installations
sync_versions
stripe_webhook_events
```

All user-owned tables require Row Level Security.

---

# 16. API Surface

Recommended target endpoints:

```text
GET    /api/algorithms
POST   /api/algorithms
PUT    /api/algorithms/:id
DELETE /api/algorithms/:id

GET    /api/rules
POST   /api/rules
PUT    /api/rules/:id
DELETE /api/rules/:id

GET    /api/feed
POST   /api/discover
POST   /api/classify
POST   /api/feedback
POST   /api/activity

GET    /api/health
POST   /api/installations
POST   /api/stripe/webhook
```

The API contracts must live in `packages/shared-types`.

---

# 17. Extension Feed Behaviour

## 17.1 Native card pipeline

```text
YouTube DOM
    ↓
identify native card
    ↓
normalize FeedItem
    ↓
request score/rank
    ↓
apply visibility/replacement decision
```

## 17.2 Replacement behaviour

When a card is rejected:

```text
Native card
   │
   ├── acceptable -> keep/rerank
   │
   └── rejected -> insert personal recommendation card
```

Replacement cards must carry a marker, e.g.:

```html
data-personal-algorithm="true"
```

and should never be fed back into the native candidate collector.

## 17.3 Shorts

Shorts must remain visible unless the user explicitly enables the Hide Shorts preference.

Watched-state filtering remains independent from Shorts preference handling.

---

# 18. Authentication Flow

```text
Extension
   │
   ▼
Open first-party auth page
   │
   ▼
Supabase / Google OAuth
   │
   ▼
Auth callback
   │
   ▼
Session established
   │
   ▼
Extension receives authenticated state
   │
   ▼
Fetch algorithm + taste config
   │
   ▼
Cache locally
```

Never embed service-role credentials or provider secrets in the extension.

---

# 19. Billing Flow

```text
Dashboard
   │
   ▼
Stripe Checkout
   │
   ▼
Stripe
   │ webhook
   ▼
/api/stripe/webhook
   │
   ▼
subscriptions
   │
   ▼
server-side entitlement check
   │
   ▼
API / extension behaviour
```

Stripe webhook processing must be signature-verified and idempotent.

---

# 20. Observability

## Sentry

Track:

- API errors;
- classifier failures;
- YouTube adapter failures;
- extension runtime errors;
- sync failures;
- unexpected scoring states.

## PostHog

Track product events such as:

```text
signup_completed
extension_installed
algorithm_created
rule_created
content_hidden
more_like_this
less_like_this
candidate_generated
candidate_classified
feed_replacement
sync_completed
subscription_started
subscription_cancelled
```

Do not send raw third-party page content to analytics.

---

# 21. Testing Strategy

## Unit tests

- concept normalization;
- alias matching;
- language detection;
- hard exclusions;
- score calculation;
- diversity logic;
- candidate deduplication;
- watched-state exclusion;
- feedback updates;
- query generation;
- semantic thresholding.

## Integration tests

- API -> DB;
- auth -> API;
- discovery -> candidate pool;
- classification -> content concepts;
- feedback -> taste updates;
- Stripe webhook -> entitlements.

## Extension tests

- native card detection;
- injected card detection;
- replacement;
- Shorts behaviour;
- DOM mutation handling;
- duplicate prevention;
- extension message passing.

## Regression fixtures

Maintain representative feed fixtures for:

- normal videos;
- Shorts;
- multiple languages;
- duplicate channels;
- already watched videos;
- injected recommendations;
- ambiguous concepts;
- low-metadata candidates.

---

# 22. Deployment / Infrastructure

## Stage 1

```text
                   INTERNET
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
       Vercel                 Browser Extension
          │
          ▼
     Next.js API
          │
          ▼
    Supabase Postgres
      /           \
     /             \
 pgvector        Auth
     │
     ├── concepts
     ├── content
     ├── taste
     └── preferences

External services:
Stripe / Sentry / PostHog / Resend
```

## Environments

```text
local
preview/staging
production
```

## CI

Every PR should run:

```text
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Production deployment should only occur after CI passes.

## Infrastructure scaling principle

Do not add new infrastructure because it is theoretically useful.

Add infrastructure only after measuring a bottleneck.

Potential future progression:

```text
Stage 1
Vercel + Postgres

      ↓ measured need

Stage 2
+ queue/worker

      ↓ measured need

Stage 3
+ Redis/cache
+ read replicas
+ dedicated classifier workers

      ↓ measured need

Stage 4
+ analytics warehouse
+ dedicated inference infrastructure
```

---

# 23. Product Development Priorities

The recommendation engine is the product's main technical differentiator.

Engineering effort should be prioritized toward:

1. semantic knowledge;
2. candidate generation;
3. taste modelling;
4. ranking;
5. diversity;
6. feedback loops;
7. feed replacement UX.

Engineering effort should be minimized on:

- unnecessary infrastructure;
- microservices;
- self-managed databases;
- custom auth;
- custom billing;
- always-on workers;
- premature ML training infrastructure.

---

# 24. TODO — Immediate MVP

## Priority P0 — Must work

### Product / UX

- [ ] Replace flat topic labels with normalized content facets.
- [ ] Make language a first-class preference.
- [ ] Make hard exclusions distinct from soft ranking preferences.
- [ ] Add onboarding that asks for intent in natural language.
- [ ] Add a short taste-calibration flow with explicit positive/negative choices.
- [ ] Improve "Why am I seeing this?" explanation language.

### Data / recommender

- [ ] Implement canonical concept model.
- [ ] Implement aliases and synonym normalization.
- [ ] Add concept parent/child/related relationships.
- [ ] Add user taste profile tables.
- [ ] Add creator/channel and format affinity.
- [ ] Ensure watched-state is a hard visibility rule.
- [ ] Deduplicate candidates by external content ID.
- [ ] Add candidate provenance/source tracking.

### Retrieval

- [ ] Create candidate-generation module.
- [ ] Generate multiple focused search queries per user algorithm.
- [ ] Add semantic query expansion.
- [ ] Add creator/channel candidates.
- [ ] Add recent/fresh candidates.
- [ ] Build a candidate pool substantially larger than the final feed.

### Ranking

- [ ] Implement feature-based reranker.
- [ ] Implement hard filtering before scoring.
- [ ] Add semantic similarity score.
- [ ] Add creator affinity.
- [ ] Add format affinity.
- [ ] Add repetition penalty.
- [ ] Add basic diversity pass.

### Extension

- [ ] Ensure rejected native cards are replaced, not merely hidden.
- [ ] Ensure replacement cards cannot be re-ingested as native cards.
- [ ] Ensure Shorts respect user setting.
- [ ] Ensure injected cards have stable DOM markers.
- [ ] Ensure DOM observer handles infinite scrolling.

---

# 25. TODO — Semantic Knowledge System

## Priority P1

- [ ] Create `concepts` schema.
- [ ] Create `concept_aliases` schema.
- [ ] Create `concept_relations` schema.
- [ ] Build initial curated concept seed set.
- [ ] Add language variants.
- [ ] Add concept provenance/versioning.
- [ ] Enable pgvector.
- [ ] Store concept embeddings.
- [ ] Store content embeddings.
- [ ] Implement nearest-concept retrieval.
- [ ] Implement user-interest embedding.
- [ ] Implement semantic candidate retrieval.
- [ ] Add LLM fallback only for low-confidence cases.

---

# 26. TODO — Taste Learning

## Priority P1

- [ ] Define canonical activity event types.
- [ ] Record explicit feedback.
- [ ] Record opened/revisited/completed activity where technically available.
- [ ] Build initial affinity update rules.
- [ ] Add confidence/evidence counts.
- [ ] Decay stale preferences where appropriate.
- [ ] Separate short-term interest from long-term interest.
- [ ] Allow user to inspect learned preferences.
- [ ] Allow user to reset learned preferences.

Potential model:

```text
Long-term taste
   +
Current session intent
   +
Active algorithm profile
   =
Current ranking objective
```

---

# 27. TODO — Recommendation Quality

## Priority P1

- [ ] Build offline candidate fixture dataset.
- [ ] Measure precision of hard exclusions.
- [ ] Measure false-positive rate for semantic concepts.
- [ ] Measure language correctness.
- [ ] Measure repeated-content rate.
- [ ] Measure creator concentration.
- [ ] Measure replacement success rate.
- [ ] Measure explicit feedback acceptance rate.
- [ ] Measure discovery acceptance separately from direct-match acceptance.

Core quality metrics:

```text
Relevant@10
Relevant@25
Relevant@50
Novelty
Diversity
Repeated-content rate
Negative-feedback rate
User correction rate
```

---

# 28. TODO — Classifier Evolution

## Priority P2

### Stage A

- [ ] Metadata-only classifier.
- [ ] Keyword/alias matching.
- [ ] Concept graph matching.

### Stage B

- [ ] Semantic text classifier.
- [ ] Embedding similarity.
- [ ] LLM fallback.

### Stage C

Only if justified by evidence:

- [ ] Thumbnail classifier.
- [ ] Visual format classifier.
- [ ] Multimodal model.
- [ ] Video-level understanding.

Do not start Stage C until Stage A/B demonstrably fail on real user cases.

---

# 29. TODO — Extension Feed Experience

- [ ] Add visible match percentage only where useful.
- [ ] Add concise explanation chips.
- [ ] Add "Why this?" interaction.
- [ ] Add "More like this".
- [ ] Add "Less like this".
- [ ] Add "Hide channel".
- [ ] Add "Undo".
- [ ] Add subtle "Personal pick" labelling.
- [ ] Avoid visually overwhelming the native YouTube experience.
- [ ] Make dark/light mode compatible.

Example card:

```text
82% match

Nintendo RPG Developer Deep Dive
Example Channel

+ RPG
+ Nintendo
+ Developer commentary
+ English

[More like this] [Less like this] [Why?]
```

---

# 30. TODO — Dashboard Experience

- [ ] Home overview.
- [ ] Active algorithm card.
- [ ] Algorithm editor.
- [ ] Natural-language algorithm creation.
- [ ] Rules editor.
- [ ] Learned taste view.
- [ ] Semantic concepts view.
- [ ] Recommendation explanations.
- [ ] Analytics.
- [ ] Templates.
- [ ] Settings.
- [ ] Billing.

Useful dashboard concept:

```text
Your algorithm

Explicit preferences
        │
        ▼
Learned taste
        │
        ▼
Semantic profile
        │
        ▼
Current recommendations
```

---

# 31. TODO — Privacy / Security

- [ ] Verify RLS policies on every user-data table.
- [ ] Validate all API inputs with Zod.
- [ ] Enforce user ownership on every query.
- [ ] Verify Stripe webhook signatures.
- [ ] Add webhook idempotency.
- [ ] Rotate any credentials accidentally exposed during development.
- [ ] Audit extension permissions.
- [ ] Audit analytics payloads for third-party content leakage.
- [ ] Document exactly what is collected.
- [ ] Document exactly what is not collected.
- [ ] Add account/data deletion path.

---

# 32. TODO — Production Readiness

- [ ] Sentry integration.
- [ ] PostHog integration.
- [ ] Automated migrations.
- [ ] Database backup verification.
- [ ] Health endpoint monitoring.
- [ ] Smoke tests after production deployment.
- [ ] Extension release process.
- [ ] Rollback procedure.
- [ ] Dependency vulnerability checks.
- [ ] Rate limiting.
- [ ] API request tracing.
- [ ] Error dashboards.

---

# 33. TODO — Deliberately NOT Building Yet

Do not add these to the MVP unless a concrete requirement appears:

- [ ] Mobile application.
- [ ] iOS system-level feed interception.
- [ ] Android accessibility automation.
- [ ] Multiple social platforms simultaneously.
- [ ] Autonomous platform likes/follows/comments.
- [ ] Automated engagement intended to manipulate platform rankings.
- [ ] Kubernetes.

# 34. Semantic Knowledge Layer Review

## 34.1 Assessment of the pasted proposal

The proposal is directionally correct and strengthens this document's central product shift: Personal Algorithm must become a semantic recommendation layer, not a flat topic filter. Its strongest ideas are:

- concepts should include aliases, relationships, entities, phrases, formats, exclusions, provenance and versioning;
- the same semantic vocabulary should support intent parsing, candidate retrieval, classification and ranking;
- embeddings should provide fuzzy proximity while graph relationships provide structure and explanations;
- positive and negative neighborhoods should be modeled separately;
- Supabase/Postgres can support the first vector stage without adding another database;
- the LLM should receive retrieved semantic context and be used selectively rather than inventing the taxonomy on every request.

The proposal should not be implemented as one large jump. Three distinctions are important:

1. Knowledge proximity is not user relevance. A video can be close to a concept without matching the active algorithm, language, format or exclusions.
2. A vector database does not solve candidate coverage by itself. YouTube Search, subscriptions, RSS and liked videos still determine what enters the content index.
3. LLM output must not become the source of truth. Structured concepts, explicit rules, model versions, confidence and provenance must remain inspectable and reproducible.

## 34.2 Recommended target model

```text
Explicit algorithm + learned taste
  -> concept graph and semantic profile
  -> bounded source retrieval
  -> metadata normalization
  -> deterministic facets and concept matching
  -> vector nearest-neighbor expansion
  -> LLM fallback for low-confidence cases only
  -> hard exclusions
  -> transparent personal reranking
```

The concept graph is the durable product asset. Embeddings are a retrieval index over versioned concept/content text, not the definition of the taxonomy. The first useful semantic neighborhood can be built from curated concepts, existing aliases/intents, YouTube metadata, user language and approved relationships before automatic concept discovery is introduced.

## 34.3 Architecture decisions

- Stage 1: normalize concepts, aliases, relationships, facets and provenance; use deterministic graph expansion in query planning and classification.
- Stage 2: enable `pgvector`, embed versioned concept and content text, and use nearest-neighbor retrieval to fill measured coverage gaps.
- Stage 3: create a user-interest embedding from explicit weights, positive/negative affinities, formats, creators and entities; use it as one bounded ranking feature.
- Stage 4: use the LLM only for low-confidence classification, concept proposal, relation proposal or natural-language intent parsing. Persist structured output with confidence and model version.
- Always apply watched-content, language, source and explicit exclusion rules before soft semantic scoring.
- Never run embedding generation, YouTube Search or LLM classification from `/api/feed`, page mutation handlers or ordinary extension ranking requests.

# 35. TODO — Integrate the Semantic Knowledge Layer

## P0 — Concept graph MVP

- [x] Add the initial versioned migrations for the existing `concept_entries` catalog, `concept_aliases` and `concept_relations` with provenance, status, version and timestamps.
- [ ] Seed a small curated ontology for the initial product domains rather than attempting a universal dictionary.
- [ ] Import the current in-code concept aliases/intents into the database-backed catalog without changing existing query behavior.
- [ ] Add parent/child and related/contrast relationships for the highest-value concepts.
- [ ] Add entity and representative-phrase support as bounded metadata, not unvalidated free-form arrays from every model call.
- [x] Add concept catalog loading with deterministic fallback to the current `concepts.ts` map when the catalog is unavailable.
- [x] Update query planning and classifier context to consume the same database-backed catalog with deterministic fallback.
- [x] Update ranking explanations to consume approved catalog concepts and relationships.

## P1 — Semantic enrichment and retrieval

- [x] Add `content_concepts` and persist candidate concept matches with confidence and model version during YouTube and RSS sync.
- [ ] Enrich candidates with title, description, channel, creator, category, language, format, freshness and provider taxonomy before semantic matching.
- [ ] Implement deterministic graph expansion from explicit topics into aliases, child concepts, related concepts, entities and preferred formats.
- [x] Add bounded semantic-neighborhood query lanes from approved graph relations for strong topics.
- [x] Add a bounded freshness query lane for strong topics.
- [ ] Keep retrieval bounded, cached and provenance-preserving across subscriptions, RSS, liked videos and YouTube Search.
- [x] Add candidate quality metrics for duplicate rate, classification coverage, source diversity, topic coverage, and freshness coverage; production baselines remain planned.
- [x] Gate retrieval by per-interest coverage so broad topic volume cannot suppress missing concrete interests.

## P1 — Vector stage in Supabase

- [x] Enable `pgvector` through a tracked migration; production tables, index, and RPC are verified.
- [ ] Choose and record one embedding model, dimensions, normalization policy and versioning strategy.
- [x] Add `content_embeddings` and concept embedding storage with model-version uniqueness constraints.
- [x] Implement bounded embedding generation/backfill as server-side work with retry and timeout handling; Vercel provider configuration, cost controls, and stale-version operations remain planned.
- [x] Add a database nearest-neighbor function with a minimum similarity threshold and bounded result count.
- [x] Use vector retrieval only as an optional candidate-pool expansion boundary; it cannot bypass hard exclusions.
- [x] Add a safe empty fallback when embeddings or vector retrieval are unavailable.

## P1 — User semantic profile

- [ ] Build a profile document from explicit topics, goal text, positive/negative affinities, formats, creators, entities and language.
- [ ] Keep positive and negative neighborhoods separate so dislikes can suppress nearby concepts without deleting useful adjacent discovery.
- [ ] Generate a versioned user-interest embedding from the profile document only after profile inputs are stable.
- [ ] Keep short-term session intent separate from long-term taste and active algorithm configuration.
- [ ] Expose a user-facing summary of learned concepts, confidence and evidence without exposing raw activity history.
- [ ] Add reset/rebuild operations for derived semantic taste.

## P1 — Classifier and LLM boundary

- [ ] Make deterministic metadata classification the first stage for every candidate.
- [ ] Retrieve the candidate's semantic neighborhood before any LLM call.
- [ ] Call the LLM only when deterministic and vector confidence is below a configured threshold or when proposing reviewed ontology changes.
- [ ] Validate LLM output against shared schemas; reject malformed or unsupported concepts.
- [ ] Store model name, prompt/config revision, confidence, source context and timestamp for every accepted semantic result.
- [ ] Keep LLM-generated concepts and relations in a pending-review state until approved or confidently auto-approved by policy.
- [ ] Add cost and rate limits; never send private activity history or unnecessary raw page content.

## P1 — Ranking and feed integration

- [ ] Add bounded `semantic_intent_match`, `entity_affinity`, `creator_affinity` and `novelty` features to the transparent scorer.
- [ ] Apply hard watched, language, source and explicit negative rules before semantic ranking.
- [ ] Preserve matched, discovery and explore lanes with configurable caps.
- [ ] Explain semantic recommendations using approved concept names and relationships, not raw vector distances or implementation labels.
- [ ] Ensure `/api/feed` consumes the cached semantic candidate pool and never triggers retrieval or embedding generation.
- [ ] Ensure `/api/rank` only ranks current native YouTube cards and does not mutate the semantic pool.
- [ ] Keep replacement cards marked and excluded from native candidate collection.
- [ ] Add extension tests for native-card replacement, Shorts settings, infinite scroll, duplicate prevention and stale semantic-feed fallback.

## P2 — Ontology growth and operations

- [ ] Add reviewed admin tooling for concept and relationship changes.
- [ ] Add controlled imports from external knowledge graphs and YouTube taxonomy as seed material only.
- [ ] Mine recurring user phrases and content co-occurrences into reviewable concept/alias proposals.
- [ ] Add multilingual aliases and language-aware embeddings after English quality is measured.
- [ ] Add embedding backfill, re-embedding and rollback tooling by model version.
- [ ] Add monitoring for ontology drift, stale embeddings, retrieval coverage, LLM cost, false-positive rate and user correction rate.

## 35.1 Definition of done for the first semantic milestone

- [ ] A concept can be represented, aliased, related, versioned and explained from the database.
- [ ] The same concept catalog powers query expansion, candidate matching and user-facing explanations.
- [ ] A candidate can receive multiple concept matches with confidence rather than one flat topic label.
- [ ] The recommender can retrieve adjacent candidates without allowing semantic similarity to bypass explicit exclusions.
- [ ] Embedding retrieval is bounded, versioned, cached and optional when unavailable.
- [ ] LLM calls are limited to low-confidence or reviewed enrichment paths.
- [ ] Offline fixtures show measurable gains in relevant-at-K and coverage without regressing hard exclusions, watched-content exclusion or diversity.
- [ ] Kafka.
- [ ] Redis before needed.
- [ ] Dedicated worker infrastructure before needed.
- [ ] Separate vector database before pgvector is insufficient.
- [ ] Data warehouse before operational analytics require it.
- [ ] Custom authentication.
- [ ] Custom billing.
- [ ] Large-scale ML training infrastructure.
- [ ] Image classifier as an MVP prerequisite.

---

# 34. Recommended Build Sequence

```text
1. Fix content taxonomy
        ↓
2. Fix hard exclusions / watched state
        ↓
3. Build concept graph
        ↓
4. Build taste profile
        ↓
5. Build candidate generator
        ↓
6. Add semantic retrieval
        ↓
7. Replace flat scorer with personal reranker
        ↓
8. Add diversity/discovery
        ↓
9. Improve YouTube slot replacement
        ↓
10. Add explicit feedback loop
        ↓
11. Add LLM ambiguity fallback
        ↓
12. Measure quality
        ↓
13. Add visual classifier only if evidence supports it
```

This sequence avoids spending time on sophisticated models before the retrieval and data model are correct.

---

# 35. Definition of MVP Success

The MVP should achieve all of the following:

### User can say what they want

Example:

> "I want English-language gaming content focused on RPGs, Nintendo and game development."

### System understands the intent

It produces structured concepts and preferences.

### System learns from existing signals

It can use subscriptions, likes and first-party activity where available.

### System finds new content

The final recommendations are not restricted to the initial native YouTube card pool.

### System rejects obvious mismatches

Examples:

- wrong language;
- watched content;
- explicit exclusions;
- irrelevant topic.

### System surfaces genuinely relevant content

The user should recognise that the feed reflects their actual interests, not just the broad category they selected.

### System explains itself

Every recommendation should have a concise reason.

### System improves with use

Explicit feedback and behavioural signals alter future ranking.

---

# 36. Long-Term Product Architecture

The eventual system can evolve from a YouTube extension into a general personal information layer.

```text
                         PERSONAL ALGORITHM
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        │                         │                          │
        ▼                         ▼                          ▼
     YouTube                    Reddit                       X
        │                         │                          │
        └─────────────────────────┼──────────────────────────┘
                                  │
                                  ▼
                        Personal information model
                                  │
                     ┌────────────┼─────────────┐
                     ▼            ▼             ▼
                  topics       entities       goals
                     │            │             │
                     └────────────┼─────────────┘
                                  ▼
                         Personal recommendation
                                  │
                                  ▼
                             User-controlled
                            information layer
```

The strategic product progression is:

```text
Feed blocker
    ↓
Feed filter
    ↓
Personal algorithm
    ↓
Personal recommender
    ↓
Personal information agent
```

---

# 37. Architectural Principles

1. **The candidate pool is as important as the ranking model.**
2. **The user's explicit rules are authoritative.**
3. **Semantic understanding should be shared across retrieval, classification and ranking.**
4. **Embeddings are a retrieval/matching primitive, not the entire recommender.**
5. **LLMs should handle ambiguity and interpretation, not every candidate on every page.**
6. **Image understanding is optional until real data proves it is valuable.**
7. **The extension should remain fast and local-first where practical.**
8. **The personal algorithm should be explainable.**
9. **The system should learn, but the user should remain able to inspect and override the learned model.**
10. **Infrastructure stays lean until measured growth requires more.**

---

# 38. Immediate Engineering Focus

The next implementation slice should be:

```text
CONCEPT GRAPH
      +
USER TASTE PROFILE
      +
CANDIDATE RETRIEVAL
      +
SEMANTIC CLASSIFICATION
      +
PERSONAL RERANKER
      +
DIVERSITY
```

This is the part that turns the existing prototype from a topic filter into a genuine **personal recommendation engine**.

