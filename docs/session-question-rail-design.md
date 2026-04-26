# Session Question Rail Design

## Overview

This document captures the final design and implementation rationale for the TUI session question rail added to `packages/opencode/src/cli/cmd/tui/routes/session`.

The goal of the work was to add AI Studio-style question navigation to the session view without turning it into a second sidebar. User questions should be discoverable from the main transcript area, quickly clickable, visually lightweight, and safe to add without destabilizing the rest of the TUI session route.

The final implementation uses an overlaid marker rail tied to the main session scroll area. It derives question nodes from user messages, maps them onto scroll-track rows, highlights the active question while scrolling, shows a compact hover pill, and caps the number of visible markers to keep the UI readable.

---

## Product Goals

The feature was driven by five concrete product goals:

1. **Question navigation should feel attached to the main transcript** rather than occupying the existing sidebar region.
2. **Markers should be lightweight** so they do not compete with transcript content or existing side panels.
3. **Hover should reveal useful context** with a short question summary, but the default state should remain quiet.
4. **Clicking a marker should jump to the corresponding user message** using existing scroll mechanics instead of inventing a second positioning system.
5. **The implementation should be testable in small, pure units** so layout and scroll-state bugs can be isolated without relying entirely on live terminal interaction.

---

## Final UX Contract

The landed UX is intentionally minimal.

- The rail is rendered inside the session view, not inside the global sidebar.
- Question markers are shown as compact dots aligned to the right edge of the main scroll region.
- The currently active question is brighter than inactive ones.
- Hovering a marker shows a small pill with `Qn · <short title>`.
- Clicking a marker scrolls the transcript to the matching user message.
- The transcript width is no longer reduced to reserve a dedicated right-hand question panel.
- A fixed marker cap keeps dense sessions readable.

This is not a full scrollbar customization. It is an overlay that visually behaves like a question rail anchored to the scroll area.

---

## Why the Initial Sidebar-Like Approach Was Rejected

The first implementation direction rendered question navigation as a sibling panel beside the transcript. That version had two major issues:

1. **It consumed layout width like a second sidebar.**
   This contradicted the intended design direction, where the rail should feel embedded in the main scroll context.

2. **Hover preview behavior was unstable.**
   The panel updated larger hover content near the cursor and could visually flicker as layout shifted underneath pointer events.

The final design moved away from a separate column and toward an absolute-positioned overlay with a much smaller hover surface.

---

## Architecture Summary

The implementation is split into three layers:

### 1. Question extraction model
**File:** `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-model.ts`

This layer converts session messages plus text parts into a list of `QuestionNode` records:

- `messageID`
- `title`
- `preview`
- `footer`
- `created`

Responsibilities:
- include only user messages
- use the first non-synthetic, non-ignored text part
- normalize newlines into spaces
- truncate titles for compact display
- preserve message ordering

This helper is also reused by `dialog-timeline.tsx`, which removes duplicated extraction logic and keeps timeline + rail behavior consistent.

### 2. Scroll-state mapping
**File:** `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-state.ts`

This layer keeps rendering math and selection rules out of the main route.

It provides two pure helpers:

- `findActiveQuestion(...)`
  - determines which user question is currently active based on the transcript scroll position
- `buildQuestionMarks(...)`
  - projects question positions onto discrete marker rows for the visible rail height
  - deduplicates collisions by row
  - caps marker count by sampling long lists

This split makes it possible to test active-state and marker-density logic without running the whole TUI.

### 3. Presentational marker overlay
**File:** `packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx`

This component is intentionally narrow in scope.

Inputs:
- `nodes`
- `marks`
- `height`
- `activeMessageID`
- `onSelect(...)`

Responsibilities:
- render compact marker dots
- visually distinguish active and hovered markers
- keep hover state local via `createSignal`
- show a small hover pill anchored to the selected marker row
- delegate navigation to the parent route through `onSelect`

The component does not own transcript state, message extraction, or scroll position calculation.

---

## Session Route Integration

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

