import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Plugin } from "@opencode/plugin"

import { registerConfiguredAgents } from "./agents/register-configured"
import { createCatalogSource } from "./agents/model-resolution"
import { registerBuiltinCommands } from "./commands"
import { TaskRegistry } from "./orchestration/task-registry"
import { ConcurrencyLimiter } from "./orchestration/concurrency"
import { createTaskEngine } from "./orchestration/task-engine"
import type { TaskEngine } from "./orchestration/task-engine"
import type { ChildResult } from "./orchestration/task-engine"
import { createTaskTool } from "./orchestration/task-tool"
import { createBackgroundOutputTool, createBackgroundCancelTool } from "./orchestration/background-tools"
import { TodoStore } from "./orchestration/todo-store"
import { createTodoWriteTool } from "./orchestration/todo-store"
import { registerContextHooks } from "./hooks/register-context-hooks"
import { registerHashlineReadEnhancer } from "./hooks/hashline-read-enhancer"
import { registerHashlineEditTool } from "./tools/hashline-edit"
import { runChildSession } from "./orchestration/child-session"
import { createSessionModelRegistry, registerLookAtTool, LOOK_AT_AGENT } from "./tools/look-at"
import { registerSessionTools } from "./tools/session-manager"
import { registerMonitorTools } from "./tools/monitor/register"
import { registerBtwFeature } from "./features/btw/register"
import { registerConfiguredModelFallback } from "./features/model-fallback"
import { registerTeamMode } from "./features/team-mode"
import { registerWriteExistingFileGuard } from "./hooks/write-existing-file-guard"
import { registerPrometheusMdOnly } from "./hooks/prometheus-md-only"
import { registerCommentChecker } from "./hooks/comment-checker"
import { registerConfiguredGoalFeature } from "./hooks/goal"
import { registerConfiguredTodoContinuation } from "./hooks/todo-continuation"
import { registerConfiguredBoulderContinuation } from "./hooks/boulder-continuation"
import { createSessionDispatchGate } from "./orchestration/session-dispatch-gate"
import { registerSharedSkills } from "./skills"
import { registerBuiltinMcps } from "./mcp/register"

type Trace = (event: string, detail?: Record<string, unknown>) => void

function resolveToolSessionID(toolCtx: unknown): string | undefined {
  if (typeof toolCtx !== "object" || toolCtx === null) return undefined
  const sessionID = Reflect.get(toolCtx, "sessionID")
  return typeof sessionID === "string" ? sessionID : undefined
}

function createTrace(): Trace {
  const file = process.env.OMO_SPIKE_TRACE
  if (!file) return () => undefined
  mkdirSync(dirname(file), { recursive: true })
  return (event, detail) => {
    appendFileSync(file, `${JSON.stringify({ t: Date.now(), event, ...detail })}\n`)
  }
}

type ChildWaiter = { texts: string[]; resolve: (result: ChildResult) => void }

