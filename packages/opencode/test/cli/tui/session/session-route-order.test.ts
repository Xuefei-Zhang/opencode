import { expect, test } from "bun:test"
import path from "path"

const file = path.join(import.meta.dir, "../../../../src/cli/cmd/tui/routes/session/index.tsx")

test("declares scroll before active memo reads it", async () => {
  const text = await Bun.file(file).text()
  const decl = text.indexOf("let scroll: ScrollBoxRenderable")
  const read = text.indexOf("if (!scroll) return nodes()[0]?.messageID")

  expect(decl).toBeGreaterThanOrEqual(0)
  expect(read).toBeGreaterThanOrEqual(0)
  expect(decl).toBeLessThan(read)
})

test("declares prompt before effects read it", async () => {
  const text = await Bun.file(file).text()
  const decl = text.indexOf("let prompt: PromptRef")
  const read = text.indexOf("if (route.initialPrompt && prompt)")

  expect(decl).toBeGreaterThanOrEqual(0)
  expect(read).toBeGreaterThanOrEqual(0)
  expect(decl).toBeLessThan(read)
})

test("does not reserve transcript width for a separate question rail column", async () => {
  const text = await Bun.file(file).text()

  expect(text.includes("contentWidth = createMemo(() => body() - (showRail() ? rail + 1 : 0))")).toBe(false)
  expect(text.includes("<QuestionRail\n                  width={rail}")).toBe(false)
})
