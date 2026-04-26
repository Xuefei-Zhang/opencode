import { expect, test } from "bun:test"
import path from "path"

const file = path.join(import.meta.dir, "../../../../src/cli/cmd/tui/routes/session/index.tsx")

test("recomputes question markers from a layout tick, not only scroll movement", async () => {
  const text = await Bun.file(file).text()

  expect(text.includes("const [tick, setTick] = createSignal(0)")).toBe(true)
  expect(text.includes("tick()\n    top()")).toBe(true)
})
