# Deployment & Scaling

## MVP deployment principle

Keep the learning loop local.

A cloud service is not required for the first validation milestone.

## Components

### Extension

Owns:

- observation
- local evidence
- graph runtime
- deterministic scoring
- trace UI
- feed enforcement

### Dashboard

Owns:

- graph visualization
- editing
- settings
- export/reset controls

### Optional backend

Not required for the initial graph-learning experiment.

If introduced later, it must have an explicit data contract and privacy boundary.

## Performance

Ranking must never perform a synchronous expensive model call per scroll item.

Use:

- local deterministic scoring
- cached evidence
- asynchronous enrichment
- bounded candidate batches

## Scaling path

```text
Local-only
   ↓
optional managed sync
   ↓
optional cloud enrichment
   ↓
shared infrastructure only when usage proves need
```

Do not introduce queues, workers, Redis, or microservices solely because they are conventional.

## Extension package size

Do not bundle large foundation models initially.

Heavy models belong behind an optional inference boundary.

## Local inference later

A local model service is a separate project involving:

- installer/runtime
- OS permissions
- native messaging or local IPC
- model distribution
- updates
- resource constraints

Treat it as a later privacy mode, not an MVP assumption.


## Browser performance envelope

Long YouTube sessions are treated as an infinite-scroll workload. Current safety bounds are an 800-item candidate reservoir, 500-item metadata cache, 750 retained selection/watch events, 2,000 unique History evidence items, 300 retained Home exposures, 3,000 default Personal Algorithm evidence records, 60 persisted trace summaries, and at most 320 candidates in a live scoring pass with at most 180 off-page replacement candidates.

DOM mutation ranking is coalesced, repeated native observations are persistence-coalesced for 30 seconds when metadata is unchanged, and watch-page enrichment runs two requests at a time in the extension worker. These limits are operational safeguards rather than recommendation semantics and should only be raised after measured rank latency, worker heap, renderer memory, and storage-serialization costs justify it.

Do not introduce another worker/thread merely to move an oversized workload. Search is an exception because large YouTube result-page parsing was measured to interfere with rank/UI responsiveness; production search is therefore isolated in an MV3 offscreen document with a dedicated Worker. A separate scoring Worker is still warranted only if profiling shows residual CPU saturation after working-set reduction, graph indexing, revision reuse, and incremental caching.


### Overlay latency budget

The UI overlay path is network-independent. Initial/native overlay rendering should begin after local candidate collection and deterministic scoring, not after RSS/search/watch-page enrichment. Metadata enrichment is background work and may refine a later generation.

Avoid rank starvation on mutation-heavy pages: a rank already in flight is allowed to complete through ordinary DOM churn, with at most one queued refresh afterward. This is preferred to repeatedly invalidating in-flight work until the page becomes quiet.


### Local retention budgets

The extension deliberately retains bounded local working history rather than treating the user's browser as an unlimited event warehouse.

Current safety budgets:
- candidate reservoir: 800;
- enriched video metadata cache: 500;
- History evidence: 2,000 unique videos;
- one History observation processes at most 500 rendered items;
- Home recommendation observations: 300 retained exposures;
- selection/watch event buffer: 750;
- default Personal Algorithm evidence: 3,000 records;
- feed cache: 80;
- live ranking working set: 320, including at most 180 off-page replacement candidates.

Home exposure evidence is reconciled to the retained 300-observation window rather than accumulating every historical feed impression indefinitely. Evidence compaction removes the oldest default-retention records, expired records, unsupported inferred edges/creator nodes, and unreferenced auto-created content nodes while preserving indefinite/user-supported graph data.
