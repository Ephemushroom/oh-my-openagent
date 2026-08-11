import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Plugin } from "@opencode-ai/plugin"
import type { Context } from "@opencode-ai/plugin/promise/plugin"

import { registerCategories } from "./agents/register-categories"
import { registerPrimaries } from "./agents/register-primaries"
import { registerSubagents } from "./agents/register-subagents"
import { createCatalogSource, resolveAgentModel } from "./agents/model-resolution"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"
import { TaskRegistry } from "./orchestration/task-registry"
import { ConcurrencyLimiter } from "./orchestration/concurrency"
import { createTaskEngine } from "./orchestration/task-engine"
import type { TaskEngine } from "./orchestration/task-engine"
import type { ChildResult } from "./orchestration/task-engine"
import { createTaskTool } from "./orchestration/task-tool"
import { createBackgroundOutputTool, createBackgroundCancelTool } from "./orchestration/background-tools"

const RUN_MARKER = "OMO-SPIKE-7f3a9"
const CONTEXT_MARKER = "OMO-SPIKE-CTX-22cc"
const ECHO_TOOL = "omo_spike_echo"
const DELEGATE_TOOL = "omo_spike_delegate"
const PRIMARY_AGENT = "omo-spike"
const SUB_AGENT = "omo-spike-sub"
const NO_ECHO_FLAG = "[no-echo]"
const REDACT_PATTERN = /token=[A-Za-z0-9-]+/g
const CHILD_TIMEOUT_MS = 120_000

type Trace = (event: string, detail?: Record<string, unknown>) => void

function createTrace(): Trace {
  const file = process.env.OMO_SPIKE_TRACE
  if (!file) return () => undefined
  mkdirSync(dirname(file), { recursive: true })
  return (event, detail) => {
    appendFileSync(file, `${JSON.stringify({ t: Date.now(), event, ...detail })}\n`)
  }
}

type ChildWaiter = { texts: string[]; resolve: (result: ChildResult) => void }

