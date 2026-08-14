import type { Context } from "@opencode-ai/plugin/promise/plugin"

import { injectCommandCatalogSystemPart } from "./command-catalog-context"
import type { LiveCommand } from "./command-catalog-context"
import { injectSkillCatalogSystemPart } from "./skill-catalog-context"
import { rebakeSisyphusSystemPart } from "./sisyphus-context"
import type { LiveAgent, LiveSkill } from "./sisyphus-context"
import { detectKeywordModes, injectKeywordSystemParts } from "./ultrawork-context"

export interface ContextHookDeps {
  ctx: Context
  staticSisyphusPrompt: string
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
  staticSisyphusPrompt: string
  agentList: () => Promise<LiveAgent[]>
  skillList: () => Promise<LiveSkill[]>
  commandList: () => Promise<LiveCommand[]>
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

    // Step 2: expose concise registered skill and command catalogs.
    event.system = injectSkillCatalogSystemPart(event.system, skillList ?? [])
    try {
      event.system = injectCommandCatalogSystemPart(event.system, await options.commandList())
    } catch {
      event.system = injectCommandCatalogSystemPart(event.system, [])
    }

    // Step 3: keyword mode injection (last; only on the final real user turn).
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
  const { ctx, staticSisyphusPrompt, trace } = deps

  await ctx.session.hook("context", async (event) => {
    const composer = createContextHookComposer({
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
      lastUserText: lastRealUserText,
    })

    const output = await composer(event as unknown as HookEvent)
    const ultraworkParts = output.system.filter((part) => part.text?.includes("<ultrawork-mode>")).length
    const hyperplanParts = output.system.filter((part) => part.text?.includes("<hyperplan-mode>")).length
    const hyperplanUltraworkParts = output.system.filter((part) =>
      part.text?.includes("<hyperplan-ultrawork-mode>"),
    ).length
    trace?.("omo.context.composed", {
      sessionID: (event as unknown as { sessionID?: string }).sessionID,
      systemParts: output.system.length,
      modeTagged: ultraworkParts + hyperplanParts + hyperplanUltraworkParts > 0,
      ultraworkParts,
      hyperplanParts,
      hyperplanUltraworkParts,
    })
  })
}
