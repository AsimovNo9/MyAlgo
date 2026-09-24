# Two-Pass Documentation Consistency Audit

## Pass 1 — Product logic

The documentation must agree that:

- MyAlgo is a Personal Algorithm Editor.
- The Personal Algorithm Graph is the durable user model.
- The graph is a graph, not a strict tree.
- Scoring is additive and intrinsically explainable.
- Foundation models provide content evidence.
- The YouTube API is display/account-facts-only at launch.
- Browser observation supplies graph evidence.
- MVP is local-first.
- Watch-history extraction is the first technical spike.
- Modes operate over one graph.
- Counterfactuals replay stored candidates.

## Pass 2 — Execution ordering

The dependency order is:

```text
history extraction
      ↓
live-feed observation
      ↓
local evidence/graph
      ↓
scoring
      ↓
feed enforcement
      ↓
Why / trace
      ↓
editing
      ↓
counterfactuals
      ↓
enrichment
      ↓
sync/cloud/productization
      ↓
additional connectors
```

Any document that places cloud AI, multi-platform support, or API-derived graph bootstrap before the history/graph validation phase is stale.

## Known legacy concepts to remove

The following are no longer launch assumptions:

- API-derived graph bootstrap
- likes/subscriptions as graph-learning inputs
- server-side recommendation generation as MVP foundation
- permanent raw YouTube API content cache
- “MyAlgo reproduces YouTube's algorithm”
- separate graph per mode
- LLM as the primary ranking/explanation authority

## Terminology audit

Use **Personal Algorithm Graph** consistently.

Use **evidence** for observed/model-generated support.

Use **content understanding** for foundation-model processing.

Use **user model** for the graph.

Use **trace** for the exact scoring path.

Use **counterfactual replay** for hypothetical graph evaluation.

## Status audit

Every implementation claim must distinguish:

- implemented
- locally verified
- production verified
- planned
- deferred
- blocked

The architecture documents describe the intended next architecture; they must not be interpreted as evidence that the current code already implements it.
