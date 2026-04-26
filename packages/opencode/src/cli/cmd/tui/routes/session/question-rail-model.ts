import { Locale } from "@/util/locale"

type Msg = {
  id: string
  role: string
  time: {
    created: number
  }
}

type Part = {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

export type QuestionNode = {
  messageID: string
  title: string
  preview: string
  footer: string
  created: number
}

export function buildQuestionNodes(input: {
  messages: Msg[]
  parts: Record<string, Part[] | undefined>
  max?: number
}): QuestionNode[] {
  const max = Math.max(input.max ?? 48, 2)
  const nodes = [] as QuestionNode[]

  for (const msg of input.messages) {
    if (msg.role !== "user") continue

    const part = input.parts[msg.id]?.find((x) => x.type === "text" && !x.synthetic && !x.ignored && x.text)
    if (!part?.text) continue

    const text = part.text.replace(/\s*\n\s*/g, " ").trim()
    if (!text) continue

    nodes.push({
      messageID: msg.id,
      title: text.length > max ? `${text.slice(0, max - 1)}…` : text,
      preview: text,
      footer: Locale.time(msg.time.created),
      created: msg.time.created,
    })
  }

  return nodes
}
