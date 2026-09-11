import type { Context } from "@opencode/plugin/promise/plugin"

import { injectCommandCatalogSystemPart } from "./command-catalog-context"
import type { LiveCommand } from "./command-catalog-context"
import { injectSkillCatalogSystemPart } from "./skill-catalog-context"
import { loadProjectRulesContext } from "./rules-context"
import type { ProjectRulesContext } from "./rules-context"
import { rebakeSisyphusSystemPart } from "./sisyphus-context"
import type { LiveAgent, LiveSkill } from "./sisyphus-context"
import { detectKeywordModes, injectKeywordSystemParts } from "./ultrawork-context"
import { injectTodoStateSystemPart } from "../orchestration/todo-store"
import type { TodoStore } from "../orchestration/todo-store"
import { formatModelKey } from "../tools/look-at"
import type { SessionModelRegistry } from "../tools/look-at"

export interface ContextHookDeps {
  ctx: Context
  staticSisyphusPrompt: string
  workspaceDirectory: string
  todoStore?: TodoStore
  /** Fed with the caller's model on every request so `look_at` can gate on it. */
  sessionModels?: SessionModelRegistry
  trace?: (event: string, detail?: Record<string, unknown>) => void
}

interface SystemPartLike {
  type: string
  text?: string
  [key: string]: unknown
}

interface HookEvent {
  sessionID: string
  agent: string
  model: { id: string; providerID: string; variant?: string }
  system: SystemPartLike[]
  messages: Array<{ role?: string; content?: Array<{ type: string; text?: string }> }>
  tools: Record<string, { description?: string; input?: unknown }>
}

interface ComposerOptions {
  trace?: ContextHookDeps["trace"]
  staticSisyphusPrompt: string
  agentList: () => Promise<LiveAgent[]>
  skillList: () => Promise<LiveSkill[]>
  commandList: () => Promise<LiveCommand[]>
  projectContext?: () => Promise<ProjectRulesContext>
  todoItems?: (sessionID: string) => readonly import("../orchestration/todo-store").TodoItem[]
  lastUserText: (messages: HookEvent["messages"]) => Promise<string>
}

export function createContextHookComposer(options: ComposerOptions): (event: HookEvent) => Promise<HookEvent> {
  return async (event) => {
    // Step 1: dynamic sisyphus rebake (first).
    let agentList: LiveAgent[] | undefined
    let agentListError: unknown
    let skillList: LiveSkill[] | undefined
    let skillListError: unknown
    try {
      agentList = await options.agentList()
    } catch (error) {
      agentListError = error
    }
    try {
      skillList = await options.skillList()
    } catch (error) {
      skillListError = error
    }

    const rebaked = rebakeSisyphusSystemPart({
      model: `${event.model.providerID}/${event.model.id}`,
      staticSisyphusPrompt: options.staticSisyphusPrompt,
      system: event.system,
      tools: event.tools,
      agentList,
      agentListError,
      skillList,
      skillListError,
    })
    event.system = rebaked.system
    options.trace?.("omo.context.sisyphus", { sessionID: event.sessionID, agent: event.agent, rebaked: rebaked.rebaked })

    // Step 2: expose concise registered skill and command catalogs.
    event.system = injectSkillCatalogSystemPart(event.system, skillList ?? [])
    try {
      event.system = injectCommandCatalogSystemPart(event.system, await options.commandList())
    } catch {
      event.system = injectCommandCatalogSystemPart(event.system, [])
    }

    // Step 3: project rules and AGENTS.md join this same context pipeline.
    if (options.projectContext !== undefined) {
      try {
        const projectContext = await options.projectContext()
        for (const part of projectContext.systemParts) {
          if (event.system.some((existing) => existing.type === part.type && existing.text === part.text)) continue
          event.system.push({ ...part })
        }
      } catch {
        // Context discovery is advisory; catalog and keyword context still apply.
      }
    }

    // Step 4: todo state (survives compaction; re-injected every request).
    if (options.todoItems !== undefined) {
      const items = options.todoItems(event.sessionID)
      event.system = injectTodoStateSystemPart(event.system, items)
    }

    // Step 5: keyword mode injection (last; only on the final real user turn).
    // Mode directives are appended as system parts for model context.
    let userText = ""
    try {
      userText = await options.lastUserText(event.messages)
    } catch {
      userText = ""
    }
    const modes = detectKeywordModes(userText)
    event.system = injectKeywordSystemParts(event.system, modes, {
      agent: event.agent,
      model: `${event.model.providerID}/${event.model.id}`,
    })

    return event
  }
}

