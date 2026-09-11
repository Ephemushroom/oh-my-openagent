import { Agent } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"

import { BUILTIN_COMMAND_DEFINITIONS } from "./builtin-command-definitions"
import { renderCommandTemplate } from "./render-command-template"

export interface BuiltinCommandsRegistrationContext {
  readonly command: Pick<Context["command"], "transform">
  readonly agent: {
    readonly get: (input: Parameters<Context["agent"]["get"]>[0]) => Promise<{
      readonly data?: Pick<Awaited<ReturnType<Context["agent"]["get"]>>["data"], "model">
    }>
  }
  readonly session: {
    readonly get: (input: Parameters<Context["session"]["get"]>[0]) => Promise<Pick<Awaited<ReturnType<Context["session"]["get"]>>, "agent">>
    readonly switchAgent: (input: Parameters<Context["session"]["switchAgent"]>[0]) => Promise<unknown>
    readonly switchModel: (input: Parameters<Context["session"]["switchModel"]>[0]) => Promise<unknown>
    readonly prompt: (input: Parameters<Context["session"]["prompt"]>[0]) => Promise<unknown>
  }
}

export async function registerBuiltinCommands(
  ctx: BuiltinCommandsRegistrationContext,
  trace?: (event: string, detail?: Record<string, unknown>) => void,
): Promise<void> {
  await ctx.command.transform((editor) => {
    for (const definition of BUILTIN_COMMAND_DEFINITIONS) {
      editor.add({
        name: definition.name,
        description: definition.description,
        execute: async (input) => {
          const text = renderCommandTemplate(definition.template, {
            text: input.prompt.text, sessionID: input.sessionID, timestamp: new Date().toISOString(),
          })
          if (definition.agent !== undefined) {
            const agentID = Agent.ID.make(definition.agent)
            const selected = await ctx.agent.get({ agentID })
            const session = await ctx.session.get({ sessionID: input.sessionID })
            if (session.agent !== agentID) await ctx.session.switchAgent({ sessionID: input.sessionID, agent: agentID })
            if (selected.data?.model !== undefined) {
              await ctx.session.switchModel({ sessionID: input.sessionID, model: selected.data.model })
            }
          }
          await ctx.session.prompt({ ...input.prompt, sessionID: input.sessionID, text, delivery: input.delivery })
          trace?.("omo.command.invoked", { name: definition.name, sessionID: input.sessionID })
        },
      })
    }
  })

  trace?.("omo.commands.registered", {
    commands: BUILTIN_COMMAND_DEFINITIONS.map((definition) => definition.name),
  })
}
