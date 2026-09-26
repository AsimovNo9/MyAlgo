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

Do not present post-hoc explainability such as SHAP values as though they were the native score decomposition. The #151 trace is the native additive decomposition: base + node + edge + feedback + mode + suppression terms.

## 4. Evidence versus model

Evidence is observed input.

The graph is durable user state.

Foundation-model outputs are evidence/features with provenance; they are not the Personal Algorithm Graph itself.

Keep three concepts distinct:

```text
content model → content features/evidence → Personal Algorithm Graph → recommendation policy
```

A content model describes or represents content. The Personal Algorithm Graph is the durable user model. Recommendation policy/scoring decides how graph state and explicit policy inputs affect a candidate. A model output must not silently become a user preference or graph relationship.

Use **training** only for changing model parameters from a training dataset. Use **personalization** for updating user-specific evidence, graph state, or preference state. An explicit action such as `not_interested` is personalization/feedback, not model training. The local scorer consumes these signals without updating model weights.

## 5. YouTube API boundary

For the initial launch:

```text
YouTube Data API → account facts/display only
Browser observation → graph evidence
User input → graph input
```

The graph must not be constructed from YouTube API Data.

For live YouTube playback, `watched` is derived from temporal HTML media
playback evidence rather than requiring a visit to the rendered History page.
History remains a separate bootstrap/fallback source with its own provenance.
The rendered History UI does not expose a stable watched-at timestamp to the
collector, so History evidence uses the video ID as its stable content-level
identity and retains DOM card order as relative recency (position 0 is the
newest observed card). Repeated scans update that evidence rather than creating
new watch events from collector observation time. This intentionally does not
claim event-level replay counts from the History DOM.
A watch session accumulates actual media-time deltas while playback is active;
pause, buffering, advertising, and seek jumps do not count toward the threshold.

This is an intentional compliance boundary. It is not a claim that browser-observed YouTube data is automatically unrestricted; that remains subject to applicable terms, privacy requirements, and legal review.

### P0 browser-signal semantics

P0 observes distinct browser signals and must not conflate them:

```text
Temporal player playback  → watched evidence       → primary live behavioral input
History observation       → watched evidence       → bootstrap/fallback input
Home recommendation       → surfaced observation  → contextual input
Explicit user feedback    → explicit evidence     → highest-confidence input
```

`watched` is behavioral evidence and can support initial graph inference.
`surfaced` means only that YouTube displayed an item; it must not, by itself,
raise preference weight or imply user interest. The system may correlate a
surfaced item with a later click or watched observation without claiming
knowledge of YouTube's private ranking logic.

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

## 9a. Explicit feedback in the local runtime

Explicit feedback is a first-class local scoring input, separate from inferred preference.

For MVP YouTube feedback:

- feedback events are persisted locally in the extension event store;
- repeated feedback for the same content item is reconciled to the latest effective event before scoring;
- more_like_this contributes +10;
- not_interested contributes -10;
- never_show_channel contributes -100 and resolves to the persisted creator node when the content-to-creator relationship is available;
- feedback is applied as an additive scoring contribution, not as a claim about YouTube's internal recommendation system.

PR #195 validated the end-to-end not_interested path in a real browser: a Home-feed action for kDqb9IzhxjE persisted as local feedback and was subsequently consumed by the local scorer, producing a trace score of -9 from a +1 candidate contribution plus -10 feedback.

Undo/reversal semantics are intentionally outside the #195 MVP acceptance boundary and require an explicit event/state design before implementation.

## 10. Status language

Use:

- Implemented
- Verified locally
- Verified in production
- Planned
- Deferred
- Blocked

Never describe a planned architecture as an implemented feature.
