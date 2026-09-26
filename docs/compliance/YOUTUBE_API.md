# YouTube API Compliance

> **Status: repository/runtime audit implemented for #168.**
>
> **Policy review date:** 2026-09-26
>
> The current launch runtime contains **no YouTube Data API integration**. The boundary is therefore stronger than “display-only”: browser-observed YouTube pages provide Personal Algorithm evidence, while YouTube Data API data is absent from the launch evidence/graph/scoring path.

## Launch rule

```text
Current launch runtime
──────────────────────
YouTube Data API
  X  no endpoint/client/OAuth integration in the extension runtime

Browser-observed YouTube page/player/user action
  → normalized evidence
  → Personal Algorithm Graph
  → deterministic score/trace

Future optional YouTube Data API use
  → account facts / display only by default
  X  graph derivation / scoring / traces / explanations
     unless a new policy/product/privacy review explicitly approves a changed design
```

This document records the implementation audit for #168. It is not permission to add API-derived recommendation inputs later.

## Repository audit findings

The 2026-09-26 audit of `main` found:

| Surface | Finding | Classification |
|---|---|---|
| YouTube Data API endpoints | No `youtube.googleapis.com`, `googleapis.com/youtube/v3`, or equivalent endpoint use in launch source | absent |
| Google/YouTube API client libraries | No `googleapis`, `google-auth-library`, or YouTube API client dependency/import in launch source | absent |
| OAuth scopes | No YouTube OAuth scope strings in launch source | absent |
| OAuth/token storage | No YouTube access-token/refresh-token path in launch source | absent |
| API keys/client secrets | No YouTube API key or Google OAuth client-secret path in launch source | absent |
| API response cache/store | No YouTube Data API response store exists in the launch runtime | absent |
| API downstream consumers | No API-derived evidence, graph, scorer, trace, or explanation consumer exists | absent |
| Server/backend API-ranked runtime | No server/backend application exists in the current repository tree | absent from current launch tree |
| Browser page metadata fetch | The content script may fetch the canonical `youtube.com/watch?v=...` page with same-origin credentials to enrich page-observed metadata | browser/page path, not YouTube Data API |
| Connector capability flags | `search`, `subscriptions`, and `userContent` flags describe provider/page capabilities; they do not instantiate a Data API client | local connector metadata |
| Legacy retrieval vocabulary | Shared/recommender types still contain names such as `youtube_subscription`, `youtube_search`, and `youtube_liked`; code search finds no network/API implementation behind them | legacy planning vocabulary; follow-up cleanup |

The extension imports the local recommender-core package for deterministic scoring, but the launch package contains no YouTube API network/auth implementation.

## Enforced boundary

CI runs `scripts/audit-youtube-api-boundary.mjs` against:

- `apps/extension/src`;
- `packages/recommender-core/src`;
- `packages/shared-types/src`;
- the built extension artifact when present.

The audit fails if launch source/artifact introduces:

- YouTube Data API hosts/paths;
- YouTube OAuth scopes;
- access/refresh token identifiers;
- Google API/auth client imports;
- YouTube API key / Google OAuth client credential identifiers;
- common YouTube Data API resource-list calls.

The extension manifest test separately asserts that launch permissions do not include Chrome `identity` / `identity.email` and that no `oauth2` manifest block exists.

These checks are guardrails, not a substitute for review. A deliberate future API integration must update the tests, this document, privacy/data-flow documentation, and the relevant provider-policy review before shipping.

## Why this boundary exists

The YouTube API Services Developer Policies impose specific requirements for API Data, including storage/refresh/delete behavior. As of the policy review date:

- most Authorized Data outside listed statistics must be deleted or refreshed within 30 days;
- limited Non-Authorized Data may only be temporarily stored and must be deleted or refreshed within 30 days;
- stored API Data must be kept reasonably consistent with current API data;
- API clients that access/use user data need a deletion mechanism;
- the general policy prohibits using API Data to create new/derived data or metrics unless an applicable audited allowance applies.

The policy revision history also records 2026 additions for certain audited analytics/derived-metric and statistical-data use cases. MyAlgo does **not** assume those allowances apply to the Personal Algorithm product.

The launch design therefore avoids making API Data an input to the Personal Algorithm rather than assuming local processing creates an exemption.

## Caching / retention

Because the current launch runtime does not use YouTube Data API Data, it has no API-data cache/refresh schedule.

If API use is introduced later, the implementation must define, before collection:

- whether data is Authorized or Non-Authorized Data;
- exact purpose and downstream consumers;
- cache key and retention duration;
- refresh/deletion behavior required by current policy;
- user revocation/deletion behavior;
- display attribution/currentness requirements;
- quota and audit implications.

Do not build an indefinite raw YouTube API response cache.

## Credentials and authorization

The current launch runtime has no YouTube OAuth flow and no YouTube API credentials.

Future API authorization, if added, must:

- use supported Google/YouTube authorization flows;
- never collect/store a user's YouTube password;
- request only scopes required for the reviewed purpose;
- secure credentials/tokens appropriately;
- honor revocation/deletion requirements;
- remain isolated from graph/scoring inputs unless a separately approved architecture changes this boundary.

## Distinguishing page observation from API Data

MyAlgo currently derives evidence from the YouTube browser experience itself:

- rendered Home/History cards;
- temporal HTML media playback;
- user selections and explicit feedback;
- same-origin YouTube watch-page metadata enrichment.

That browser-observed evidence is governed by the project's privacy/product rules and applicable platform/legal requirements, but it is not being represented here as YouTube Data API Data.

This distinction must remain explicit in code, provenance, documentation, and user-facing explanations.

## Legacy vocabulary

The repository still contains legacy/future retrieval abstractions such as:

- `youtube_subscription`;
- `youtube_search`;
- `youtube_liked`;
- generic retrieval coordinator lanes.

The audit found no YouTube Data API implementation behind those labels. They should not be interpreted as current API integrations. Their naming is nevertheless ambiguous enough to warrant cleanup in a separate follow-up rather than silently treating them as launch architecture.

## Mandatory re-review triggers

Reopen this audit before shipping any change that adds or changes:

- a YouTube Data API endpoint or client library;
- YouTube/Google OAuth scopes or token handling;
- YouTube API credentials;
- an API Data cache/store;
- API-derived metadata entering normalized evidence;
- API-derived data entering graph construction, scoring, traces, explanations, evaluation, or personalization;
- server/cloud processing of YouTube API Data;
- derived metrics based on API Data;
- a change in the purpose for which existing API Data is used.

## Official sources reviewed

Reviewed 2026-09-26:

- YouTube API Services Terms of Service: https://developers.google.com/youtube/terms/api-services-terms-of-service
- YouTube API Services Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Complying with YouTube's Developer Policies: https://developers.google.com/youtube/terms/developer-policies-guide
- Required Minimum Functionality: https://developers.google.com/youtube/terms/required-minimum-functionality
- Terms / policy revision history: https://developers.google.com/youtube/terms/revision-history

These are living policy documents. Recheck them before launch and whenever a re-review trigger occurs.
