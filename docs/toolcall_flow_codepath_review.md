# toolcall codepath review

## What is being traced
- Representative entrypoint: `packages/opencode/test/session/snapshot-tool-race.test.ts`
- Concrete path: a forced `bash` toolcall seeded by the test LLM server, then executed through `SessionPrompt.loop(...)`
- Scope note: this report follows the internal repo path up to the AI SDK boundary. The actual decision to invoke the tool callback happens inside `streamText(...)`, which is external to this repo; the repo-side code passes `tools`/`activeTools` in and then observes the emitted tool events.

## Ordered codepath
1. The test seeds a user prompt, configures the fake LLM to emit a `bash` toolcall, then starts `SessionPrompt.loop(...)`.
2. `SessionPrompt.prompt(...)` persists the user message; `runLoop(...)` creates the assistant message and processor handle.
3. `ToolRegistry.tools(...)` materializes built-in/custom tools, including `BashTool`, by calling each tool's `init(...)`.
4. `SessionPrompt.resolveTools(...)` wraps registry tools into AI-SDK `tool({...})` callbacks and binds repo context like `sessionID`, `messageID`, `callID`, permission asks, plugin hooks, and `ctx.metadata(...)` updates.
5. `handle.process(...)` hands the prepared `tools`, `messages`, `system`, and `model` into `SessionProcessor.process(...)`.
6. `SessionProcessor.process(...)` starts `llm.stream(...)` and drains the event stream with `Stream.tap(handleEvent)`.
7. `LLM.resolveTools()` filters the wrapped tool map against permissions and per-message disables right before model execution.
8. `LLM.stream(...)` calls `streamText({ activeTools, tools, ... })`, which is the boundary where the external AI SDK can choose to execute a tool.
9. `SessionProcessor.handleEvent(...)` records `tool-input-start` → `pending`, `tool-call` → `running`, and `tool-result` → `completed` in session parts, while `ctx.metadata(...)` can also refresh the running tool part mid-execution.
10. The wrapped callback reaches `Tool.define(...)`, which validates args and applies output truncation rules.
11. `BashTool.execute(...)` parses the command, asks permission, and calls `run(...)` to spawn the shell process and stream metadata/output back into the tool result.

## Snippets

### 1. Test seeds the toolcall and starts the loop
**File:** `packages/opencode/test/session/snapshot-tool-race.test.ts:186-204`
```ts
// Use bash tool (always registered) to create a file
const command = `echo 'snapshot race test content' > ${path.join(dir, "race-test.txt")}`
yield* llm.toolMatch((hit) => JSON.stringify(hit.body).includes("create the file"), "bash", {
  command,
  description: "create test file",
})
yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("bash"), "done")

yield* prompt.prompt({
  sessionID: session.id,
  agent: "build",
  noReply: true,
  parts: [{ type: "text", text: "create the file" }],
})

const result = yield* prompt.loop({ sessionID: session.id })
```

### 2. TestLLMServer turns the queued tool reply into tool-call chunks
**File:** `packages/opencode/test/lib/llm-server.ts:717-727`
```ts
toolMatch: Effect.fn("TestLLMServer.toolMatch")(function* (match: Match, name: string, input: unknown) {
  queueMatch(match, reply().tool(name, input).item())
}),
```

**File:** `packages/opencode/test/lib/llm-server.ts:296-305,366-395`
```ts
if (delta && "tool_calls" in delta && Array.isArray(delta.tool_calls)) {
  for (const tool of delta.tool_calls) {
    ...
    if ("id" in tool && typeof tool.id === "string" && fn && "name" in fn && typeof fn.name === "string") {
      out.push({ type: "tool-start", id: tool.id, name: fn.name })
    }
    if (fn && "arguments" in fn && typeof fn.arguments === "string" && fn.arguments) {
      out.push({ type: "tool-args", text: fn.arguments })
    }
  }
}

if (part.type === "tool-start") {
  call ||= { id: part.id, item: "fc_1", name: part.name, args: "" }
  seq += 1
  lines.push(responseTool(call.id, call.item, call.name, seq))
  continue
}

if (call && !item.hang && !item.error) {
  seq += 1
  lines.push(responseToolDone(call, seq))
}
```

### 3. `prompt(...)` persists the user message; `runLoop(...)` creates the assistant handle
**File:** `packages/opencode/src/session/prompt.ts:1305-1322`
```ts
const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(
  function* (input: PromptInput) {
    const session = yield* sessions.get(input.sessionID)
    yield* Effect.promise(() => SessionRevert.cleanup(session))
    const message = yield* createUserMessage(input)
    yield* sessions.touch(input.sessionID)
    ...
    if (input.noReply === true) return message
    return yield* loop({ sessionID: input.sessionID })
  },
)
```

