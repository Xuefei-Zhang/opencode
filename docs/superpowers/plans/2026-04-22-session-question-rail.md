# Session Question Rail Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI Studio-style question navigation rail to the TUI session view so users can hover a node to see a question summary and click it to jump to that question in the message timeline.

**Architecture:** Keep the existing main session `<scrollbox>` intact and add a sibling rail inside `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`. Derive rail nodes from existing user messages using the same extraction rules as `DialogTimeline`, but move that extraction into a pure helper so it can be unit tested independently from the TUI. The rail owns hover/active state and delegates jumps to the existing `message.id -> scroll child -> scrollBy()` mechanism already used by timeline and message navigation.

**Tech Stack:** SolidJS, @opentui/solid, @opentui/core `ScrollBoxRenderable`, existing opencode TUI route/session components, Bun test.

---

## File Structure

### Existing files to modify
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
  - Add rail layout slot next to the main message scrollbox.
  - Wire derived question nodes, hover state, active node tracking, and click-to-jump behavior.
- `packages/opencode/src/cli/cmd/tui/routes/session/dialog-timeline.tsx`
  - Reuse a shared extraction helper instead of duplicating message-to-title logic.
- `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`
  - Reference only if layout spacing/constants need to be mirrored; do not change unless the implementation needs consistent panel sizing behavior.
- `packages/plugin/src/tui.ts`
  - Only touch if you decide to expose the rail as a plugin slot in this same implementation. This is explicitly optional and should not block the core rail.

### New files to create
- `packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx`
  - Focused presentational component for the vertical node rail, hover summary, click handlers, and active styling.
- `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-model.ts`
  - Pure helper(s) for extracting user-question nodes from session messages and parts.
- `packages/opencode/test/cli/tui/session/question-rail-model.test.ts`
  - Unit tests for question extraction and summary truncation rules.

### Optional new test file if component logic becomes non-trivial
- `packages/opencode/test/cli/tui/session/question-rail-state.test.ts`
  - Only add if active-node calculation becomes a standalone pure helper worth testing.

---

## Chunk 1: Extract a testable question-node model

### Task 1: Create a pure helper for question-node extraction

**Files:**
- Create: `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-model.ts`
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/dialog-timeline.tsx`
- Test: `packages/opencode/test/cli/tui/session/question-rail-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/cli/tui/session/question-rail-model.test.ts` that covers at least these behaviors:

```ts
import { describe, expect, test } from "bun:test"
import { buildQuestionNodes } from "../../../../src/cli/cmd/tui/routes/session/question-rail-model"

describe("buildQuestionNodes", () => {
  test("extracts user messages with first valid text part", () => {
    const result = buildQuestionNodes({
      messages: [
        { id: "u1", role: "user", time: { created: 1 } },
        { id: "a1", role: "assistant", time: { created: 2 } },
      ] as any,
      parts: {
        u1: [
          { type: "text", text: "How do I fix this?", synthetic: false, ignored: false },
        ],
      } as any,
    })

    expect(result).toEqual([
      expect.objectContaining({
        messageID: "u1",
        title: "How do I fix this?",
      }),
    ])
  })
})
```

Add cases for:
- skipping assistant messages
- skipping synthetic/ignored text parts
- replacing newlines in summaries
- truncating overly long summaries to a bounded width
- preserving created timestamp ordering required by the session timeline

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --cwd packages/opencode test test/cli/tui/session/question-rail-model.test.ts`
Expected: FAIL because `buildQuestionNodes` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create a helper with a narrow surface, for example:

```ts
import type { Message, TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"

export type QuestionNode = {
  messageID: string
  title: string
  preview: string
  footer: string
  created: number
}

export function buildQuestionNodes(input: {
  messages: Array<{ id: string; role: string; time: { created: number } }>
  parts: Record<string, Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }>>
  max?: number
}): QuestionNode[] {
  const max = input.max ?? 48
  const result: QuestionNode[] = []

  for (const message of input.messages) {
    if (message.role !== "user") continue
    const part = input.parts[message.id]?.find(
      (item) => item.type === "text" && !item.synthetic && !item.ignored && item.text,
    )
    if (!part?.text) continue

    const text = part.text.replace(/\s*\n\s*/g, " ").trim()
    if (!text) continue

    const preview = text.length > max ? text.slice(0, max - 1) + "…" : text
    result.push({
      messageID: message.id,
      title: preview,
      preview: text,
      footer: Locale.time(message.time.created),
      created: message.time.created,
    })
  }

  return result
}
```

