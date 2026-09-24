# Recommendation / Personal Algorithm Engine

## Objective

The engine does not attempt to reproduce YouTube's proprietary recommender.

It creates an interpretable **surrogate personal model** from observable user evidence and applies that model to candidates visible to the connector.

## Pipeline

```text
Observe
  ↓
Normalize evidence
  ↓
Infer/update graph
  ↓
Extract content evidence
  ↓
Match content to graph
  ↓
Apply hard policies
  ↓
Additive scoring
  ↓
Explain
  ↓
Enforce
```

## Bootstrap

The first technical spike is **watch-history DOM extraction**.

Questions that must be answered before graph UX work is considered complete:

- Can history be enumerated reliably?
- Does pagination/infinite scrolling expose sufficient history?
- What fields are available?
- How many items can be collected in a realistic session?
- Can timestamps be associated reliably?
- What happens with unavailable/deleted items?
- Is the resulting dataset semantically rich enough to seed useful concepts?

The API is not used to seed the graph.

### Home recommendation context

The Home page is a second P0 observation stream. Store visible recommendation
cards as `surfaced` context with position and section metadata. Do not infer that
the user likes a topic merely because YouTube showed it. Correlate a surfaced
item with a later click or rendered-history match to produce an observable
sequence:

```text
surfaced → clicked → watched
```

Repeatedly surfaced but unobserved items are a future avoidance/negative-signal
research question, not an automatic P0 preference update.

## Content understanding

Prefer a layered approach:

1. deterministic metadata extraction
2. transcript/text enrichment where legitimately available
3. embeddings/semantic matching when justified
4. vision analysis for measured visual gaps
5. LLM disambiguation only where deterministic methods are insufficient

No model is allowed to silently become the user's preference model.

## Additive scoring

Example:

```text
base                           0.00
Elden Ring match              +0.82
RPG match                     +0.34
Build Guides match            +0.51
recent negative feedback      -0.20
------------------------------------
final                          1.47
```

These contributions are native model terms.

## Feedback

Feedback should update graph evidence or bounded preference state.

Examples:

- More like this → strengthen relevant path.
- Less like this → weaken relevant path.
- Mute → hard suppression.
- Forget → remove selected evidence/relationship.

Do not let a single click rewrite the entire graph.

## Candidate coverage

Track separately:

```text
observed candidates
→ candidates with usable evidence
→ graph-matching candidates
→ eligible candidates
→ visible candidates
→ replacement candidates
```

A classification improvement cannot compensate for an empty candidate pool.

## Counterfactual replay

Store enough recent candidate/evidence state to replay:

```text
current graph → current result
hypothetical graph → simulated result
```

This is local computation whenever possible.

## Modes

Modes modify policy/weights over one graph.

They should not fork the underlying evidence graph.
