# Personal Algorithm V2 Future Roadmap

**Status:** Future roadmap after the current recommender and production-readiness milestones
**Authority:** Planning document only. Current implementation status remains in [STATUS.md](STATUS.md), current recommender requirements remain in [RECOMMENDER.md](RECOMMENDER.md), and compliance/viability analysis remains in [Compliance_and_Viability.md](Compliance_and_Viability.md).

## 1. V2 direction

V2 evolves Personal Algorithm from a YouTube-focused feed controller into a user-owned recommendation layer with multiple content connectors, durable preference controls, and explicit privacy/compliance boundaries.

The product promise becomes:

> Your preferences, your controls, your portable recommendation layer.

YouTube remains the first connector, not the permanent product boundary. No V2 work should weaken explicit exclusions, hide learned behavior from the user, or make the system dependent on one provider's undocumented DOM or quota behavior.

## 2. Entry criteria

V2 begins only after the current milestone has evidence for:

- production OAuth and YouTube sync;
- encrypted token persistence and refresh;
- RLS isolation with multiple users;
- authenticated feed/rank quality baselines;
- embedding configuration and bounded backfill verification;
- real extension testing on Home, Search, Subscriptions, Shorts, navigation, and infinite scroll;
- documented YouTube API, Chrome Web Store, privacy, and data-retention review;
- a tested account deletion and provider-disconnect path.

## 3. V2 workstreams

### V2.1 Trustworthy extension experience

Deliver the issues in [EXTENSION_UX_PATHWAY.md](EXTENSION_UX_PATHWAY.md), in this order:

1. Render-generation coordination, stale cache/error repair, and request cancellation.
2. Native-compatible card geometry and ID deduplication.
3. DOM fixture, navigation, Shorts, and infinite-scroll regression coverage.
4. Larger bounded Personal Picks shelf with append/recycle behavior.
5. Goal-aware editor, weight sliders, calibration, learning explanations, and reset controls.
6. Accessibility and visual regression contract from issue #136.

Success measures:

- zero duplicate injected IDs in fixture and production telemetry;
- no stale response overwrites a newer mode/filter state;
- no layout shift caused by injected cards;
- keyboard and reduced-motion checks pass;
- user can explain, reset, or disable learned taste.

### V2.2 Portable personal profile

Separate the profile into explicit preferences, short-term signals, durable affinities, and derived semantic context.

Capabilities:

- export/import a user-readable preference profile;
- reset individual facets or the complete learned profile;
- distinguish explicit sensitive interests from inferred affinities;
- apply retention windows and deletion propagation;
- support connector-specific signals without exposing raw provider events;
- maintain a profile revision and audit history without storing unnecessary raw content.

The profile must remain useful if a connector is disabled.

### V2.3 Connector abstraction

Create a connector contract for YouTube and future sources:

```text
Connector
  authenticate()
  disconnect()
  fetchCandidates(profile, budget)
  fetchMetadata(ids, budget)
  mapProvenance()
  deleteUserData()
```

All connectors feed the same normalized candidate contract, but provider-specific terms, quotas, retention, and deletion rules remain isolated. A connector may fail without making the shared feed disappear.

### V2.4 Cost and quota control

Move from infrastructure cost estimates to measured unit economics:

```text
active user
  -> syncs
  -> candidates
  -> provider calls
  -> LLM calls/tokens
  -> embedding tokens
  -> storage/read volume
  -> support and payment cost
```

Add per-tenant budgets, provider circuit breakers, shared retrieval reuse, cache hit metrics, and graceful degradation. Do not increase Search or LLM budgets until qualified-candidate and relevance metrics justify the cost.

### V2.5 Compliance-ready commercial layer

Before charging users:

- complete YouTube API policy interpretation and audit preparation;
- publish privacy policy, terms, data deletion, and provider-disconnect flows;
- complete a DPIA or documented legal review for behavioral profiling;
- define sensitive-interest handling and retention;
- implement billing entitlements, cancellation, refunds, taxes, and failed-payment handling;
- keep advertising and behavioral-data resale explicitly out of scope;
- document vendor model lifecycle, pricing, and outage fallback.

## 4. Prioritization rules

1. Trust and hard constraints before growth features.
2. Measurement before larger retrieval or model budgets.
3. User-owned profile portability before cross-platform breadth.
4. Policy and deletion guarantees before monetization.
5. Connector interfaces before platform-specific optimization.
6. Managed infrastructure until measured scale proves a new boundary necessary.

## 5. V2 acceptance bar

V2 is ready for broader public expansion when:

- one connector can be disabled without data leakage or feed failure;
- users can inspect, reset, export, and delete durable preference state;
- provider-derived data has explicit retention and deletion behavior;
- extension UI passes DOM, accessibility, visual, and lifecycle regression suites;
- production quality, quota, latency, and cost metrics are collected by release;
- compliance review accepts the connector, profiling, and commercial model;
- no marketing or billing claim depends on permanent access to YouTube APIs.
