# Extension and Local Feed UX Pathway

**Status date:** 2026-09-20
**Purpose:** Turn the current YouTube extension and dashboard into a stable, readable, non-disruptive personal feed experience.

This document records the UX concerns observed in the supplied screenshots and maps them to the existing implementation. It is a companion to [RECOMMENDER.md](RECOMMENDER.md): the recommender decides eligibility and ranking; this pathway defines how those results should be presented and tested.

## Evidence

The supplied screenshots show three related surfaces:

1. YouTube with the Personal Algorithm popup open and Learning mode active.
2. A calibration surface with large repeated cards and positive/negative feedback controls.
3. The algorithm editor with a goal field, topic chips, numeric weights, and rule controls.

The screenshots are evidence for this pathway, but image files were not available in the workspace to embed directly. When exported, place them in `docs/assets/extension-ux/` and add them here as:

```md
![YouTube extension and Learning mode](assets/extension-ux/youtube-learning.png)
![Taste calibration](assets/extension-ux/taste-calibration.png)
![Algorithm editor](assets/extension-ux/algorithm-editor.png)
```

## Current status

### Already working or substantially implemented

- YouTube DOM extraction for Home, Search, Subscriptions, Shorts, and navigation fixtures.
- Extension popup, options page, background worker, content script, local feed cache, source filters, and mode switching.
- Candidate retrieval, classification, hard exclusions, feedback, persistent learned affinities, semantic retrieval, and ranked feed generation.
- A personal-picks shelf and replacement cards can be injected into YouTube.
- Approved semantic explanations and matched/discovery/explore lanes exist in the feed contract.

### Known UX and reliability gaps

- Native and injected cards do not yet share a robust, tested sizing/layout contract.
- Duplicate video IDs can be collected, ranked, or rendered through multiple DOM paths.
- Infinite scroll and client-side navigation need a deliberate render coordinator rather than repeated independent triggers.
- The extension can retain stale feed errors while a newer cache is usable.
- Filter changes can race with ranking and replacement renders, especially when Shorts visibility changes the replacement target set.
- The personal shelf is small and not visually integrated with the active YouTube layout.
- The popup is functional but dense and not a strong status/control surface.
- The algorithm editor needs a clearer goal-to-ranking explanation and slider-based weight editing.
- The calibration view needs a stable card grid, fewer repeated visual treatments, and clearer progress/state handling.
- Persistent learning exists technically, but the user-facing product does not clearly explain what is learned, how it affects ranking, or how to reset it.
- The current DOM fixtures are useful but do not yet cover render idempotence, duplicate cards, infinite scroll, filter races, or replacement-card geometry.

## Product decisions

### 1. Preserve YouTube geometry

The extension should adapt to the active YouTube surface instead of imposing a new page layout. Every injected card must use a stable `data-personal-algorithm-*` marker, inherit the native grid/list track, and reserve a fixed media ratio before image load.

Required invariants:

- No injected card changes the parent grid's column count.
- Thumbnail aspect ratio is always `16 / 9` for horizontal cards and `9 / 16` only for Shorts surfaces.
- Titles are clamped to two lines; channels and reasons are clamped to one or two lines.
- Card width comes from the native parent track; the extension does not set an arbitrary desktop width.
- A replacement card occupies the same target slot and is removed before the next render.
- Popup and in-page status overlays never cover native controls.

### 2. Deduplicate before ranking and rendering

Use the YouTube video ID as the only identity key. Deduplicate at three boundaries:

1. Candidate extraction: merge selector and anchor results by ID.
2. Feed assembly: preserve the first candidate while merging provenance/source metadata.
3. DOM rendering: never render a replacement or shelf card if its ID is already present in the current native candidate set or injected set.

Add diagnostics counters for extracted, deduplicated, ranked, rendered, replaced, and skipped-duplicate cards. Do not log titles or IDs in production telemetry.

### 3. One render coordinator

Navigation, mutation, filter, mode, and feed-cache events should enqueue one render generation. A render generation must:

1. Snapshot current native cards.
2. Cancel/ignore previous ranking responses.
3. Fetch or read the selected feed.
4. Apply visibility/order/badges.
5. Remove old replacements and shelves.
6. Insert replacements using the current target list.
7. Record the generation as complete.

A stale response must never clear a newer render or reinsert cards using an old Shorts/filter state.

### 4. Bigger algorithm feed without a disruptive wall

The algorithm shelf should grow from the current small set into a bounded “Personal picks” stream:

- Initial render: 6 cards maximum.
- On scroll proximity: append the next 6 cached candidates.
- Never fetch from a page mutation; append only from the server cache or a completed sync.
- Keep a maximum of 18 injected cards in the DOM at once and recycle older cards.
- Deduplicate against native cards and prior shelf cards.
- Preserve native YouTube spacing and use a single shelf heading per page generation.

This gives the user more algorithm content while keeping YouTube recognizable and avoiding a visually disruptive second feed.

## UI pathways

### A. YouTube extension popup

**Primary job:** status, mode, source controls, and recovery.

Required structure:

- Connection/status row: signed in, extension active/paused, last refresh time.
- Mode selector: compact segmented control for Work/Learning/Relax/custom algorithms.
- Source controls: subscribed-only, discovery, Shorts, live.
- Feed summary: cached count, matched/discovery/explore counts, last sync result.
- Recovery action: `Refresh feed` with an explicit loading/success/error state.
- Error handling: clear stale error after any successful feed fetch; show retryable failures separately from last-known-good cache.
- Link to options: `Tune algorithm`.

### B. YouTube in-page presentation

**Primary job:** unobtrusively rank and replace.

