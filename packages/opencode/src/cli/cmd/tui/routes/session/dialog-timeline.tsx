import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../component/prompt/history"
import type { DialogContext } from "@tui/ui/dialog"
import { buildQuestionNodes } from "./question-rail-model"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    return buildQuestionNodes({ messages, parts: sync.data.part })
      .map((node) => ({
        title: node.title,
        value: node.messageID,
        footer: node.footer,
        onSelect: (ctx: DialogContext) => {
          ctx.replace(() => (
            <DialogMessage messageID={node.messageID} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      }))
      .reverse()
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Timeline" options={options()} />
}
