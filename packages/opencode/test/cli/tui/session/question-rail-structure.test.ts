import { expect, test } from "bun:test"
import path from "path"

const file = path.join(import.meta.dir, "../../../../src/cli/cmd/tui/routes/session/question-rail.tsx")

test("uses hover entry without redundant mouse-move updates", async () => {
  const text = await Bun.file(file).text()

  expect(text.includes("onMouseOver={() => setHover(mark.id)}")).toBe(true)
  expect(text.includes("onMouseMove={() => setHover(mark.id)}")).toBe(false)
})