**File:** `packages/opencode/src/session/prompt.ts:1433-1453`
```ts
const msg: MessageV2.Assistant = {
  id: MessageID.ascending(),
  parentID: lastUser.id,
  role: "assistant",
  ...
  sessionID,
}
yield* sessions.updateMessage(msg)
const handle = yield* processor.create({
  assistantMessage: msg,
  sessionID,
  model,
})
```

### 4. Tool registry materializes the available tools
**File:** `packages/opencode/src/tool/registry.ts:157-195`
```ts
const tools = Effect.fn("ToolRegistry.tools")(function* (
  model: { providerID: ProviderID; modelID: ModelID },
  agent?: Agent.Info,
) {
  const s = yield* InstanceState.get(state)
  const allTools = yield* all(s.custom)
  const filtered = allTools.filter((tool) => {
    ...
    return true
  })
  return yield* Effect.forEach(
    filtered,
    Effect.fnUntraced(function* (tool: Tool.Info) {
      const next = yield* Effect.promise(() => tool.init({ agent }))
      return {
        id: tool.id,
        description: next.description,
        parameters: next.parameters,
        execute: next.execute,
        formatValidationError: next.formatValidationError,
      }
    }),
    { concurrency: "unbounded" },
  )
})
```

### 5. `resolveTools(...)` wraps registry tools for AI SDK execution
**File:** `packages/opencode/src/session/prompt.ts:400-470`
```ts
const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
  sessionID: input.session.id,
  abort: options.abortSignal!,
  messageID: input.processor.message.id,
  callID: options.toolCallId,
  ...
})

for (const item of yield* registry.tools(
  { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
  input.agent,
)) {
  ...
  tools[item.id] = tool({
    id: item.id as any,
    description: item.description,
    inputSchema: jsonSchema(schema as any),
    execute(args, options) {
      return Effect.runPromise(
        Effect.gen(function* () {
          const ctx = context(args, options)
          ...
          const result = yield* Effect.promise(() => item.execute(args, ctx))
          ...
          return output
        }),
      )
    },
  })
}
```

**File:** `packages/opencode/src/session/prompt.ts:408-423`
```ts
metadata: (val) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (!match || !["running", "pending"].includes(match.state.status)) return
      yield* sessions.updatePart({
        ...match,
        state: {
          title: val.title,
          metadata: val.metadata,
          status: "running",
          input: args,
          time: { start: Date.now() },
        },
      })
    }),
  ),
```

### 6. `runLoop(...)` passes the tool map into processor execution
**File:** `packages/opencode/src/session/prompt.ts:1460-1520`
```ts
const tools = yield* resolveTools({
  agent,
  session,
  model,
  tools: lastUser.tools,
  processor: handle,
  bypassAgentCheck,
  messages: msgs,
})

const result = yield* handle.process({
  user: lastUser,
  agent,
  permission: session.permission,
  sessionID,
  system,
  messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
  tools,
  model,
  toolChoice: format.type === "json_schema" ? "required" : undefined,
})
```

### 7. Processor drains `llm.stream(...)` and observes events
**File:** `packages/opencode/src/session/processor.ts:445-460`
```ts
const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
  ...
  const stream = llm.stream(streamInput)

  yield* stream.pipe(
    Stream.tap((event) => handleEvent(event)),
    Stream.takeUntil(() => ctx.needsCompaction),
    Stream.runDrain,
  )
})
```

### 8. LLM filters the wrapped tools, then hands them into `streamText(...)`
**File:** `packages/opencode/src/session/llm.ts:336-342`
```ts
function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}
```

**File:** `packages/opencode/src/session/llm.ts:200-202,259-333`
```ts
const tools = await resolveTools(input)

return streamText({
  ...
  activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
  tools,
  toolChoice: input.toolChoice,
  ...
  messages,
  model: wrapLanguageModel({ ... }),
})
```

**Note:** this is the repo-side proof of the execution boundary. `SessionProcessor` does not invoke tools itself; it consumes the resulting stream events.

### 9. Processor pre-captures snapshot because tools may run before `start-step`
**File:** `packages/opencode/src/session/processor.ts:86-90`
```ts
const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
  // Pre-capture snapshot before the LLM stream starts. The AI SDK
  // may execute tools internally before emitting start-step events,
  // so capturing inside the event handler can be too late.
  const initialSnapshot = yield* snapshot.track()
```