- Small, dismissible status indicator rather than a persistent large overlay.
- Native-card badges only when useful; avoid adding a badge to every visible card by default.
- Personal shelf inserted once per page generation.
- Replacement cards match native media ratio, typography scale, spacing, and hover behavior.
- Explanation appears on the personal shelf/card detail, not as repeated long text over every native card.

### C. Local dashboard / algorithm editor

**Goal usage:** The goal must be operational, not decorative. It should be used in query planning, format inference, semantic terms, and explanation text. Add a compact “goal is influencing retrieval” state with the generated query lanes visible in a debug/details drawer.

**Topic weights:** Use sliders or steppers for each selected topic, with:

- Range 0–100.
- Visible numeric value.
- Keyboard adjustment.
- Add/remove topic controls.
- Optional normalization mode that distributes 100 points across selected topics.
- A clear distinction between topic weight and hard rules.
- No silent renormalization when a user manually edits a value; offer an explicit `Distribute weights` action.

**Calibration:**

- Stable card dimensions and fixed media ratio.
- One clear positive and negative action per card.
- Progress indicator that does not shift the grid.
- Avoid showing the same video twice in a calibration session.
- Explain that feedback updates learned taste, while explicit topics and exclusions remain authoritative.
- Add `Reset learned taste` and `Review learned signals` controls.

## Persistent learning: current answer

Yes, persistent learning now exists in the backend through `taste_profile_affinities`. It stores bounded topic/channel/format/language/source affinities, evidence counts, timestamps, source signals, and profile revisions. The rebuild endpoint can recompute it from historical activity and feedback, and feed/profile readers can consume the aggregate profile without exposing raw events.

What remains:

- Production migration and historical-data verification.
- User-facing explanation of learned changes.
- Reset/rebuild UI.
- Tests proving a historical signal outside the current 50-item feed changes ranking.
- Guardrails and decay tuning based on production baselines.

## Testing pathway

### DOM fixture matrix

Expand `youtube-fixtures.ts` and content-script tests for:

- Home grid, compact list, Search list, Subscriptions grid.
- Shorts shelf with mixed horizontal/native cards.
- Client-side navigation without reload.
- Infinite-scroll append and removal.
- Duplicate selector matches for one video ID.
- Existing personal shelf/replacement markers.
- Cards with missing title, channel, thumbnail, or link metadata.
- Narrow desktop, wide desktop, and mobile-width layouts.

### Behavioral tests

- Repeated mutation events produce one render generation.
- A stale ranking response cannot overwrite a newer mode/filter response.
- Toggling Hide Shorts does not remove or resurrect unrelated cards.
- A successful feed response clears the stale error state.
- Replacement cards never duplicate native or shelf IDs.
- A larger shelf appends six at a time and caps active injected cards.
- Feed cache survives popup close/reopen and extension service-worker restart.
- Mode switching changes order and explanation without a page reload.
- Goal changes affect query plans and are visible in the debug/details surface.
- Weight changes affect ranking while never-show rules remain hard exclusions.
- Learned preferences affect a historical candidate but cannot override explicit exclusions.

### Manual production demo script

1. Sign in to the production dashboard and select Learning.
2. Confirm the dashboard feed shows synced/classified counts and explanations.
3. Open YouTube Home and reload the extension once.
4. Confirm popup mode, cache count, source mix, and last refresh state.
5. Toggle Hide Shorts and verify only Shorts behavior changes.
6. Navigate Home -> Search -> Subscriptions without a full reload.
7. Scroll until the personal shelf appends another batch.
8. Switch Learning -> Work and confirm ordering/explanations change.
9. Give one positive and one negative calibration signal.
10. Refresh the feed and confirm the last-error state clears after success.
11. Return to the dashboard and confirm the learned profile summary changes without exposing raw activity.
12. Capture aggregate metrics only: visible count, lane counts, source counts, diversity, topic coverage, replacement count, and errors.

## Delivery phases

### Phase 1: stabilize presentation

- Deduplication and render-generation coordinator.
- Stable native-compatible card geometry.
- Stale error/cache state repair.
- Shorts/filter race tests.

### Phase 2: build the larger personal feed

- Bounded shelf append/recycle behavior.
- Larger cached candidate window.
- Native/shelf duplicate suppression.
- Source/lane summary in popup.

### Phase 3: improve algorithm editing

- Goal usage indicator and query-plan details.
- Weight sliders/steppers and explicit normalization action.
- Calibration grid and reset learned taste controls.

### Phase 4: production validation

- Complete the five release-gate issues.
- Run authenticated baseline collection.
- Test real YouTube surfaces and extension lifecycle.
- Tune weights, lane ratios, and learning decay from evidence.

## Proposed implementation issue sequence

1. [#125](https://github.com/AsimovNo9/MyAlgo/issues/125) Render-generation coordinator and stale-cache/error-state recovery.
2. [#126](https://github.com/AsimovNo9/MyAlgo/issues/126) Native-compatible card geometry and duplicate suppression.
3. [#127](https://github.com/AsimovNo9/MyAlgo/issues/127) Shorts/filter/navigation/infinite-scroll DOM fixture expansion.
4. [#128](https://github.com/AsimovNo9/MyAlgo/issues/128) Larger personal-picks shelf with bounded append/recycle.
5. [#129](https://github.com/AsimovNo9/MyAlgo/issues/129) Goal-aware algorithm editor and query-plan visibility.
6. [#130](https://github.com/AsimovNo9/MyAlgo/issues/130) Topic weight sliders, explicit normalization, and rule separation.
7. [#131](https://github.com/AsimovNo9/MyAlgo/issues/131) Calibration UX, learning explanation, reset/rebuild controls.
8. [#132](https://github.com/AsimovNo9/MyAlgo/issues/132) Authenticated baseline and real-browser production demo.

Each issue should remain independently testable and must not weaken hard exclusions or trigger retrieval from DOM mutations.