/**
 * Returns the text of the last real user turn (v2 messages tail). Synthetic /
 * internal-only messages are skipped.
 */
export async function lastRealUserText(messages: HookEvent["messages"]): Promise<string> {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "user") continue
    const texts = (message.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
    if (texts.length > 0) return texts.join(" ")
  }
  return ""
}

/**
 * Registers dynamic Sisyphus rebaking and keyword-mode injection on the
 * session context hook. Non-fatal on live catalog failure.
 */
export async function registerContextHooks(deps: ContextHookDeps): Promise<void> {
  const { ctx, staticSisyphusPrompt, trace, workspaceDirectory, todoStore, sessionModels } = deps

  await ctx.session.hook("context", async (event) => {
    // The context hook is the only surface that reports the caller's model
    // alongside its session id, so it is where look_at's gate gets its input.
    const modelKey = formatModelKey(event.model)
    if (modelKey) sessionModels?.record(event.sessionID as unknown as string, modelKey)

    const composer = createContextHookComposer({
      trace,
      staticSisyphusPrompt,
      agentList: async () => {
        const agents = await ctx.agent.list()
        const data = (agents as { data?: Array<{ id: string; name?: string; description?: string; mode?: string }> }).data ?? []
        trace?.("omo.context.agents", { count: data.length })
        return data.map((agent) => ({
          id: agent.id,
          name: agent.name ?? agent.id,
          description: agent.description ?? "",
          mode: agent.mode,
        }))
      },
      skillList: async () => {
        const skills = await ctx.skill.list()
        const data = (skills as { data?: Array<{ name: string; description?: string; location?: string }> }).data ?? []
        trace?.("omo.context.skills", { count: data.length })
        return data.map((skill) => ({
          name: skill.name,
          description: skill.description ?? "",
          location: skill.location,
        }))
      },
      commandList: async () => {
        const commands = await ctx.command.list()
        trace?.("omo.context.commands", { count: commands.data.length })
        return commands.data.map((command) => ({
          name: command.name,
          description: command.description,
        }))
      },
      projectContext: async () => {
        try {
          const projectContext = await loadProjectRulesContext(workspaceDirectory)
          trace?.("omo.context.rules", {
            sessionID: event.sessionID,
            injected: projectContext.systemParts.length > 0,
            ruleFiles: projectContext.ruleFiles,
            agentsFiles: projectContext.agentsFiles,
            systemParts: projectContext.systemParts.length,
            diagnostics: projectContext.diagnostics,
          })
          return projectContext
        } catch {
          trace?.("omo.context.rules", {
            sessionID: event.sessionID,
            injected: false,
            ruleFiles: 0,
            agentsFiles: 0,
            systemParts: 0,
            diagnostics: 1,
          })
          return {
            systemParts: [],
            ruleFiles: 0,
            agentsFiles: 0,
            diagnostics: 1,
          }
        }
      },
      todoItems: todoStore ? (sessionID: string) => todoStore.get(sessionID) : undefined,
      lastUserText: lastRealUserText,
    })

    const output = await composer(event as unknown as HookEvent)
    const ultraworkParts = output.system.filter((part) => part.text?.includes("<ultrawork-mode>")).length
    const hyperplanParts = output.system.filter((part) => part.text?.includes("<hyperplan-mode>")).length
    const hyperplanUltraworkParts = output.system.filter((part) =>
      part.text?.includes("<hyperplan-ultrawork-mode>"),
    ).length
    const todoParts = output.system.filter((part) => part.text?.includes("<todo-state>")).length
    trace?.("omo.context.composed", {
      sessionID: (event as unknown as { sessionID?: string }).sessionID,
      systemParts: output.system.length,
      modeTagged: ultraworkParts + hyperplanParts + hyperplanUltraworkParts > 0,
      ultraworkParts,
      hyperplanParts,
      hyperplanUltraworkParts,
      todoParts,
    })
  })
}