Do not over-generalize. Keep it specific to the session question rail + timeline use case.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --cwd packages/opencode test test/cli/tui/session/question-rail-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-point timeline to shared extraction**

Update `dialog-timeline.tsx` so it uses `buildQuestionNodes(...)` instead of duplicating extraction logic. Keep the current UX (reverse order, same select behavior).

- [ ] **Step 6: Run focused regression tests**

Run:
- `bun --cwd packages/opencode test test/cli/tui/session/question-rail-model.test.ts`
- `bun --cwd packages/opencode run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/routes/session/question-rail-model.ts \
  packages/opencode/src/cli/cmd/tui/routes/session/dialog-timeline.tsx \
  packages/opencode/test/cli/tui/session/question-rail-model.test.ts
git commit -m "feat(tui): extract session question rail model"
```

---

## Chunk 2: Add the rail UI beside the session scrollbox

### Task 2: Create a focused question-rail component

**Files:**
- Create: `packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Test: `packages/opencode/test/cli/tui/session/question-rail-model.test.ts`

- [ ] **Step 1: Add one failing expectation for active/hover presentation inputs**

If you keep rail state pure enough, add one small test around state shaping (not rendering). Example: verify that a selected `activeMessageID` marks the correct node metadata. If the component remains purely presentational, skip a new test file and keep all new logic in pure helpers.

- [ ] **Step 2: Run the targeted test to confirm the missing helper/state fails (if added)**

Run: `bun --cwd packages/opencode test test/cli/tui/session/question-rail-model.test.ts`
Expected: FAIL only if you added a new pure helper.

- [ ] **Step 3: Implement the `QuestionRail` presentational component**

Create a component with a narrow prop contract, for example:

```ts
export function QuestionRail(props: {
  nodes: QuestionNode[]
  activeMessageID?: string
  onSelect: (messageID: string) => void
})
```

Implementation requirements:
- render as a narrow right-side panel / rail
- one compact node per question
- active node visually distinct
- hover state stored locally with `createSignal`
- hover shows a summary text region (inline preview or adjacent mini-panel)
- click / mouse-up calls `props.onSelect(messageID)`
- guard against text selection conflicts similarly to current session message click handlers if needed

Do **not** build a floating modal tooltip in the first pass. Prefer an inline preview region inside the rail component for simpler focus + mouse handling.

- [ ] **Step 4: Integrate the rail into `Session` layout**

In `routes/session/index.tsx`:
- derive `questionNodes` with `createMemo(() => buildQuestionNodes(...))`
- insert `<QuestionRail />` as a sibling to the main session message `<scrollbox>`
- preserve existing `sidebarVisible()` behavior and overall width math
- keep the current message scrollbox untouched except for wiring `onSelect`

The insertion point should stay inside the existing session body row layout, not inside the global sidebar.

- [ ] **Step 5: Wire click-to-jump using existing scroll logic**

Reuse the existing pattern already used by `DialogTimeline`:

```ts
const child = scroll.getChildren().find((child) => child.id === messageID)
if (child) scroll.scrollBy(child.y - scroll.y - 1)
```

Do not invent a second indexing system for message positions.

- [ ] **Step 6: Run focused verification**

Run:
- `bun --cwd packages/opencode run typecheck`
- any focused TUI/unit tests you created

Expected: PASS.

- [ ] **Step 7: Manual QA in TUI**

Run the actual package TUI entry and verify:

```bash
ELECTRON_GET_USE_PROXY=1 bun --cwd packages/opencode run dev
```

Then open or create a session with multiple user prompts and verify:
- rail appears only in session view
- node count matches user questions
- hover summary updates correctly
- click jumps to the expected message
- existing scroll behavior still works
- existing sidebar still opens/closes correctly

Record any layout issues before moving on.

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/routes/session/index.tsx \
  packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx \
  packages/opencode/test/cli/tui/session/question-rail-model.test.ts
git commit -m "feat(tui): add session question navigation rail"
```

---

## Chunk 3: Track the active question while scrolling

### Task 3: Add active-node synchronization with current scroll position

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Optionally create: `packages/opencode/src/cli/cmd/tui/routes/session/question-rail-state.ts`
- Optionally test: `packages/opencode/test/cli/tui/session/question-rail-state.test.ts`

- [ ] **Step 1: Write a failing test for active-node calculation if you extract a helper**

