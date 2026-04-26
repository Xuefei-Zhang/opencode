type Item = {
  id: string
  y: number
}

export type QuestionMark = {
  id: string
  row: number
}

export function buildQuestionMarks(input: {
  height: number
  scroll_height: number
  list: Item[]
  max?: number
}) {
  if (input.height <= 0 || input.scroll_height <= 0) return [] as QuestionMark[]
  const max = Math.max(input.max ?? input.height, 1)
  const step = input.list.length > max ? (input.list.length - 1) / (max - 1 || 1) : 1
  const list =
    input.list.length > max
      ? Array.from({ length: max }, (_, i) => input.list[Math.round(i * step)]).filter((x): x is Item => !!x)
      : input.list
  const rows = new Map<number, QuestionMark>()
  for (const item of list) {
    const raw = Math.round((item.y / input.scroll_height) * (input.height - 1))
    const row = Math.max(0, Math.min(input.height - 1, raw))
    rows.set(row, { id: item.id, row })
  }
  return [...rows.values()].sort((a, b) => a.row - b.row)
}

export function findActiveQuestion(input: {
  y: number
  list: Item[]
  fallback?: string
}) {
  const at = [...input.list].reverse().find((x) => x.y <= input.y)
  if (at) return at.id
  if (input.list[0]?.id) return input.list[0].id
  return input.fallback
}
