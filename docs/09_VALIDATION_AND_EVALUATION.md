# Validation & Evaluation

## Product validation

The first question is not whether the model is sophisticated.

It is:

> Do users find an editable explanation of their feed useful enough to return to?

## Core metrics

### Bootstrap

- history items collected
- usable metadata rate
- concept extraction rate
- initial graph size
- time to first graph

### Feed

- observed candidates
- eligible candidates
- graph-matching candidates
- replacement candidates
- empty-feed rate
- native card replacement success

### Trust

- explanation open rate
- graph edit rate
- corrections per session
- undo/reset rate
- “why” → action conversion

### Retention

- D1/D7/D14 active use
- repeated graph editing
- mode use
- return after correction

### Quality

- precision of graph matches
- false-positive rate
- per-node usefulness
- diversity
- novelty
- suppression correctness

## Evaluation strategy

Use three levels:

1. unit tests for graph/scoring invariants
2. offline replay of stored candidate/evidence batches
3. real-user validation

Do not use an overall recommendation score as the only quality metric.

## Critical invariant

For every explanation:

```text
displayed contributions == scorer contributions
```

The trace must be reproducible from the graph revision, deterministic evidence revision, candidate identity, scorer revision, and policy revision. Replaying the same inputs must reproduce the score and trace identity.

## Counterfactual evaluation

Compare:

```text
baseline graph
vs
edited graph
```

on the same stored candidate set.

This avoids conflating graph changes with candidate-pool changes.
