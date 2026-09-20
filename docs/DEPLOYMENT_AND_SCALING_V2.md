# Deployment and Scaling V2 - Personal Algorithm

**Status:** Future operations plan after the current production-readiness milestone
**Depends on:** [FUTURE_ROADMAP_V2.md](FUTURE_ROADMAP_V2.md), [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md), [Compliance_and_Viability.md](Compliance_and_Viability.md)

The current [DEPLOYMENT_AND_SCALING.md](../DEPLOYMENT_AND_SCALING.md) remains the MVP deployment reference. This document defines the future operating model and must not be treated as implemented.

## 1. V2 operating principles

- Commercial traffic requires commercial service tiers, not hobby-tier assumptions.
- Every provider call has a budget, timeout, retry policy, circuit breaker, and aggregate metric.
- Production deploys are immutable, reversible, and migration-aware.
- User data, shared catalog data, and provider credentials have separate retention and access policies.
- Capacity planning uses active-user units, not only infrastructure invoices.
- No queue, cache, worker, or regional split is added without a measured bottleneck.

## 2. Environments

### Local

- Local Supabase and deterministic provider fixtures.
- Synthetic OAuth and connector mocks.
- No production secrets or production user data.

### Preview

- Per-PR deployment with isolated or scrubbed data.
- Migration dry-run and schema compatibility checks.
- DOM screenshot/fixture tests for extension changes.

### Production

- Vercel production deployment from a protected release tag.
- Supabase production project with backups and RLS verification.
- Provider secrets in the deployment secret store only.
- Separate monitoring, quota, and incident alerts.

### Disaster recovery

- Document restore point objectives and restore time objectives.
- Test database restore and key rotation periodically.
- Preserve migration history and release artifact references.
- Maintain a connector-specific deletion/recovery runbook.

## 3. Release pipeline V2

```text
Pull request
  -> unit/type/schema tests
  -> extension build and DOM fixtures
  -> accessibility/visual regression
  -> preview deployment
  -> migration dry run
  -> approval
  -> signed release tag
  -> production deployment
  -> smoke checks
  -> rollback decision window
```

Required release gates:

- web and extension tests;
- typecheck and production build;
- schema/migration checks;
- dependency and secret scanning;
- authenticated `/api/feed` and `/api/rank` smoke checks;
- provider configuration preflight;
- extension lifecycle smoke test;
- aggregate baseline comparison;
- explicit migration rollback or forward-fix plan.

## 4. Service evolution thresholds

### Stage A: current MVP / early users

Keep Vercel, Supabase, managed pgvector, bounded Search, RSS, and serverless sync. Use the shared pool aggressively. Do not add Redis or queues solely for architectural completeness.

### Stage B: measured traction

Introduce only when metrics show need:

- Redis/read cache for hot feed reads;
- background jobs for classification, embedding, and metadata enrichment;
- quota ledger and per-user/provider budgets;
- asynchronous sync progress and retry state;
- structured event/metric pipeline.

### Stage C: multi-connector platform

Separate connector workers from profile/ranking APIs. Each connector receives an explicit budget and emits normalized candidates. Shared enrichment and ranking remain connector-neutral.

### Stage D: high-scale platform

Consider read replicas, regional data placement, dedicated ingestion workers, partitioned event storage, and platform-specific compliance operations only after measured load, retention, or availability requirements justify them.

## 5. Capacity and cost model

Track per active user:

```text
syncs per day
candidate count
Search calls
metadata calls
RSS calls
classification calls and tokens
embedding tokens
feed reads
storage volume
cache hit rate
latency percentiles
provider failures
```

Track per paid user:

```text
subscription revenue
payment fees
AI/provider cost
infrastructure cost
support cost
refund/chargeback cost
contribution margin
```

A release must not increase retrieval or model budgets until qualified-candidate rate, relevance, latency, and contribution margin remain within explicit bounds.

## 6. Quota and provider controls

- Shared Search quota is treated as a finite project budget, not a per-user entitlement.
- RSS and shared catalog sources are preferred for recurring coverage.
- Provider calls are deduplicated across users where policy permits.
- Quota exhaustion degrades to cached/shared/vector/concept retrieval.
- Model retirement requires a pinned supported model, fallback model, cost ceiling, and regression comparison.
- Connector policies define what may be cached, derived, displayed, and deleted.

## 7. Observability

Minimum V2 dashboards:

- feed generation latency p50/p95/p99;
- sync duration and stage timings;
- candidate coverage by interest;
- qualified-candidate and false-positive rates;
- Search/metadata/RSS/vector quota usage;
- LLM and embedding calls/tokens/cost;
- extension render generations, stale-response drops, duplicate skips, and replacement success;
- OAuth failures, token refresh failures, connector revocations;
- deletion/disconnect completion and backlog;
- deployment, migration, and rollback events.

Logs must be structured and privacy-safe. Do not log raw tokens, prompts, full provider payloads, user activity events, or content identifiers unless a documented incident workflow requires a short-lived protected trace.

## 8. Security, privacy, and compliance operations

Before commercial V2 launch:

- complete the compliance/legal review described in `Compliance_and_Viability.md`;
- complete a DPIA or documented equivalent for behavioral profiling;
- publish privacy, terms, deletion, disconnect, and support workflows;
- test RLS with multiple users;
- test account deletion and derived-data purge;
- define retention schedules for provider metadata, raw activity, affinities, embeddings, and caches;
- document subprocessor/vendor and model lifecycle;
- verify Chrome Web Store and provider policy requirements.

## 9. Rollback and incident response

Every production release must identify:

- application commit and database migration range;
- provider/model versions;
- feature flags or budget changes;
- rollback command or forward-fix plan;
- owner and alert channel;
- user-facing degradation message.

For provider policy, quota, or data-retention incidents, disable the affected connector or derived feature first. Preserve the user’s explicit preferences and cached safe feed while the incident is investigated.
