import { createMemo, createSignal, For, Show } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import type { QuestionNode } from "./question-rail-model"
import type { QuestionMark } from "./question-rail-state"

export function QuestionRail(props: {
  nodes: QuestionNode[]
  marks: QuestionMark[]
  height: number
  activeMessageID?: string
  onSelect: (messageID: string) => void
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal<string>()

  const current = createMemo(() => {
    const id = hover()
    if (!id) return
    const idx = props.nodes.findIndex((x) => x.messageID === id)
    if (idx < 0) return
    const mark = props.marks.find((x) => x.id === id)
    if (!mark) return
    return {
      idx,
      mark,
      node: props.nodes[idx],
    }
  })

  const pill = createMemo(() => {
    const item = current()
    if (!item) return ""
    return `Q${item.idx + 1} · ${item.node.title}`
  })

  return (
    <Show when={props.marks.length > 0}>
      <box position="absolute" top={0} right={0} bottom={0} width={28} zIndex={100} onMouseOut={() => setHover()}>
        <For each={props.marks}>
          {(mark) => {
            const hot = createMemo(() => hover() === mark.id)
            const active = createMemo(() => props.activeMessageID === mark.id)
            const fg = createMemo(() => {
              if (hot()) return theme.primary
              if (active()) return theme.text
              return theme.textMuted
            })
            const top = createMemo(() => Math.max(0, Math.min(props.height - 1, mark.row)))

            return (
              <box
                position="absolute"
                top={top()}
                right={0}
                width={3}
                justifyContent="center"
                onMouseOver={() => setHover(mark.id)}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  props.onSelect(mark.id)
                }}
              >
                <text fg={fg()}>●</text>
              </box>
            )
          }}
        </For>

        <Show when={current()}>
          {(item) => (
            <box
              position="absolute"
              top={Math.max(0, Math.min(props.height - 1, item().mark.row))}
              right={3}
              maxWidth={24}
              backgroundColor={theme.backgroundMenu}
              border={["left"]}
              borderColor={theme.primary}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.text}>{pill()}</text>
            </box>
          )}
        </Show>
      </box>
    </Show>
  )
}