function readPrompt(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return ""
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

export default Plugin.define({
  id: "omo",
  setup: async (ctx) => {
    const trace = createTrace()
    const registry = new TaskRegistry()
    const limiter = new ConcurrencyLimiter()
    const engine = createTaskEngine({
      ctx,
      registry,
      trace,
      onBackgroundTerminal: ({ taskID, parentSessionID, ok, text }) => {
        trace("omo.task.background-completed", { taskID, parentSessionID, ok, length: text.length })
        void ctx.session
          .synthetic({
            sessionID: parentSessionID,
            text: `<omo-task> background task ${taskID} finished ok=${ok}: ${text.slice(0, 200)} </omo-task>`,
            delivery: "queue",
          })
          .catch(() => undefined)
      },
    })

    // The v2 catalog is empty at plugin setup and populates asynchronously
    // (catalog.updated). Capture each update into a live source so agent model
    // resolution reads the populated catalog — a setup-time snapshot would be
    // empty and force every agent onto its first fallback.
    const catalog = createCatalogSource()
    await ctx.catalog.transform((draft) => {
      catalog.capture(draft)
      const snap = catalog.current
      trace("omo.catalog.snapshot", {
        availableModels: snap.availableModels.size,
        providers: snap.connectedProviders,
        defaultModel: snap.systemDefaultModel,
      })
    })

    // Phase 1: register the real OMO agent catalog — 11 agents (sisyphus /
    // hephaestus / prometheus / atlas primaries + 7 subagents) plus the
    // delegation categories as subagents. Default agent: sisyphus.
    const subagents = await registerSubagents(ctx, { trace, catalog })
    const primaries = await registerPrimaries(ctx, { trace, defaultAgent: "sisyphus", catalog })
    const categories = await registerCategories(ctx, { trace, catalog })

    // v2 applies agent.transform callbacks lazily (on first registry
    // materialization); force them now so the summary reflects what was actually
    // upserted rather than resolving to an empty list.
    await ctx.agent.reload()
    trace("omo.registration.complete", {
      primaries: [...primaries],
      subagents: [...subagents],
      categories: [...categories],
    })

    // Phase 2: orchestration. Task tool + background tools, wired to the task
    // engine. waitChild registers a waiter on the engine's pump; the pump
    // aggregates child text and settles on terminal execution events.
    const deps = {
      waitChild: (options: { sessionID: string; timeoutMs: number }): Promise<ChildResult> =>
        new Promise<ChildResult>((resolve) => {
          let settled = false
          const done = (result: ChildResult) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(result)
          }
          engine.waiters.set(options.sessionID, { texts: [], resolve: done })
          const timeout = setTimeout(() => {
            if (!engine.waiters.delete(options.sessionID)) return
            void ctx.session.interrupt({ sessionID: options.sessionID }).catch(() => undefined)
            done({ ok: false, text: "timeout waiting for child session" })
          }, options.timeoutMs)
        }),
      interrupt: async (sessionID: string) => {
        await ctx.session.interrupt({ sessionID }).catch(() => undefined)
      },
    }

    const categoryModels = new Map<string, string>()
    const availableSubagents = [...subagents]
    const availableCategories = [...categories]
    for (const id of availableSubagents) {
      const requirement = AGENT_MODEL_REQUIREMENTS[id]
      const resolved = resolveAgentModel(requirement, catalog.current)
      if (resolved) categoryModels.set(id, resolved.model)
    }

    const resolveCategory = (category: string): { agent: string; model: string } | undefined => {
      if (!availableCategories.includes(category)) return undefined
      const requirement = AGENT_MODEL_REQUIREMENTS[category]
      const resolved = resolveAgentModel(requirement, catalog.current)
      if (!resolved) return undefined
      return { agent: category, model: resolved.model }
    }

    await ctx.tool.transform((draft) => {
      const taskTool = createTaskTool({
        ctx,
        registry,
        limiter,
        deps,
        availableSubagents,
        availableCategories,
        categoryModels,
        resolveCategory,
        trace,
      })
      draft.add({
        name: taskTool.name,
        description: taskTool.description,
        input: taskTool.input,
        options: { codemode: false },
        execute: taskTool.execute,
      })

      const outputTool = createBackgroundOutputTool({ ctx, registry })
      draft.add({
        name: outputTool.name,
        description: outputTool.description,
        input: outputTool.input,
        options: { codemode: false },
        execute: outputTool.execute,
      })

      const cancelTool = createBackgroundCancelTool({ ctx, registry })
      draft.add({
        name: cancelTool.name,
        description: cancelTool.description,
        input: cancelTool.input,
        options: { codemode: false },
        execute: cancelTool.execute,
      })
    })
    trace("omo.orchestration.registered", { tools: ["task", "background_output", "background_cancel"] })

    // Phase 0 mechanics probe (echo/context/delegate/synthetic verification
    // tools + agents). Gated off in production; QA enables it explicitly.
    if (process.env.OMO_SPIKE_MECHANICS === "1") {
      await setupMechanicsProbe(ctx, trace, engine)
    }

    return () => engine.dispose()
  },
})

