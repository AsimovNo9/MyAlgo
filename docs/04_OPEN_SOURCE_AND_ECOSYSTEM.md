# Open Source & Ecosystem

## Core principle

The most valuable interface to stabilize is the **Personal Algorithm Graph schema and connector boundary**, not a particular foundation model.

Potential future ecosystem layers:

- connector SDK
- graph schema
- evidence/provenance format
- scoring contract
- explanation contract
- import/export format

## What should remain replaceable

- embedding provider
- LLM provider
- vision model
- transcript provider
- database implementation
- hosting provider

## Open-source timing

Do not open-source the entire product merely because individual components are open-source-friendly.

First validate:

- user demand
- graph usefulness
- connector stability
- willingness to pay
- privacy expectations
- contribution surface

A future open-source connector/graph SDK can coexist with a hosted product.

## Portability

Users should be able to inspect and eventually export their graph.

Portability is a trust feature and reduces lock-in concerns.

## Connector model

```text
Personal Algorithm Core
        │
        ├── YouTube connector
        ├── future connector
        └── user-created connector
```

Each connector should implement a narrow interface rather than duplicate graph logic.
