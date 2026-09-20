Yes. I reviewed the current `main` branch, the architecture/deployment documents, database schema, OAuth/activity endpoints, and the current external platform policies. My read is that **the product has a plausible SaaS proposition, but its commercial model is not actually implemented yet, and there are several material platform/compliance risks that matter before charging users.**

[Repository README](https://github.com/AsimovNo9/MyAlgo/blob/main/README.md?utm_source=chatgpt.com)
[Deployment & scaling specification](https://github.com/AsimovNo9/MyAlgo/blob/main/DEPLOYMENT_AND_SCALING.md?utm_source=chatgpt.com)

## 1. What is the financial proposition?

The product is essentially:

> **Pay for a personal control/recommendation layer that sits on top of otherwise-free platforms.**

The economic value is not the YouTube videos themselves. It is the software's ability to let a user define an explicit algorithm, learn their preferences, filter/re-rank content, explain recommendations, and eventually carry that personal model across platforms.

The repository does **not** currently contain a real billing system, Stripe/payment integration, checkout flow, or paid entitlement model. It has a `profiles.plan` field defaulting to `free`, so the code indicates that a paid/free model is contemplated, but it does not define the actual commercial offer.

That distinction matters. You don't currently have "a $X/month product" in the code; you have **a potentially monetizable consumer SaaS whose core value proposition is control over recommendation systems**.

### The commercially interesting part

There are actually two different things you could be selling:

| Layer                       | What customer pays for                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| YouTube utility             | Better filtering/re-ranking of YouTube                                                                                    |
| Personal algorithm platform | A persistent personal taste/intent model, explanations, controls, learning, and eventually cross-platform recommendations |

The second is much more defensible commercially.

The first has a potentially serious **YouTube policy problem**, because YouTube's developer policies say that an API service mimicking YouTube must add sufficient independent value and that developers **cannot charge for services that YouTube itself offers for free**. ([Google for Developers][1])

So "£5/month for a better YouTube recommendation feed" is a much riskier commercial proposition than:

> "£5/month for your personal recommendation layer, which currently supports YouTube and is designed to work independently of any one platform."

That distinction should be reflected in the product, marketing, terms and architecture.

---

# 2. Your current cost model is more fragile than the repo suggests

The repository targets roughly **$0–20/month at MVP**, with the major variable cost expected to be Anthropic. That's directionally reasonable for a tiny development deployment, but I would not use it as the commercial financial model.

There are four different cost categories.

### A. Base infrastructure

The current architecture relies on Vercel + Supabase.

Vercel's current pricing says Hobby is intended for **personal, non-commercial use**; Pro starts at $20/month and is intended for professional/business use. ([Vercel][2])

Supabase currently has a free tier, with Pro starting at $25/month. ([Supabase][3])

So once this is actually a commercial service, a realistic minimum production budget is closer to:

**Vercel Pro ~$20 + potentially Supabase Pro ~$25 + domain + observability + AI + payment processing + tax/accounting.**

That is still cheap infrastructure, but the "$0–20" proposition should be considered an **MVP/development proposition**, not a sustainable commercial cost baseline.

---

### B. AI cost

This is actually manageable if you keep the architecture you have now.

OpenAI's current `text-embedding-3-small` price is $0.02 per million input tokens. ([OpenAI Developers][4])

That's effectively negligible for most consumer-scale recommendation workloads.

LLM classification is different. Anthropic's current Haiku-class pricing is substantially higher, so you need to ensure the expensive model is only invoked for genuinely ambiguous candidates. The repo's design already attempts this with deterministic classification followed by low-confidence fallback.

The important economic unit isn't "page view."

It's:

> **LLM classifications per active user per day × candidates per classification × token cost.**

For example, purely illustratively, if a classification averaged 1,000 input + 200 output tokens at approximately $1/M input and $5/M output, that is roughly **$0.002 per classification**.

That implies approximately:

* 1,000 classifications → $2
* 10,000 → $20
* 100,000 → $200

Those numbers are illustrative rather than a forecast; your real prompt/token profile is what matters.

### A bigger problem than cost: model dependency

The repo's classifier has also been using the older Claude Haiku 3.5 family, while Anthropic's current model lifecycle documentation shows Claude 3.5 Haiku as retired for the first-party API. ([Claude Platform Docs][5])

So AI dependency management needs to include:

**model pinning → supported model → fallback model → cost ceiling → quality regression test.**

Otherwise a model retirement can become an outage in the paid product.

---

# 3. The largest scaling risk isn't AI cost — it's YouTube quota

This is the issue I'd take most seriously financially.

Your architecture relies on YouTube Search for discovery. The repository tries to limit this, but each user can create demand for searches.

The current YouTube policy documentation says quotas and restrictions can be imposed and that quota extensions require an API Compliance Audit. ([Google for Developers][6])

The current YouTube API quota regime also has a much tighter default constraint around Search than a simple "10,000 units/day" mental model suggests: the default Search allowance is only around **100 search calls/day**, separate from the general API quota. ([Google for Developers][7])

That creates a surprisingly sharp ceiling.

Imagine:

```text
5 search queries per user sync
×
100 users
×
1 sync/day
=
500 search calls/day
```

That's already well beyond the default Search capacity.

You can improve this through:

* shared candidate pools
* RSS ingestion
* caching
* semantic retrieval
* creator/channel reuse
* fewer per-user searches
* quota extension/audit

Your repository already moves in that direction, which is good.

But financially, this means:

> **YouTube is potentially your capacity constraint before your infrastructure bill becomes large.**

A product could have 1,000 paying users while technically having an API access problem that prevents it from serving them correctly.

That's a classic platform-dependency risk.

---

# 4. There is a potentially serious YouTube policy issue in the recommendation architecture

This is more important than ordinary GDPR housekeeping.

Your system currently takes YouTube metadata and then derives things such as:

* topics
* content type
* format
* concepts
* semantic relationships
* embeddings
* learned user affinities

YouTube's developer policies say, among other things, that API clients should not infer/estimate certain video/channel category or type characteristics, and they impose restrictions on combining API data with other data in certain contexts. ([Google for Developers][1])

That creates an architectural question around the current classifier.

For example, the schema has:

```text
classifications.content_type
classifications.format
classifications.quality_score
content_concepts
content_embeddings
```

and those are being generated from YouTube content.

I would **not treat this as an established violation**, because the exact application of the policy depends on what is being inferred, displayed, stored and combined.

But I would treat it as a **pre-commercial compliance blocker**.

The clean question for Google/YouTube is:

> "May an API client use YouTube video metadata, together with its own semantic taxonomy/LLM/embedding system, to classify and rank videos for that authenticated user, and may those derived classifications be stored?"

That's precisely the sort of issue for which YouTube says developers can pursue an API Compliance Audit if unsure. ([Google for Developers][1])

---

# 5. The extension modifying YouTube itself creates another policy boundary

The product isn't just displaying API results.

It actively:

* hides cards
* reorders cards
* injects personal recommendations
* changes the visible feed

That's central to the product.

YouTube's policies say API services must add independent value and must not reproduce/replace YouTube's experience in prohibited ways. They also prohibit restricting/filtering access to YouTube content without user knowledge or consent. ([Google for Developers][1])

Your situation is materially better than an invisible third-party manipulation system because the user **explicitly installs the extension and defines the algorithm**.

But I'd make the consent model extremely explicit:

> "This extension changes the recommendations you see on YouTube according to the algorithm you configure."

And make sure it never:

* modifies playback
* blocks advertisements
* circumvents access controls
* changes YouTube metadata
* acts without the user's awareness

Those boundaries need to be tested and documented.

---

# 6. Your data has considerably more legal value/risk than a normal browser extension

The database is not merely storing "settings."

It stores or can derive:

* Google/YouTube OAuth credentials
* YouTube subscription data
* liked-video data
* viewed/opened/revisited/completed/skipped activity
* feedback
* inferred interests
* persistent taste affinities
* algorithm goals
* semantic embeddings
* content metadata

The schema explicitly contains `oauth_connections`, `activity_events`, `feedback_events`, `taste_profile_affinities`, `content_items.raw_metadata`, and semantic embeddings.

That is essentially a **behavioural profile**.

For a UK/EU-facing service, that puts privacy compliance firmly in the critical path.

The ICO's guidance treats profiling and behavioural analysis as significant privacy considerations, and a DPIA is especially relevant where technologies track behaviour, combine datasets or create detailed profiles. ([ICO][8])

I'd therefore regard a **DPIA before public launch as prudent**, even if counsel ultimately concludes one is not legally mandatory for the initial scope.

---

# 7. Sensitive-interest inference is a hidden risk

This one is easy to miss because you aren't explicitly asking:

> "What is this user's religion?"

But your product lets users say arbitrary things like:

```text
I want more:
- cancer research
- Catholic theology
- immigration policy
- transgender healthcare
- conservative politics
```

and it learns from behavioural signals.

UK GDPR can treat certain inferred information as special-category data where the processing involves inferring things like health, politics, religion, sexuality, ethnicity, etc. ([ICO][9])

You don't necessarily need to prohibit those topics.

But you should decide explicitly:

**Are you merely responding to an explicit user preference, or are you building a persistent inferred sensitive profile about the person?**

Those are materially different privacy propositions.

I'd design the product so that:

* explicit user preferences are clearly distinguishable from inferred traits
* sensitive categories aren't silently inferred and exposed as facts about the user
* retention is limited
* the user can inspect/delete/reset learned preferences
* data isn't repurposed for advertising

That also makes the product proposition stronger.

---

# 8. Chrome Web Store rules make "sell the data" a particularly bad business model

For this product, the obvious tempting alternative to subscriptions would be:

> "Give away MyAlgo and monetize the browsing/recommendation data."

I would take that off the table.

Chrome's current user-data rules impose strict purpose limitations on browsing/user data and prohibit using user browsing data for certain ad targeting/monetization practices. They also require a clear privacy policy and appropriate disclosures/consent. ([Chrome for Developers][10])

This is actually good for your business proposition:

### The natural revenue model is subscription, not surveillance.

That aligns nicely with:

> "We sell you control over your algorithm; we don't sell your behaviour."

That's a potentially meaningful differentiator.

---

# 9. Google's OAuth rules add another compliance surface

The current OAuth implementation is structurally sensible: the repo keeps the Google tokens server-side and encrypts them.

But once this is public, Google API user-data policies require clear disclosure of:

* what Google data is accessed
* why it is accessed
* how it is stored
* how it is shared
* what the user can do about it

and the privacy policy must be presented appropriately. ([Google for Developers][11])

You also need to handle:

* refresh-token expiry
* authorization revocation
* disconnect
* account deletion
* deletion of Google-derived data

YouTube's current policies impose particular retention/deletion constraints on API data, including limits around stored API data and deletion following user requests/revocation. ([Google for Developers][6])

This is one place where **"database deletion" isn't enough**. You need explicit retention rules for YouTube-derived data.

---

# 10. I see a data-governance problem in the current RLS model

This is from the repo itself.

Your user-owned information has RLS, which is good:

```text
profiles
algorithms
activity_events
feedback_events
taste_profile_affinities
feed_cache
oauth_connections
```

But several content/semantic tables are broadly readable to authenticated users, including:

```text
content_items
classifications
content_concepts
content_embeddings
concept_entries
concept_aliases
concept_relations
```

That's defensible for genuinely shared/public content infrastructure.

However, `content_items` contains `raw_metadata`, and the provenance/source model needs to be reviewed carefully to make sure you're not accidentally putting user-specific or user-derived information into what is effectively a shared corpus.

I would particularly audit:

**raw_metadata + source_kind + provenance + content embeddings**

before launch.

The principle should be:

> public YouTube content can be shared; private user behaviour and inferred preference must never leak into shared content records.

---

# 11. You don't currently appear to have a complete legal-operating layer

I couldn't find a privacy policy or terms document in the repo, and there is no implemented billing system.

More importantly, I did not see a complete user-data lifecycle covering:

```text
connect Google
      ↓
store token
      ↓
use YouTube data
      ↓
learn behaviour
      ↓
disconnect
      ↓
revoke OAuth
      ↓
delete account
      ↓
purge derived data
```

The current status document itself says production OAuth is still blocked, RLS isolation still needs production verification, and billing/launch hardening remain planned/partial.

That means I would **not charge real users yet**.

Not because the underlying idea is commercially unsound, but because taking money changes the standard you need to meet.

---

# 12. Subscriptions introduce a second legal regime

For a UK/EU consumer SaaS, subscription mechanics become their own compliance area.

UK consumer rules increasingly place requirements around:

* clear pre-contract information
* renewal
* reminder notices
* cancellation
* subscription terms
* digital-service cancellation rights

The UK Digital Markets, Competition and Consumers regime is particularly relevant for recurring digital subscriptions. ([Legislation.gov.uk][12])

You also need to handle:

* VAT
* customer-country tax rules
* payment processor fees
* failed payments
* refunds
* chargebacks
* invoices/receipts

UK digital services supplied to consumers can create VAT obligations, and EU consumer digital services can involve customer-country VAT/OSS rules. ([GOV.UK][13])

A payment provider can simplify some of this, but it doesn't automatically make the underlying business compliant.

---

# 13. There is a very important contractual/business risk: YouTube is a supplier you don't control

Imagine this scenario:

```text
MyAlgo paid subscribers
        ↓
MyAlgo
        ↓
YouTube API
        ↓
Google changes policy / quota / API access
```

The current YouTube terms explicitly allow YouTube to suspend/terminate API access and say developers must be prepared for the API to be modified or discontinued. They also contain broad indemnification provisions. ([Google for Developers][14])

This has a direct commercial implication:

> **Do not make a paid promise that fundamentally depends on permanent YouTube API availability.**

The product should remain conceptually useful even if its YouTube connector changes.

That is why your longer-term "personal algorithm layer" proposition is strategically stronger than "YouTube optimizer."

---

# 14. What I think the actual financial model should look like

Not as a definitive pricing decision, but as an economic structure, I would model MyAlgo like this:

### Free

Basic personal algorithm:

* limited algorithms
* basic filtering
* limited recommendation refresh
* local/basic controls

This gets users into the product without immediately generating significant API/AI expenditure.

### Paid

Charge for the **personal intelligence layer**, not simply "more YouTube."

Possible paid-value components include:

* persistent learned taste model
* semantic recommendations
* richer explanations
* calibration/learning controls
* more algorithms
* greater refresh frequency
* cross-platform personal profile
* advanced retrieval
* historical preference management
* portability/export

That makes the paid proposition:

> **You are paying for your personal recommendation infrastructure.**

rather than:

> **You are paying for a feature YouTube already provides for free.**

That distinction is important both commercially and from the YouTube policy perspective. ([Google for Developers][1])

---

# 15. The unit economics should be measured per active user

I would stop using:

> "$0–20/month at MVP"

as the main financial metric.

Instead measure:

```text
Infrastructure / MAU
+
YouTube retrieval cost/capacity / MAU
+
LLM classification / MAU
+
Embedding / MAU
+
Payment fees / paid user
+
Support / paid user
+
Tax / revenue
=
Contribution margin per subscriber
```

And particularly:

```text
candidate_count
LLM_calls
input_tokens
output_tokens
embedding_tokens
YouTube_search_calls
YouTube_video_calls
feed_generations
active_users
paid_users
```

Your existing recommendation observability work gives you a good foundation for this.

---

# 16. My risk register

| Risk                                      | Impact          | Why it matters                                                        |
| ----------------------------------------- | --------------- | --------------------------------------------------------------------- |
| YouTube API policy/access                 | **Very high**   | Your service depends on Google infrastructure and policy              |
| YouTube Search quota                      | **Very high**   | Can constrain user growth before compute costs do                     |
| YouTube "independent value"/charging rule | **Very high**   | Directly affects whether/how the YouTube feature can be monetized     |
| YouTube API data retention                | **Very high**   | Current architecture stores substantial API-derived data              |
| Privacy/profile compliance                | **Very high**   | You are effectively building behavioural profiles                     |
| OAuth/token security                      | **Very high**   | Compromise potentially exposes connected Google accounts/data         |
| RLS/data separation                       | **High**        | Shared content tables need careful provenance auditing                |
| Billing/tax/subscription compliance       | **High**        | Required once money is actually taken                                 |
| AI vendor dependency                      | **Medium-high** | Model retirement and price changes can affect production              |
| Infrastructure cost                       | **Medium**      | Manageable initially; scales with activity                            |
| Chrome Web Store compliance               | **High**        | Distribution is contingent on policy compliance                       |
| YouTube UI DOM fragility                  | **Medium**      | You depend on changing YouTube frontend structures                    |
| Sensitive-interest inference              | **High**        | Arbitrary topics + behavioural learning can create sensitive profiles |
| Vendor concentration                      | **High**        | Vercel + Supabase + Google + Anthropic/OpenAI                         |

---

# 17. The biggest strategic conclusion

The software is **not fundamentally an expensive product to run**.

The dangerous thing is something else:

> **You have a low-cost software architecture sitting on top of a high-dependency platform whose terms, quotas, data-retention rules and user experience you don't control.**

That means the business risk is currently more about **platform dependency and compliance than raw cloud expenditure**.

The strongest version of MyAlgo is therefore:

```text
Personal algorithm engine
        ↓
persistent user-owned preference model
        ↓
multiple content sources
        ↓
YouTube connector
        ↓
other platform connectors later
```

rather than:

```text
better YouTube feed
        ↓
subscription
```

The former gives you an asset that survives changes to one platform. The latter makes Google effectively part of your product contract with every paying customer.

### What I would put into the repo before taking payment

I would make the next commercial-readiness milestone explicitly cover **five things**: a YouTube API compliance review/audit, a formal data-retention/deletion design, privacy policy + terms + consent flows, production OAuth/RLS/security verification, and an actual billing/entitlement/tax design.

The good news is that the repo is already architected in a way that makes most of that work tractable. The status document's own remaining items are broadly pointing at the same launch boundary.

This is a product/compliance assessment rather than legal advice; for the YouTube-policy interpretation and UK/EU consumer/privacy implementation, I would have counsel review the final architecture and contractual language before taking payment.

[1]: https://developers.google.com/youtube/terms/developer-policies-guide?utm_source=chatgpt.com "Complying with YouTube's Developer Policies  |  Google for Developers"
[2]: https://vercel.com/pricing?utm_source=chatgpt.com "Vercel Pricing: Hobby, Pro, and Enterprise plans"
[3]: https://supabase.com/pricing?utm_source=chatgpt.com "Pricing & Fees | Supabase"
[4]: https://developers.openai.com/api/docs/models/text-embedding-3-small?utm_source=chatgpt.com "text-embedding-3-small Model | OpenAI API"
[5]: https://docs.anthropic.com/en/docs/about-claude/model-deprecations?utm_source=chatgpt.com "Model deprecations - Claude Platform Docs"
[6]: https://developers.google.com/youtube/terms/developer-policies?authuser=302792331&utm_source=chatgpt.com "YouTube API Services - Developer Policies  |  Google for Developers"
[7]: https://developers.google.com/youtube/v3/determine_quota_cost?utm_source=chatgpt.com "Quota Calculator  |  YouTube Data API  |  Google for Developers"
[8]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/?utm_source=chatgpt.com "Data protection impact assessments | ICO"
[9]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/?utm_source=chatgpt.com "What is special category data? | ICO"
[10]: https://developer.chrome.com/docs/webstore/user_data?utm_source=chatgpt.com "Updated Privacy Policy & Secure Handling Requirements  |  Chrome Web Store - Program Policies  |  Chrome for Developers"
[11]: https://developers.google.com/terms/api-services-user-data-policy?utm_source=chatgpt.com "Google API Services User Data Policy  |  Google for Developers"
[12]: https://www.legislation.gov.uk/ukpga/2024/13/notes/division/9/index.htm?utm_source=chatgpt.com "Digital Markets, Competition and Consumers Act 2024"
[13]: https://www.gov.uk/guidance/the-vat-rules-if-you-supply-digital-services-to-private-consumers?utm_source=chatgpt.com "VAT rules for supplies of digital services to consumers - GOV.UK"
[14]: https://developers.google.com/youtube/terms/api-services-terms-of-service?utm_source=chatgpt.com "YouTube API Services Terms of Service  |  Google for Developers"


Yes—but I would **change the goal** from “add more social networks” to **“make MyAlgo source-independent.”**

The repo is already pointing in that direction: its architecture calls for additional platform adapters eventually, while the core model is supposed to be a reusable personal recommendation layer. ([Bluesky][1])

## Why I would do it

Right now, YouTube is both:

1. your first product surface, and
2. a major dependency of the business.

YouTube explicitly says an API service must provide independent value, cannot simply recreate YouTube, and cannot charge for services YouTube offers free. Its policies also allow a service that combines YouTube content with content from other platforms as an example of independent value, provided the sources are clearly distinguished. ([Google for Developers][2])

So a product that becomes:

> **“One personal algorithm for content from YouTube, Reddit, Bluesky, etc.”**

is conceptually much less dependent on the proposition:

> “We make YouTube's feed better.”

It also gives you a better long-term product story:

```text
             MyAlgo
                │
       Personal Algorithm
                │
     ┌──────────┼──────────┐
     ↓          ↓          ↓
  YouTube     Bluesky    Other sources
     │          │          │
     └──────────┼──────────┘
                ↓
       one personal taste model
```

That's much closer to what the repository architecture is already trying to become.

## But don't immediately build five integrations

This is the important part.

**Adding platforms does not automatically reduce platform risk.** It can just replace one dependency with several.

For example:

| Platform            | Current situation                                                                                                                       | Implication                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| YouTube             | API is usable but heavily governed; Search has quota constraints and specific rules around independent value, data use and presentation | High dependency                                           |
| Reddit              | Commercial use requires Reddit's permission and a contract; API access is subject to current approval/use restrictions                  | Potentially high commercial friction ([Reddit Help][3])   |
| TikTok              | Display API requires developer approval and specific products/scopes; live integrations are reviewed                                    | Significant approval dependency ([TikTok Developers][4])  |
| Bluesky/AT Protocol | Public APIs and an explicitly open/composable ecosystem; designed for custom feeds and clients                                          | Much more structurally aligned with MyAlgo ([Bluesky][5]) |

That makes **Bluesky/AT Protocol particularly interesting as an architectural second source**, not necessarily because it is the biggest social network, but because the protocol itself is designed around interoperability, custom applications and custom feeds. ([Bluesky][5])

## I would therefore make the product evolution:

### Phase 1 — YouTube connector

Keep YouTube.

It is your real-world validation environment for the recommendation engine.

But treat:

```text
YouTube
```

as an **adapter**, not the product.

### Phase 2 — generic source model

This is the work I would do next in the repo.

Instead of designing things around:

```ts
youtube_video
youtube_channel
youtube_search
```

make the recommendation layer operate on concepts like:

```ts
ContentItem
Source
Publisher
Creator
Topic
Entity
Format
Language
PublishedAt
CanonicalUrl
Interaction
```

Then:

```text
YouTubeAdapter
BlueskyAdapter
RSSAdapter
RedditAdapter
...
```

all produce the same internal candidate contract.

This is probably more valuable than actually implementing another API immediately.

### Phase 3 — one second platform

I'd investigate **Bluesky/AT Protocol first**.

Its public positioning explicitly encourages third-party clients, custom feeds and applications, and the protocol is intended to let users move between applications. ([Bluesky][5])

That fits MyAlgo unusually well.

More importantly, it lets you test a crucial proposition:

> Can the *same personal algorithm* work over fundamentally different content structures?

YouTube is long-form video. Bluesky is short-form conversational/social content.

If the same semantic model can meaningfully rank both, you've demonstrated that **MyAlgo is the product**, rather than the YouTube extension.

## I would *not* use Reddit as the first escape hatch

Reddit is extremely interesting for MyAlgo conceptually, but its current commercial developer regime is a significant dependency: Reddit says commercial use of its developer tools requires permission, and monetized products/subscriptions are explicitly included. ([Reddit Help][3])

That means you could spend engineering time building the adapter and then still have a commercial-access negotiation before it becomes a reliable paid feature.

It is worth investigating later, but it isn't the cleanest second pillar.

## TikTok is similar

TikTok's current developer ecosystem requires approval for the relevant API products and scopes, and live integrations are reviewed. ([TikTok Developers][4])

So again, technically possible doesn't mean:

> “I can build this today and have a commercially dependable data source tomorrow.”

## The bigger opportunity is actually **social media + non-social sources**

I'd go one step further.

Your actual abstraction should probably be:

> **personal information algorithm**

rather than:

> **social-media algorithm**

Then your sources can eventually include:

```text
YouTube
Bluesky
RSS
blogs
news sites
podcasts
GitHub
research papers
newsletters
Reddit
TikTok
```

The user's algorithm becomes:

```text
"I want things that help me understand AI agents,
with technical depth, little hype, English,
long-form preferred, and no celebrity content."
```

That is a much more powerful object than:

```text
"YouTube preferences"
```

And it aligns extremely closely with the semantic architecture you've already built.

## There is an important YouTube-policy advantage

YouTube's own policy guide actually gives a multi-platform search engine as an example of an API service providing independent value: YouTube videos alongside videos from other platforms, with the distinction made clear. ([Google for Developers][2])

That doesn't mean "add Reddit and you're automatically compliant." It doesn't. You still have to comply with YouTube's API terms, attribution, data handling, presentation and other requirements.

But it strongly supports the **direction** of making MyAlgo a cross-source recommendation service rather than a YouTube clone.

## Financially, this also changes the proposition

Your revenue story becomes:

> **MyAlgo is the personal recommendation engine; platforms are data sources.**

So a paying customer isn't really paying for:

> "a better YouTube feed."

They're paying for:

> **a persistent personal information model that follows their interests across the places they consume information.**

That gives you more room to justify subscription revenue independently of any one platform.

And importantly, it means that if YouTube changes API access, quotas or policies, **one connector can degrade without destroying the entire paid product.**

## I would change the repo roadmap accordingly

I wouldn't create a giant backlog item saying:

> "Support Reddit, X, TikTok, Instagram, Bluesky..."

I'd create this sequence:

```text
1. Generalise ContentSource / ContentItem contracts
                  ↓
2. Separate Personal Algorithm from YouTube retrieval
                  ↓
3. Introduce SourceAdapter interface
                  ↓
4. Make ranking + embeddings source-agnostic
                  ↓
5. Add Bluesky/AT Protocol adapter
                  ↓
6. Test one algorithm across multiple sources
                  ↓
7. Evaluate Reddit/TikTok/etc. individually
```

The critical milestone is **#5 only after #1–4**.

Otherwise you'll have a "YouTube recommender + several API integrations." What you want is a **recommendation engine with connectors**.

### My recommendation on engineering allocation

I would **not pause the current YouTube work entirely**. Finish the production/security/compliance gates already identified in the repo, while doing the source-abstraction work underneath it.

A reasonable split for the next major chunk of engineering would be roughly:

**70%** production reliability, privacy/security, recommendation quality
**30%** source-agnostic architecture + one second-source prototype

That gives you a second platform without letting integrations derail the core product.

The particularly useful next step would be to turn the repo's existing `content_items`/candidate-generation architecture into a formal **`SourceAdapter` abstraction**, with YouTube as the first implementation and Bluesky as the second. That would materially reduce your YouTube lock-in without exploding the scope.

[1]: https://bsky.social/about/faq?utm_source=chatgpt.com "Company - Bluesky"
[2]: https://developers.google.com/youtube/terms/developer-policies-guide?utm_source=chatgpt.com "Complying with YouTube's Developer Policies  |  Google for Developers"
[3]: https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data?utm_source=chatgpt.com "Developer Platform & Accessing Reddit Data – Reddit Help"
[4]: https://developers.tiktok.com/docs/en/display-api-get-started?utm_source=chatgpt.com "Get Started | TikTok for Developers"
[5]: https://docs.bsky.app/showcase?utm_source=chatgpt.com "App integrations | Bluesky Protocol Services"