The session route owns integration with the real scrollbox and transcript layout.

### Core route memos
The route now derives:

- `nodes`
  - extracted from messages via `buildQuestionNodes(...)`
- `list`
  - current visible user-message positions from `scroll.getChildren()`
- `active`
  - current active message ID from `findActiveQuestion(...)`
- `railHeight`
  - effective vertical space available to markers
- `marks`
  - final capped marker rows from `buildQuestionMarks(...)`

### Click-to-jump behavior
Marker clicks reuse existing transcript navigation behavior:

1. find the render child whose `id` matches the selected message ID
2. call `scroll.scrollBy(child.y - scroll.y - 1)`

This preserves a single transcript position system.

### Overlay positioning
The route renders the rail as a positioned sibling inside the main session content container:

- the transcript remains the primary scrollbox
- the marker rail is overlaid with `position="relative"` / `position="absolute"` composition
- the old reserved rail width calculation was removed

That change was critical to stop the transcript from shrinking for a dedicated rail column.

---

## Marker Capping Strategy

A session can contain many user questions. Rendering all of them as markers can create a noisy or unreadable track.

The final implementation uses a fixed route-level cap:

- `RAIL_MAX = 12`

`buildQuestionMarks(...)` samples the question list when the total exceeds the cap. This preserves broad distribution across the session rather than simply truncating the first N questions.

The cap is deliberately fixed for now because:
- it solved the immediate readability problem
- it kept the surface area small
- it avoided adding user-facing configuration before the visual behavior was stable

Future work could make this configurable or adaptive to available rail height.

---

## First-Render Bug and Final Fix

One of the most important issues discovered during development was that markers could appear to be missing even when the feature was implemented correctly.

### Root cause
The route originally recomputed marker layout mostly from `scrollTop` changes.

That meant:
- if transcript children had rendered,
- but the user had not scrolled yet,
- then question positions might not be recomputed,
- so `marks()` could remain empty on first render.

To users, this looked like "the rail is broken" or "no markers are showing".

### Final fix
The route now keeps a separate layout tick:

- `const [tick, setTick] = createSignal(0)`

A polling loop watches both:
- `scroll.scrollTop`
- `scroll.getChildren().length`

When either layout-relevant signal changes, it bumps `tick`, which forces the marker-related memos to recompute.

This ensures that the rail becomes visible after transcript children first appear, even before the user manually scrolls.

---

## Hover Stability Strategy

Hover stability was treated as a real design constraint rather than a cosmetic detail.

### Problem
Large or shifting hover UI can create repeated mouse-entry churn in terminal UIs, especially when layout changes under the pointer.

### Mitigations in the final design
1. The hover UI is reduced to a small pill instead of a larger preview panel.
2. Hover state is local to the rail component.
3. The marker entry path uses `onMouseOver` only.
4. A redundant `onMouseMove` hover update path was explicitly removed.

This matches existing repo patterns in components like `dialog-select.tsx` and `prompt/autocomplete.tsx`, where synthetic pointer movement after layout changes is treated carefully.

---

## Testing Strategy

The feature was built with pure-function coverage first, then route-structure regression checks.

### Model tests
**File:** `packages/opencode/test/cli/tui/session/question-rail-model.test.ts`

Covers:
- extracting valid user questions
- skipping assistant messages
- skipping synthetic and ignored parts
- newline normalization
- title truncation
- ordering and timestamps

### State tests
**File:** `packages/opencode/test/cli/tui/session/question-rail-state.test.ts`

Covers:
- active question selection above scroll position
- fallback behavior when nothing is above the current viewport
- preserving the last visible question near the bottom
- returning fallback when position data is temporarily unavailable
- projecting question positions into marker rows
- row deduplication
- capped marker sampling

### Route structure tests
**Files:**
- `packages/opencode/test/cli/tui/session/session-route-order.test.ts`
- `packages/opencode/test/cli/tui/session/question-rail-layout.test.ts`
- `packages/opencode/test/cli/tui/session/question-rail-structure.test.ts`

