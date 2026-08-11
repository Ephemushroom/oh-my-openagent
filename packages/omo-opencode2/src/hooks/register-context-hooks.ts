import type { Context } from "@opencode-ai/plugin/promise/plugin"

import { rebakeSisyphusSystemPart } from "./sisyphus-context"
import type { LiveAgent, LiveSkill } from "./sisyphus-context"
import { detectUltraworkIntent, injectUltraworkSystemPart } from "./ultrawork-context"

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

    // Step 2: ultrawork injection (second; only on the final real user turn).
    let userText = ""
    try {
      userText = await options.lastUserText(event.messages)
    } catch {
      userText = ""
    }
    if (detectUltraworkIntent(userText)) {
      const injected = injectUltraworkSystemPart(event.system, { agent: event.agent, model: `${event.model.providerID}/${event.model.id}` })
      event.system = injected.system
    }

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
 * Registers the production context hooks (dynamic sisyphus rebake + ultrawork
 * injection) on the session context hook. Non-fatal on live catalog failure.
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
      lastUserText: lastRealUserText,
    })

    const output = await composer(event as unknown as HookEvent)
    trace?.("omo.context.composed", {
      systemParts: output.system.length,
      modeTagged: output.system.some((part) => part.text?.includes("<ultrawork-mode>")),
    })
  })
}
