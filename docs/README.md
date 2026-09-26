# MyAlgo

> **MyAlgo discovers an interpretable model of your personal feed, shows why content matches it, and lets you edit that model.**

MyAlgo is a browser extension + lightweight dashboard for building a user-controlled **Personal Algorithm Graph** from observable YouTube activity.

The graph is not YouTube's proprietary recommendation algorithm. It is MyAlgo's own interpretable model of the user's observed recommendation environment.

## Core loop

```text
Browser-observed YouTube activity
        ↓
Evidence
        ↓
Personal Algorithm Graph
        ↓
Transparent additive scoring
        ↓
Native-feed transformation
        ↓
Why am I seeing this?
        ↓
Edit / reduce / mute / prefer / forget
        ↓
Learn
```

## Current launch boundary

The initial launch deliberately keeps the **YouTube Data API out of the graph-learning pipeline**.

- YouTube Data API: account facts/display only.
- Browser-observed YouTube pages: graph evidence.
- User actions/preferences: graph evidence or direct graph edits.
- Personal Algorithm Graph: derived from browser-observed and user-provided inputs.
- Cloud AI/backend processing: deferred for the local-first MVP.

This separation is a compliance design decision, not merely an implementation detail.

## MVP product

The first product validates five things:

1. MyAlgo can obtain useful evidence from the user's rendered YouTube history/feed.
2. That evidence can become an understandable graph.
3. The graph can produce exact, additive score contributions.
4. The extension can apply those decisions to the native YouTube feed.
5. Users understand and act on the **Why am I seeing this?** explanation.

## Documentation

- [Product & Strategy](01_PRODUCT_AND_STRATEGY.md)
- [Architecture & Domain Model](02_ARCHITECTURE_AND_DOMAIN_MODEL.md)
- [Recommendation / Graph Engine](03_RECOMMENDATION_ENGINE_PLAN.md)
- [Open Source & Ecosystem](04_OPEN_SOURCE_AND_ECOSYSTEM.md)
- [Business & Monetization](05_BUSINESS_MOAT_AND_MONETIZATION.md)
- [Roadmap & Execution](06_ROADMAP_AND_EXECUTION.md)
- [Data Governance & Provider Policy](07_DATA_GOVERNANCE_AND_PROVIDER_POLICY.md)
- [Deployment & Scaling](08_DEPLOYMENT_AND_SCALING.md)
- [Validation & Evaluation](09_VALIDATION_AND_EVALUATION.md)
- [GitHub Issues](10_GITHUB_ISSUES.md)
- [Consistency Audit](11_TWO_PASS_CONSISTENCY_AUDIT.md)
- [YouTube API Compliance](compliance/YOUTUBE_API.md)
- [Chrome Web Store / Privacy](compliance/CHROME_WEB_STORE.md)
- [Privacy Policy](../PRIVACY.md)
- [Data Flow](compliance/DATA_FLOW.md)
- [Launch Checklist](compliance/LAUNCH_CHECKLIST.md)

## Important distinction

Foundation models understand **content**.

The Personal Algorithm Graph models the **user**.

Changing an embedding model, classifier, transcript parser, or vision model must not silently rebuild or invalidate the user's graph. Explicit schema/model migrations are allowed and must be versioned.