export default Plugin.define({
  id: "omo",
  setup: async (ctx) => {
    const trace = createTrace()
    const workspaceDirectory = process.cwd()
    const registry = new TaskRegistry()
    const limiter = new ConcurrencyLimiter()
    const todoStore = new TodoStore()
    // One gate for the whole plugin. Every feature that injects into a session
    // on an observed idle edge takes THIS instance; a second instance would
    // hand that feature its own lock and let both inject on the same edge.
    const sessionDispatchGate = createSessionDispatchGate()
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
    // resolution reads the populated catalog; a setup-time snapshot would be
    // empty and force every agent onto its first fallback.
    const catalog = createCatalogSource()
    await ctx.catalog.transform((draft) => {
      catalog.capture(draft)
      const snap = catalog.current
      trace("omo.catalog.snapshot", {
        availableModels: snap.availableModels.size,
        visionModels: [...snap.visionModels],
        providers: snap.connectedProviders,
        defaultModel: snap.systemDefaultModel,
      })
    })

    // Phase 1: register the real OMO agent catalog: 11 agents (sisyphus /
    // hephaestus / prometheus / atlas primaries + 7 subagents) plus the
    // delegation categories as subagents. Default agent: sisyphus.
    const { subagents, primaries, categories, sisyphusPrompt, models } = await registerConfiguredAgents(ctx, {
      catalog,
      directory: workspaceDirectory,
      trace,
    })

    trace("omo.registration.complete", {
      primaries: [...primaries],
      subagents: [...subagents],
      categories: [...categories],
    })

    await registerSharedSkills(ctx, trace)
    await registerBuiltinCommands(ctx, trace)
    // Built-in MCP servers ride ctx.mcp.transform (added in beta-17793). A
    // user-defined server entry always wins over the built-in; websearch is
    // deliberately absent because opencode2 ships a native websearch domain.
    await registerBuiltinMcps(ctx, { cwd: workspaceDirectory, trace })
    const goalFeature = await registerConfiguredGoalFeature(ctx, {
      directory: workspaceDirectory,
      gate: sessionDispatchGate,
      trace,
    })
    // Shares the one gate with goal on purpose. Both watch the same idle edge,
    // so a second gate instance would let both inject into the same turn.
    const todoContinuation = await registerConfiguredTodoContinuation(ctx, {
      directory: workspaceDirectory,
      getTodos: (sessionID) => todoStore.get(sessionID),
      gate: sessionDispatchGate,
      trace,
    })
    // The third idle injector on the same shared gate. All three watch the one
    // idle edge; a third gate instance would be the exact double-injection bug
    // PR-4 exists to prevent.
    const boulderContinuation = await registerConfiguredBoulderContinuation(ctx, {
      directory: workspaceDirectory,
      gate: sessionDispatchGate,
      trace,
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

    const modelFallback = await registerConfiguredModelFallback(ctx, {
      directory: workspaceDirectory,
      gate: sessionDispatchGate,
      registry,
      trace,
    })

    const availableSubagents = [...subagents]
    const availableCategories = [...categories]

    const resolveCategory = (category: string): { agent: string; model: string } | undefined => {
      if (!categories.has(category)) return undefined
      const model = models.get(category)
      if (!model) return undefined
      return { agent: category, model }
    }

    await ctx.tool.transform((draft) => {
      const taskTool = createTaskTool({
        ctx,
        registry,
        limiter,
        deps,
        availableSubagents,
        availableCategories,
        categoryModels: models,
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

      const todoTool = createTodoWriteTool({ store: todoStore, trace })
      draft.add({
        name: todoTool.name,
        description: todoTool.description,
        input: todoTool.input,
        options: { codemode: false },
        execute: todoTool.execute,
      })
    })
    
    await registerHashlineEditTool(ctx, trace)
    await registerHashlineReadEnhancer(ctx, trace)

    // look_at gates on the caller's own vision capability, so it needs the
    // per-session model recorded by the context hook below.
    const sessionModels = createSessionModelRegistry()
    await registerLookAtTool({
      ctx,
      catalog,
      sessionModels,
      delegate: async (input) => {
        const result = await runChildSession({
          ctx,
          registry,
          limiter,
          deps,
          parentSessionID: input.parentSessionID,
          agent: LOOK_AT_AGENT,
          model: input.visionModel,
          prompt: input.prompt,
          description: input.description,
          background: false,
        })
        return { ok: result.ok, text: result.text }
      },
      trace,
    })

    // Session history reads opencode2's own SQLite store: the plugin Context
    // exposes no session list or message reader (SessionDomain has neither
    // `list` nor `messages`), so the store is the only route.
    await registerSessionTools(ctx, { directory: workspaceDirectory, trace })

    // BTW side conversations share the task engine's waiter pump so a side
    // answer resolves exactly like a delegated child result. Default off.
    const btwFeature = await registerBtwFeature(ctx, {
      cwd: workspaceDirectory,
      deps,
      resolveSessionID: resolveToolSessionID,
      trace,
    })

    const teamMode = await registerTeamMode(ctx, {
      cwd: workspaceDirectory,
      gate: sessionDispatchGate,
      resolveSessionID: resolveToolSessionID,
      trace,
    })

    // Monitor spawns and owns its own child processes, so the ctx.shell limit
    // does not apply. Default off, and with no allowed_commands it refuses.
    const monitor = await registerMonitorTools(ctx, {
      cwd: workspaceDirectory,
      resolveSessionID: resolveToolSessionID,
      trace,
    })

    trace("omo.orchestration.registered", { tools: ["task", "background_output", "background_cancel", "hashline_edit", "todowrite", "look_at"] })

    await registerWriteExistingFileGuard(ctx, trace)
    await registerPrometheusMdOnly(ctx, trace)
    await registerCommentChecker(ctx, trace)
    trace("omo.tool-guards.registered", { hooks: ["write_existing_file_guard", "prometheus_md_only"] })

    // Phase 3 (context experience): dynamic Sisyphus prompt rebake + ultrawork
    // injection. The static Sisyphus prompt captured by onSisyphusPrompt is the
    // exact text baked at registration; the context hook locates and replaces
    // that system part per request.
    await registerContextHooks({
      ctx,
      staticSisyphusPrompt: sisyphusPrompt ?? "",
      workspaceDirectory,
      todoStore,
      sessionModels,
      trace,
    })
    trace("omo.context-hooks.registered", { staticPromptLength: sisyphusPrompt?.length ?? 0 })

    let todoCleanupDisposed = false
    const todoCleanup = (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (todoCleanupDisposed) return
        if (event.type !== "session.deleted") continue
        const data = (event as { data?: Record<string, unknown> }).data ?? {}
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
        if (sessionID) {
          todoStore.clear(sessionID)
          // Reap the session's watcher processes, or they outlive the session.
          await monitor?.manager.stopSessionMonitors(sessionID)
          trace("omo.todo.cleanup", { sessionID })
        }
      }
    })()
    void todoCleanup

    return () => {
      todoCleanupDisposed = true
      goalFeature.dispose()
      todoContinuation.dispose()
      boulderContinuation.dispose()
      modelFallback.dispose()
      engine.dispose()
      void monitor?.dispose()
      void btwFeature?.dispose()
      teamMode?.dispose()
    }
  },
})
