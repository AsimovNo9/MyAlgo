# Product & Strategy

## Product thesis

Recommendation systems are usually opaque and difficult for users to inspect.

MyAlgo's product thesis is:

> Give the user an interpretable model of their personal recommendation environment and let them edit it.

The immediate user experience is therefore not another feed. It is:

**observe → explain → edit → apply → learn**

## Target experience

For a video already appearing in YouTube:

```text
◎ Why am I seeing this?

Gaming
  → RPG
    → Elden Ring
      → Build Guides

Match: 87

Your algorithm:
Elden Ring       +0.82
RPG              +0.34
Build Guides     +0.51

[Reduce Elden Ring]
[Mute Build Guides]
[Keep]
```

The explanation describes **MyAlgo's model**, not YouTube's internal ranking process.

## Core product capabilities

### 1. Personal Algorithm Graph

Nodes can represent:

- interests
- sub-interests
- entities
- content types
- formats
- creators/channels
- user preferences
- negative preferences

Edges represent interpretable relationships.

### 2. Evidence

Evidence can come from:

- rendered watch-history items
- rendered feed candidates
- user interactions
- explicit user edits

Each evidence item should retain provenance and timestamps.

### 3. Graph editing

Users can:

- toggle nodes
- increase/reduce preference
- mute
- delete/forget evidence
- delete a path
- create a node
- create a relationship

### 4. Feed enforcement

MyAlgo applies graph decisions to the native YouTube UI.

Rejected native cards may be hidden or replaced with MyAlgo-selected candidates where sufficient candidates exist.

Replacement must never imply that MyAlgo controls YouTube's underlying recommendation system.

### 5. Counterfactuals

A later feature should answer:

> “What would this recent feed have looked like if I turned this node off?”

Use locally stored recent candidates and a hypothetical graph version. Do not make new provider requests merely to show a counterfactual.

## MVP audience

Do not optimize for everyone.

The first validation audience should be people who already experience a concrete problem with algorithmic feeds and are willing to actively inspect or edit their recommendation experience.

The product should be validated with real usage rather than assumed demand.

## Product risks

1. History DOM cannot provide enough bootstrap evidence.
2. Users do not understand the graph.
3. Explanations are technically correct but not useful.
4. Candidate coverage is too narrow.
5. Native YouTube DOM changes break enforcement.
6. Compliance constraints prevent intended data flows.
7. Users value filtering but not model editing.
8. Users like the concept but do not retain or pay.

## Validation before expansion

Do not add multiple platforms until one connector demonstrates:

- repeat use
- meaningful corrections
- acceptable feed coverage
- understandable explanations
- low empty-feed rate
- evidence that users want persistent control