These lock in critical integration guarantees:
- `scroll` is declared before active-state logic reads it
- `prompt` is declared before prompt effects read it
- transcript width is not reduced for a dedicated rail column
- marker layout recomputes from a layout tick, not only scroll movement
- hover entry does not rely on redundant mouse-move updates

### Live verification
Manual and scripted smoke verification was also used:
- `bun test test/cli/tui/session`
- `bun typecheck`
- TUI startup smoke in tmux with a simple prompt
- pane capture inspection to confirm markers appeared after the first-render tick fix

The repo does not currently provide a full automated terminal mouse-hover playback harness for this route, so the strongest automated coverage today is structural and pure-state oriented.

---

## Commit Structure

The implementation was split into focused commits rather than one large feature commit.

1. `refactor(session): extract question timeline node model`
2. `refactor(session): reuse question node model in timeline dialog`
3. `feat(session): add question rail marker state helpers`
4. `feat(session): add question rail marker overlay`
5. `feat(session): render capped question markers in session view`

This layout keeps extraction logic, state math, presentation, and route integration independently reviewable and revertible.

---

## Files Added or Updated

### Added
- `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-model.ts`
- `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-state.ts`
- `packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx`
- `packages/opencode/test/cli/tui/session/question-rail-model.test.ts`
- `packages/opencode/test/cli/tui/session/question-rail-state.test.ts`
- `packages/opencode/test/cli/tui/session/question-rail-structure.test.ts`
- `packages/opencode/test/cli/tui/session/question-rail-layout.test.ts`
- `packages/opencode/test/cli/tui/session/session-route-order.test.ts`

### Updated
- `packages/opencode/src/cli/cmd/tui/routes/session/dialog-timeline.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

---

## Design Tradeoffs

### Chosen: overlay markers
**Pros**
- preserves transcript width
- closer to the requested AI Studio feel
- avoids second-sidebar complexity

**Cons**
- not a true scrollbar-native customization
- requires careful absolute positioning and visual tuning

### Chosen: fixed marker cap
**Pros**
- simple
- predictable
- easy to test

**Cons**
- not adaptive per terminal size
- not user-configurable yet

### Chosen: pure-state helpers
**Pros**
- easier debugging
- stronger regression testing
- less logic hidden inside the route component

**Cons**
- adds small file count overhead

### Chosen: polling-based layout refresh
**Pros**
- works within current OpenTUI route constraints
- fixes first-render marker invisibility

**Cons**
- still polling-based rather than event-driven
- could be replaced later if the framework exposes a better callback surface

---

## Known Limitations

1. The rail is visually attached to the scroll area, but it is not yet a true custom scrollbar track implementation.
2. There is no user-facing setting for marker cap or marker visibility.
3. Hover behavior has strong regression coverage for structure, but not a fully automated terminal hover-event playback test.
4. The current marker visuals are intentionally minimal; further tuning may still improve readability against some themes.

---

## Recommended Future Improvements

1. **Make rail density adaptive**
   - derive max markers from available height instead of using only a fixed cap

2. **Move closer to true track rendering**
   - if OpenTUI exposes richer scrollbar hooks, render markers even closer to the actual scrollbar thumb/track

3. **Improve theme contrast tuning**
   - make inactive markers more consistently visible across dark and light themes

4. **Add stronger interaction harnesses**
   - build or adopt a TUI event test harness that can drive hover and click more directly than current structural tests

5. **Consider optional configurability**
   - expose marker cap or rail enablement through TUI config once the interaction model is considered stable

---

## Conclusion

The final session question rail design balances three concerns:

- **product fit**: markers behave like lightweight transcript navigation, not a second sidebar
- **implementation safety**: extraction, state, and route integration are isolated and tested separately
- **operational reliability**: first-render and hover-instability issues were debugged and fixed with narrow regressions

The result is a practical, reviewable first version of AI Studio-style question navigation for the OpenCode TUI session view, with clear room for future visual refinement.