### 10. Tool lifecycle events are persisted into session parts
**File:** `packages/opencode/src/session/processor.ts:153-232`
```ts
case "tool-input-start":
  ctx.toolcalls[value.id] = yield* session.updatePart({
    ...
    type: "tool",
    tool: value.toolName,
    callID: value.id,
    state: { status: "pending", input: {}, raw: "" },
  } satisfies MessageV2.ToolPart)
  return

case "tool-call": {
  const match = ctx.toolcalls[value.toolCallId]
  if (!match) return
  ctx.toolcalls[value.toolCallId] = yield* session.updatePart({
    ...match,
    tool: value.toolName,
    state: { status: "running", input: value.input, time: { start: Date.now() } },
    metadata: value.providerMetadata,
  } satisfies MessageV2.ToolPart)
  return
}

case "tool-result": {
  const match = ctx.toolcalls[value.toolCallId]
  if (!match || match.state.status !== "running") return
  yield* session.updatePart({
    ...match,
    state: {
      status: "completed",
      input: value.input ?? match.state.input,
      output: value.output.output,
      metadata: value.output.metadata,
      title: value.output.title,
      time: { start: match.state.time.start, end: Date.now() },
      attachments: value.output.attachments,
    },
  })
  delete ctx.toolcalls[value.toolCallId]
  return
}
```

### 11. `Tool.define(...)` adds validation/truncation before the concrete tool returns
**File:** `packages/opencode/src/tool/tool.ts:51-87`
```ts
export function define<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: Info<Parameters, Result>["init"] | Def<Parameters, Result>,
) {
  return {
    id,
    init: async (initCtx) => {
      const toolInfo = init instanceof Function ? await init(initCtx) : init
      const execute = toolInfo.execute
      toolInfo.execute = async (args, ctx) => {
        toolInfo.parameters.parse(args)
        const result = await execute(args, ctx)
        if (result.metadata.truncated !== undefined) return result
        const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
        return {
          ...result,
          output: truncated.content,
          metadata: { ...result.metadata, truncated: truncated.truncated, ...(truncated.truncated && { outputPath: truncated.outputPath }) },
        }
      }
      return toolInfo
    },
  }
}
```

### 12. `bash` performs permission scan, then runs the shell command
**File:** `packages/opencode/src/tool/bash.ts:470-494`
```ts
async execute(params, ctx) {
  const cwd = params.workdir ? await resolvePath(params.workdir, Instance.directory, shell) : Instance.directory
  ...
  const root = await parse(params.command, ps)
  const scan = await collect(root, cwd, ps, shell)
  if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)
  await ask(ctx, scan)

  return run(
    {
      shell,
      name,
      command: params.command,
      cwd,
      env: await shellEnv(ctx, cwd),
      timeout,
      description: params.description,
    },
    ctx,
  )
}
```

**File:** `packages/opencode/src/tool/bash.ts:333-408`
```ts
ctx.metadata({
  metadata: {
    output: "",
    description: input.description,
  },
})

const exit = await CrossSpawnSpawner.runPromiseExit((spawner) =>
  Effect.gen(function* () {
    const handle = yield* spawner.spawn(cmd(input.shell, input.name, input.command, input.cwd, input.env))
    ...
    const exit = yield* Effect.raceAll([
      handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
      abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
      timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
    ])
    ...
    return exit.kind === "exit" ? exit.code : null
  }).pipe(Effect.scoped, Effect.orDie),
)

return {
  title: input.description,
  metadata: {
    output: preview(output),
    exit: code,
    description: input.description,
  },
  output,
}
```

## Short summary
- The representative path starts from a test-forced `bash` toolcall, enters `SessionPrompt.loop(...)`, builds and wraps the tool map, filters it in `LLM.resolveTools()`, and then passes it into `LLM.stream(...)`.
- The key architectural split is that `streamText(...)` owns tool invocation, while `SessionProcessor` records the resulting lifecycle events into session parts; meanwhile `ctx.metadata(...)` can also update the running tool part during execution.
- `bash` reaches execution through `ToolRegistry.tools(...)` → `resolveTools(...)` wrapper → `Tool.define(...)` validation/truncation → `BashTool.execute(...)` + `run(...)`.

## Explicit uncertainty
- The exact provider adapter that turns raw OpenAI-compatible chunks into normalized `tool-input-start` / `tool-call` events is partly outside this repo boundary for this path. The repo-side evidence here is the test server’s emitted tool-call chunks and the repo’s subsequent `streamText({ tools, activeTools, ... })` + event handling.