async function setupMechanicsProbe(ctx: Context, trace: Trace, engine: TaskEngine): Promise<void> {
  const waiters = engine.waiters

  // Registered after registerPrimaries, so in mechanics mode the spike default
  // (omo-spike) intentionally wins over sisyphus for the probe runs.
  await ctx.agent.transform((draft) => {
    draft.update(PRIMARY_AGENT, (agent) => {
      agent.description = "OMO spike primary agent"
      agent.mode = "primary"
      agent.system = [
        "You are the omo spike verification agent.",
        `You MUST begin every reply with the exact token ${RUN_MARKER}.`,
        `When the user asks to echo something, call the ${ECHO_TOOL} tool.`,
        `When the user asks to delegate something, call the ${DELEGATE_TOOL} tool.`,
      ].join(" ")
    })
    draft.update(SUB_AGENT, (agent) => {
      agent.description = "OMO spike subagent"
      agent.mode = "subagent"
      agent.system = "You are a verification subagent. Reply with the shortest possible correct answer."
    })
    draft.default(PRIMARY_AGENT)
  })
  trace("agents.registered", { agents: [PRIMARY_AGENT, SUB_AGENT] })

  await ctx.session.hook("context", (event) => {
    event.system.push({ type: "text", text: `You MUST end every reply with the exact token ${CONTEXT_MARKER}.` })
    let redactions = 0
    let lastUserText = ""
    for (const message of event.messages) {
      if (message.role !== "user") continue
      for (const part of message.content) {
        if (part.type !== "text") continue
        lastUserText = part.text
        if (REDACT_PATTERN.test(part.text)) {
          // v2 ships readonly types over mutable runtime drafts; the context hook is
          // expected to rewrite parts in place (core reads the array back after hooks).
          const writable = part as { text: string }
          writable.text = part.text.replace(REDACT_PATTERN, "token=[REDACTED]")
          redactions += 1
        }
      }
    }
    let removed: string | undefined
    if (lastUserText.includes(NO_ECHO_FLAG) && ECHO_TOOL in event.tools) {
      delete event.tools[ECHO_TOOL]
      removed = ECHO_TOOL
    }
    trace("context", {
      sessionID: event.sessionID,
      agent: event.agent,
      tools: Object.keys(event.tools).toSorted().join(","),
      redactions,
      removed,
    })
  })

  await ctx.tool.hook("execute.before", (event) => {
    if (event.tool !== ECHO_TOOL) return
    const text = readPrompt(event.input, "text")
    event.input = { text: `BEFORE(${text})` }
    trace("tool.before.mutated", { tool: event.tool })
  })

  await ctx.tool.hook("execute.after", (event) => {
    trace("tool.after.seen", {
      tool: event.tool,
      status: event.status,
      contentType: event.status === "completed" ? typeof event.result.content : "n/a",
    })
    if (event.tool !== ECHO_TOOL || event.status !== "completed") return
    try {
      const content = event.result.content
      if (typeof content === "string") {
        event.result = { ...event.result, content: `${content}:AFTER` }
        trace("tool.after.mutated", { tool: event.tool, via: "string", sessionID: event.sessionID })
        return
      }
      if (Array.isArray(content)) {
        const next = content.map((part) =>
          part.type === "text" ? { ...part, text: `${part.text}:AFTER` } : part,
        )
        event.result = { ...event.result, content: next }
        trace("tool.after.mutated", { tool: event.tool, via: "array", sessionID: event.sessionID })
      }
    } catch (error) {
      trace("tool.after.error", { tool: event.tool, message: String(error) })
    }
  })

  await ctx.tool.transform((draft) => {
    draft.add({
      name: ECHO_TOOL,
      options: { codemode: false },
      description: "Echo text back for verification. Always call this tool when the user asks to echo something.",
      input: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const text = readPrompt(input, "text")
        trace("tool.echo.executed", { text })
        return { content: `echo:${text}` }
      },
    })
    draft.add({
      name: DELEGATE_TOOL,
      options: { codemode: false },
      description:
        "Delegate a task to a helper subagent in a fresh child session and return its final reply. Always call this tool when the user asks to delegate.",
      input: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
        additionalProperties: false,
      },
      execute: async (input, toolCtx) => {
        const prompt = readPrompt(input, "prompt")
        const child = await ctx.session.create({ agent: SUB_AGENT, title: "omo spike child" })
        trace("delegate.created", { parent: toolCtx.sessionID, child: child.id })

        let timeout: ReturnType<typeof setTimeout> | undefined
        const done = new Promise<ChildResult>((resolve) => {
          waiters.set(child.id, { texts: [], resolve })
          timeout = setTimeout(() => {
            if (!waiters.delete(child.id)) return
            void ctx.session.interrupt({ sessionID: child.id }).catch(() => undefined)
            resolve({ ok: false, text: "timeout waiting for child session" })
          }, CHILD_TIMEOUT_MS)
        })
        const settled = done.then((result) => {
          if (timeout !== undefined) clearTimeout(timeout)
          return result
        })

        await ctx.session.prompt({ sessionID: child.id, text: prompt })
        trace("delegate.prompted", { child: child.id })
        const result = await settled
        trace("delegate.finished", { child: child.id, ok: result.ok, length: result.text.length })

        await ctx.session.synthetic({
          sessionID: toolCtx.sessionID,
          text: `<omo-spike> delegate child ${child.id} finished ok=${result.ok}: ${result.text.slice(0, 200)} </omo-spike>`,
          delivery: "queue",
        })
        trace("delegate.synthetic", { parent: toolCtx.sessionID, child: child.id })

        return { content: result.text.length > 0 ? result.text : "child produced no text" }
      },
    })
  })
  trace("tools.registered", { tools: [ECHO_TOOL, DELEGATE_TOOL] })
}
