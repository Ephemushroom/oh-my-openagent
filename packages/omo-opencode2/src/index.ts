import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Plugin } from "@opencode-ai/plugin"
import type { Context } from "@opencode-ai/plugin/promise/plugin"

import { registerCategories } from "./agents/register-categories"
import { registerPrimaries } from "./agents/register-primaries"
import { registerSubagents } from "./agents/register-subagents"

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

type ChildResult = { ok: boolean; text: string }
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
    const probe = createEventPump(ctx, trace)

    // Phase 1: register the real OMO agent catalog — 11 agents (sisyphus /
    // hephaestus / prometheus / atlas primaries + 7 subagents) plus the
    // delegation categories as subagents, models resolved from the live v2
    // catalog through model-core. Default agent: sisyphus.
    const subagents = await registerSubagents(ctx, { trace })
    const primaries = await registerPrimaries(ctx, { trace, defaultAgent: "sisyphus" })
    const categories = await registerCategories(ctx, { trace })
    trace("omo.registration.complete", { primaries, subagents, categories })

    // Phase 0 mechanics probe (echo/context/delegate/synthetic verification
    // tools + agents). Gated off in production; QA enables it explicitly.
    if (process.env.OMO_SPIKE_MECHANICS === "1") {
      await setupMechanicsProbe(ctx, trace, probe)
    }

    return () => probe.dispose()
  },
})

interface EventPump {
  waiters: Map<string, ChildWaiter>
  dispose: () => void
}

/**
 * Always-on session-event pump. When OMO_SPIKE_TRACE is set it records every
 * event for QA; it also fulfils the delegate tool's child-session waiters.
 * Independent of the gated mechanics probe so production registration can be
 * observed without enabling omo-spike.
 */
function createEventPump(ctx: Context, trace: Trace): EventPump {
  const waiters = new Map<string, ChildWaiter>()
  let disposed = false

  const pump = (async () => {
    for await (const event of ctx.event.subscribe()) {
      if (disposed) return
      const data = (event as { data?: Record<string, unknown> }).data ?? {}
      const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
      trace("event", { type: event.type, sessionID })
      if (!sessionID) continue
      const waiter = waiters.get(sessionID)
      if (!waiter) continue
      if (event.type === "session.text.ended" || event.type === "session.reasoning.ended") {
        if (typeof data.text === "string") waiter.texts.push(data.text)
        continue
      }
      if (event.type === "session.execution.failed") {
        waiters.delete(sessionID)
        waiter.resolve({ ok: false, text: `execution failed: ${JSON.stringify(data.error ?? null)}` })
        continue
      }
      if (
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.interrupted" ||
        event.type === "session.idle"
      ) {
        waiters.delete(sessionID)
        waiter.resolve({ ok: event.type !== "session.execution.interrupted", text: waiter.texts.join("\n") })
      }
    }
  })()
  pump.catch((error: unknown) => trace("event-pump.error", { message: String(error) }))

  return {
    waiters,
    dispose: () => {
      disposed = true
      for (const [sessionID, waiter] of waiters) {
        waiters.delete(sessionID)
        waiter.resolve({ ok: false, text: "plugin disposed" })
      }
    },
  }
}

async function setupMechanicsProbe(ctx: Context, trace: Trace, probe: EventPump): Promise<void> {
  const waiters = probe.waiters

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
