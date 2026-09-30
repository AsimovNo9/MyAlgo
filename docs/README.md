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

- YouTube Data API: no launch runtime integration; future optional use defaults to account/display-only pending a fresh review.
- Browser-observed YouTube pages: graph evidence.
- User actions/preferences: graph evidence or direct graph edits.
- Personal Algorithm Graph: derived from browser-observed and user-provided inputs.
- Cloud AI/backend processing: deferred for the local-first MVP.

This separation is a compliance design decision, not merely an implementation detail.

## Current implementation status

The evidence → graph → deterministic scoring → extension-local runtime foundation is implemented. The semantic/runtime sequence through PR #230 is merged: evidence-backed concept materialization, canonical semantic neighbourhoods, durable inferred modes, graph-grounded mode scoring, mode-aware retrieval/supply, stable source→replacement bindings, bounded warm-path ranking, and measured post-canonical score calibration.

PR #229 found no top-end display-score saturation that justified retuning the existing deterministic mapping. It also corrected effective replacement-threshold diagnostics and validated prepared candidate-context reuse across large Home reranks.

PR #230 completed the first #153 trust slice: scored native and replacement cards share one exact trace-grounded explanation renderer with matched symbolic graph paths, evidence support counts, stable trace/graph revision identity, and acquisition provenance kept separate from preference evidence.

The active implementation task is **#170 graphical graph exploration**: add a read-only interactive Settings graph with pan/zoom, search, node/edge focus, stable durable-mode overlays, current/pasted snapshots, provenance/evidence drill-down, and revision inspection. The same renderer will be reused by the next #153 compact Why-this graph slice. #153 remains open for direct graph actions and tighter Why-this → graph/evidence navigation.

#211 remains open only for long-session/browser stress validation and measured follow-up; it is not the primary architecture task. #214's runtime/documentation work is complete.

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
- [Replay & Semantic Evaluation](13_REPLAY_AND_SEMANTIC_EVALUATION.md)
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

Changing an embedding model, classifier, transcript parser, or vision model must not silently rebuild or invalidate the user's graph. Embeddings are rebuildable derived enrichment rather than canonical graph state. They may support semantic neighbourhoods, retrieval expansion, candidate matching, clustering, and explanation paths, while symbolic graph provenance and deterministic traces remain authoritative. Optional local generative explanation synthesis must stay grounded in those structured paths and traces. Explicit schema/model migrations are allowed and must be versioned. See #209.
