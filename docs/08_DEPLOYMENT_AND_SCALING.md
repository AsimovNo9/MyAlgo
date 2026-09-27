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


## Semantic inference performance envelope

Semantic inference is not part of overlay first paint.

PR #213 live-test bounds:
- at most 64 objective/topic/concept graph nodes are embedded for a semantic pass;
- at most the existing 320-candidate live ranking working set participates;
- persistent embedding cache: 600 records;
- persistent graph/mode candidate similarity cache: 600 records;
- cache identity includes model/version/input hash, graph revision, and mode where appropriate.

The dependency-free hash embedding baseline runs locally and is primarily an integration/fallback benchmark. A compact neural encoder must be benchmarked against it for first-run latency, cached latency, memory, extension/package impact, multilingual quality, and long-session stability before becoming the default provider.

The current hash baseline is cheap enough to validate the complete browser-local pipeline, but it is not the target semantic-quality model. PR #213 now routes embedding generation through the shared offscreen document into a dedicated semantic Worker, with a deterministic in-process hash fallback only when the offscreen path is unavailable. The scorer/service worker consumes cached semantic values and never runs the embedding workload on first paint.

PR #213 now packages Transformers.js/ONNX execution code plus the pinned q8 `mixedbread-ai/mxbai-embed-xsmall-v1` model into the extension artifact at build time. Neural inference runs in a sandboxed extension page because ONNX Runtime's WebGPU bootstrap requires a blob-backed module that normal MV3 extension pages cannot execute. Runtime remote-model loading is disabled; the installed extension resolves only packaged model/runtime assets. If WebGPU/model loading/inference is unavailable, scoring falls back to the deterministic hash provider rather than blocking the feed.

The production build contains the local ONNX JavaScript/WASM runtime plus the pinned quantized model/tokenizer/configuration assets. There is no runtime model-host or CDN executable-code dependency. Model readiness is surfaced separately from ranking. Full local-data deletion clears MyAlgo's derived semantic caches; packaged model/runtime files are immutable extension assets removed only when the extension itself is removed or replaced.
