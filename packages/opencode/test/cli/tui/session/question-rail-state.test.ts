import { describe, expect, test } from "bun:test"
import { buildQuestionMarks, findActiveQuestion } from "../../../../src/cli/cmd/tui/routes/session/question-rail-state"

describe("findActiveQuestion", () => {
  test("picks the nearest visible question at or above the scroll position", () => {
    const result = findActiveQuestion({
      y: 42,
      list: [
        { id: "u1", y: 8 },
        { id: "u2", y: 30 },
        { id: "u3", y: 60 },
      ],
    })

    expect(result).toBe("u2")
  })

  test("falls back to the first visible question below the scroll position", () => {
    const result = findActiveQuestion({
      y: 2,
      list: [
        { id: "u1", y: 8 },
        { id: "u2", y: 30 },
      ],
    })

    expect(result).toBe("u1")
  })

  test("keeps the last visible question active near later scroll positions", () => {
    const result = findActiveQuestion({
      y: 200,
      list: [
        { id: "u1", y: 8 },
        { id: "u2", y: 30 },
      ],
    })

    expect(result).toBe("u2")
  })

  test("falls back to the first node when positions are temporarily unavailable", () => {
    const result = findActiveQuestion({
      y: 10,
      list: [],
      fallback: "u1",
    })

    expect(result).toBe("u1")
  })

  test("returns nothing when no question positions or fallback are available", () => {
    const result = findActiveQuestion({ y: 10, list: [] })

    expect(result).toBeUndefined()
  })

  test("maps question positions onto track rows", () => {
    const result = buildQuestionMarks({
      list: [
        { id: "u1", y: 0 },
        { id: "u2", y: 50 },
        { id: "u3", y: 100 },
      ],
      height: 11,
      scroll_height: 100,
    })

    expect(result).toEqual([
      { id: "u1", row: 0 },
      { id: "u2", row: 5 },
      { id: "u3", row: 10 },
    ])
  })

  test("dedupes rows by keeping the latest item on the same track row", () => {
    const result = buildQuestionMarks({
      list: [
        { id: "u1", y: 20 },
        { id: "u2", y: 21 },
      ],
      height: 4,
      scroll_height: 100,
    })

    expect(result).toEqual([{ id: "u2", row: 1 }])
  })

  test("caps the number of visible markers by sampling the list", () => {
    const result = buildQuestionMarks({
      list: [
        { id: "u1", y: 0 },
        { id: "u2", y: 10 },
        { id: "u3", y: 20 },
        { id: "u4", y: 30 },
        { id: "u5", y: 40 },
      ],
      height: 21,
      scroll_height: 40,
      max: 3,
    })

    expect(result).toEqual([
      { id: "u1", row: 0 },
      { id: "u3", row: 10 },
      { id: "u5", row: 20 },
    ])
  })
})
