# YouTube API Compliance

> **Status: pre-launch compliance gate.**

MyAlgo's launch architecture intentionally does not use YouTube API Data to derive the Personal Algorithm Graph.

## Launch rule

```text
YouTube Data API
  → account facts / display only

Browser-observed YouTube
  → graph evidence

User input
  → graph input
```

The implementation must enforce this boundary.

## Why

The YouTube Developer Policies and API Terms impose requirements concerning API Data, storage, privacy, user control, security, and derived data.

The current product design therefore avoids making API Data part of the graph-learning pipeline rather than assuming that local storage alone creates an exemption.

## Important interpretation

The architecture should not state:

> “Local processing automatically makes API-derived graph data compliant.”

It does not.

The safer product rule is:

> **Do not use YouTube API Data as graph-derivation input for the launch product.**

If the product later needs API-derived analytics, semantic profiles, metrics, or other derived structures, stop and perform a fresh policy review before implementation.

## Caching

Do not design an indefinite raw YouTube API response cache.

If API Data is used, storage and refresh behavior must be purpose-specific and consistent with current YouTube policies.

## Quota

Quota growth is a separate concern from graph derivation.

Do not assume that staying local removes quota requirements.

## Audit / permission path

The 2026 policy materials describe additional policy treatment for certain audited analytics/derived-metric use cases. MyAlgo must not assume that this path applies to its particular product without confirmation.

If MyAlgo changes the launch boundary and begins deriving graph data from API Data, obtain confirmation through the applicable YouTube process before shipping that design.

## Credentials

Never collect or store the user's YouTube password.

OAuth credentials/tokens are handled only through the supported authorization flow.

## Sources

Maintain links to the current official YouTube:

- API Services Terms of Service
- Developer Policies
- API policy revision history

These documents are living policy documents and must be rechecked before launch.
