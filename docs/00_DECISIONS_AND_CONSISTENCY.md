# MyAlgo — Decisions & Consistency Baseline

This document is the source of truth for cross-document decisions.

## 1. Product identity

MyAlgo is a **Personal Algorithm Editor**, not a generic recommendation feed.

The durable product object is the user's **Personal Algorithm Graph**.

## 2. Graph, not tree

The underlying representation is a graph.

A single concept may connect to several downstream concepts, content types, creators, formats, and evidence sources. The UI may render a path/subgraph as a tree when explaining one item.

## 3. Exact scoring

MyAlgo's own ranking model is additive by construction:

```text
final score = base score + Σ contribution
```

Every displayed contribution must correspond to an actual term in MyAlgo's scoring function.

Do not present post-hoc explainability such as SHAP values as though they were the native score decomposition.

## 4. Evidence versus model

Evidence is observed input.

The graph is durable user state.

Foundation-model outputs are evidence/features with provenance; they are not the Personal Algorithm Graph itself.

## 5. YouTube API boundary

For the initial launch:

```text
YouTube Data API → account facts/display only
Browser observation → graph evidence
User input → graph input
```

The graph must not be constructed from YouTube API Data.

This is an intentional compliance boundary. It is not a claim that browser-observed YouTube data is automatically unrestricted; that remains subject to applicable terms, privacy requirements, and legal review.

## 6. Local-first

MVP learning and graph storage should remain local where technically practical.

No cloud enrichment is required for validation.

Cloud processing is a separate future product/data-handling decision.

## 7. Deletion semantics

These actions are distinct:

- **Disable**: stop using a node.
- **Reduce**: lower its contribution.
- **Mute**: suppress matching content.
- **Delete/forget**: remove the selected graph/evidence relationship.

Deleted evidence must not immediately recreate the same node from the same retained evidence.

## 8. Modes

Modes are configurations over one underlying graph.

```text
One Personal Algorithm Graph
        ↓
Work / Learning / Relax / ...
        ↓
different weights and policies
```

Modes do not create unrelated user models.

## 9. Candidate coverage

Understanding candidates is not the same as generating candidates.

The system must measure candidate coverage independently from classification quality.

## 10. Status language

Use:

- Implemented
- Verified locally
- Verified in production
- Planned
- Deferred
- Blocked

Never describe a planned architecture as an implemented feature.
