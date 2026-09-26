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

Long YouTube sessions are treated as an infinite-scroll workload. Current safety bounds are a 1,500-item candidate reservoir, 800-item metadata cache, 2,000 retained selection events, 60 persisted trace summaries, and at most 320 candidates in a live scoring pass with at most 180 off-page replacement candidates.

DOM mutation ranking is coalesced, repeated native observations are persistence-coalesced for 30 seconds when metadata is unchanged, and watch-page enrichment runs two requests at a time in the extension worker. These limits are operational safeguards rather than recommendation semantics and should only be raised after measured rank latency, worker heap, renderer memory, and storage-serialization costs justify it.

Do not introduce another worker/thread merely to move an oversized workload. A dedicated scoring Web Worker is warranted only if profiling shows residual CPU saturation after working-set reduction, graph indexing, revision reuse, and incremental caching.


### Overlay latency budget

The UI overlay path is network-independent. Initial/native overlay rendering should begin after local candidate collection and deterministic scoring, not after RSS/search/watch-page enrichment. Metadata enrichment is background work and may refine a later generation.

Avoid rank starvation on mutation-heavy pages: a rank already in flight is allowed to complete through ordinary DOM churn, with at most one queued refresh afterward. This is preferred to repeatedly invalidating in-flight work until the page becomes quiet.
