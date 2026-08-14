import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Plugin } from "@opencode-ai/plugin"

import { registerCategories } from "./agents/register-categories"
import { registerPrimaries } from "./agents/register-primaries"
import { registerSubagents } from "./agents/register-subagents"
import { createCatalogSource, resolveAgentModel } from "./agents/model-resolution"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"
import { registerBuiltinCommands } from "./commands"
import { TaskRegistry } from "./orchestration/task-registry"
import { ConcurrencyLimiter } from "./orchestration/concurrency"
import { createTaskEngine } from "./orchestration/task-engine"
import type { TaskEngine } from "./orchestration/task-engine"
import type { ChildResult } from "./orchestration/task-engine"
import { createTaskTool } from "./orchestration/task-tool"
import { createBackgroundOutputTool, createBackgroundCancelTool } from "./orchestration/background-tools"
import { registerContextHooks } from "./hooks/register-context-hooks"
import { registerHashlineReadEnhancer } from "./hooks/hashline-read-enhancer"
import { registerHashlineEditTool } from "./tools/hashline-edit"
import { registerWriteExistingFileGuard } from "./hooks/write-existing-file-guard"
import { registerPrometheusMdOnly } from "./hooks/prometheus-md-only"
import { registerCommentChecker } from "./hooks/comment-checker"
import { registerConfiguredGoalFeature } from "./hooks/goal"
import { registerSharedSkills } from "./skills"

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

export default Plugin.define({
  id: "omo",
  setup: async (ctx) => {
    const trace = createTrace()
    const workspaceDirectory = process.cwd()
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
    // resolution reads the populated catalog; a setup-time snapshot would be
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

    // Phase 1: register the real OMO agent catalog: 11 agents (sisyphus /
    // hephaestus / prometheus / atlas primaries + 7 subagents) plus the
    // delegation categories as subagents. Default agent: sisyphus.
    let capturedStaticSisyphusPrompt: string | undefined
    const onSisyphusPrompt = (prompt: string): void => {
      capturedStaticSisyphusPrompt = prompt
    }
    const subagents = await registerSubagents(ctx, { trace, catalog })
    const primaries = await registerPrimaries(ctx, { trace, defaultAgent: "sisyphus", catalog, onSisyphusPrompt })
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

    await registerSharedSkills(ctx, trace)
    await registerBuiltinCommands(ctx, trace)
    const goalFeature = await registerConfiguredGoalFeature(ctx, {
      directory: workspaceDirectory,
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
    
    await registerHashlineEditTool(ctx, trace)
    await registerHashlineReadEnhancer(ctx, trace)
    
    trace("omo.orchestration.registered", { tools: ["task", "background_output", "background_cancel", "hashline_edit"] })

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
      staticSisyphusPrompt: capturedStaticSisyphusPrompt ?? "",
      workspaceDirectory,
      trace,
    })
    trace("omo.context-hooks.registered", { staticPromptLength: capturedStaticSisyphusPrompt?.length ?? 0 })

    return () => {
      goalFeature.dispose()
      engine.dispose()
    }
  },
})