If you create a pure helper such as `findActiveQuestionNode(...)`, add a test that proves a scroll position maps to the nearest visible user message boundary.

- [ ] **Step 2: Run the new focused test to verify it fails**

Run: `bun --cwd packages/opencode test test/cli/tui/session/question-rail-state.test.ts`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Implement active-node calculation**

Preferred first-pass rule:
- determine the nearest visible user message above or near the current `scroll.y`
- map that message id to `activeMessageID`

Keep it simple and deterministic. Do not attempt a weighted viewport occupancy algorithm on the first pass.

If possible, implement this as a pure helper over a list of `{ id, y }` entries so it is easy to test.

- [ ] **Step 4: Wire active state into `QuestionRail`**

Update `QuestionRail` usage in `index.tsx` to pass the derived `activeMessageID` and ensure the active node style updates while scrolling.

- [ ] **Step 5: Verify keyboard + timeline navigation also update the active node**

Ensure these existing paths still produce the right highlighted node:
- command palette “Jump to message” / timeline dialog
- page up/down and message next/previous navigation
- initial load scroll-to-bottom behavior

- [ ] **Step 6: Run verification**

Run:
- `bun --cwd packages/opencode run typecheck`
- `bun --cwd packages/opencode test test/cli/tui/session/question-rail-model.test.ts`
- `bun --cwd packages/opencode test test/cli/tui/session/question-rail-state.test.ts` (if added)

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/routes/session/index.tsx \
  packages/opencode/src/cli/cmd/tui/routes/session/question-rail-state.ts \
  packages/opencode/test/cli/tui/session/question-rail-state.test.ts
git commit -m "feat(tui): sync question rail with session scroll"
```

---

## Chunk 4: Polish UX and decide on extensibility boundary

### Task 4: Refine hover summary and optional plugin slot exposure

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- Optional modify: `packages/plugin/src/tui.ts`

- [ ] **Step 1: Decide whether hover summary stays inline or becomes a reusable mini-preview region**

Default recommendation: keep the summary inline inside the rail component or a small adjacent preview box. Only move to plugin-facing extensibility after the core UX feels stable.

- [ ] **Step 2: Implement summary polish**

Polish items:
- stable truncation width
- muted footer / timestamp styling
- clear active vs hovered vs idle colors
- safe behavior when there are zero question nodes

- [ ] **Step 3: Optional plugin slot work (only if explicitly desired in this implementation)**

If you want plugin extensibility now, add a narrow slot such as `session_rail_after` or `session_rail_content` in `packages/plugin/src/tui.ts` and mount it from `index.tsx`.

Do **not** block the core feature on plugin slot design.

- [ ] **Step 4: Run final verification**

Run:
- `bun --cwd packages/opencode run typecheck`
- `bun --cwd packages/opencode run test -- test/cli/tui/session/question-rail-model.test.ts`
- `bun --cwd packages/opencode run test -- test/cli/tui/session/question-rail-state.test.ts` (if added)
- `ELECTRON_GET_USE_PROXY=1 bun --cwd packages/opencode run dev`

Expected: PASS for automated checks, and the TUI launches for manual verification.

- [ ] **Step 5: Final manual QA checklist**

Verify all of the following in a real session with multiple user questions:
- hover summary updates without focus glitches
- clicking each node lands near the right question
- active node tracks scroll changes
- no overlap issues with the existing right sidebar
- no regressions in mouse selection / copy behavior
- narrow terminal widths degrade gracefully (rail hidden, collapsed, or reduced)

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/routes/session/question-rail.tsx \
  packages/opencode/src/cli/cmd/tui/routes/session/index.tsx \
  packages/plugin/src/tui.ts
git commit -m "feat(tui): polish session question rail"
```

---

## Notes for the implementer

- Reuse existing extraction rules from `dialog-timeline.tsx`; do not invent a second notion of what counts as a “question”.
- Reuse existing scroll jump behavior from `session/index.tsx`; do not store duplicate y-offset state unless testing proves it is necessary.
- Keep the first version conservative: inline preview > floating tooltip.
- Preserve current session scrollbox behavior (`stickyScroll`, `scrollAcceleration`, scrollbar toggle, page/message keybinds).
- Follow existing theme usage via `useTheme()` and existing panel colors; do not introduce ad hoc color constants.
- Prefer extracting pure helpers for anything that smells stateful but can be calculated from arrays; this is the only realistic way to test this feature without deep TUI harness work.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-22-session-question-rail.md`. Ready to execute?
