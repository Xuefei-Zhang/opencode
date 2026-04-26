import { describe, expect, test } from "bun:test"
import { buildQuestionNodes } from "../../../../src/cli/cmd/tui/routes/session/question-rail-model"

describe("buildQuestionNodes", () => {
  test("extracts user messages with the first valid text part", () => {
    const result = buildQuestionNodes({
      messages: [
        { id: "u1", role: "user", time: { created: 1 } },
        { id: "a1", role: "assistant", time: { created: 2 } },
      ],
      parts: {
        u1: [
          { type: "text", text: "", synthetic: false, ignored: false },
          { type: "text", text: "How do I fix this?", synthetic: false, ignored: false },
        ],
        a1: [{ type: "text", text: "Ignore me", synthetic: false, ignored: false }],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({ messageID: "u1", title: "How do I fix this?", created: 1 }),
    ])
  })

  test("skips synthetic and ignored text parts", () => {
    const result = buildQuestionNodes({
      messages: [{ id: "u1", role: "user", time: { created: 1 } }],
      parts: {
        u1: [
          { type: "text", text: "Synthetic", synthetic: true, ignored: false },
          { type: "text", text: "Ignored", synthetic: false, ignored: true },
        ],
      },
    })

    expect(result).toEqual([])
  })

  test("normalizes newlines in titles", () => {
    const result = buildQuestionNodes({
      messages: [{ id: "u1", role: "user", time: { created: 1 } }],
      parts: {
        u1: [{ type: "text", text: "How do I\nfix this?", synthetic: false, ignored: false }],
      },
    })

    expect(result[0]?.title).toBe("How do I fix this?")
  })

  test("truncates long titles to a bounded width", () => {
    const result = buildQuestionNodes({
      messages: [{ id: "u1", role: "user", time: { created: 1 } }],
      parts: {
        u1: [
          {
            type: "text",
            text: "a".repeat(200),
            synthetic: false,
            ignored: false,
          },
        ],
      },
    })

    expect(result[0]?.title.length).toBeLessThan(200)
    expect(result[0]?.title.endsWith("…")).toBe(true)
  })

  test("clamps very small max values", () => {
    const result = buildQuestionNodes({
      messages: [{ id: "u1", role: "user", time: { created: 1 } }],
      parts: {
        u1: [{ type: "text", text: "abc", synthetic: false, ignored: false }],
      },
      max: 1,
    })

    expect(result[0]?.title).toBe("a…")
  })

  test("preserves message order and created timestamps", () => {
    const result = buildQuestionNodes({
      messages: [
        { id: "u1", role: "user", time: { created: 20 } },
        { id: "u2", role: "user", time: { created: 10 } },
      ],
      parts: {
        u1: [{ type: "text", text: "First", synthetic: false, ignored: false }],
        u2: [{ type: "text", text: "Second", synthetic: false, ignored: false }],
      },
    })

    expect(result.map((x) => x.created)).toEqual([20, 10])
    expect(result.map((x) => x.messageID)).toEqual(["u1", "u2"])
  })
})
