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
