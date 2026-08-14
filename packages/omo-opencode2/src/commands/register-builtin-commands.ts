import type { CommandDraft } from "@opencode-ai/plugin/promise/command"

import { BUILTIN_COMMAND_DEFINITIONS } from "./builtin-command-definitions"

export interface BuiltinCommandsRegistrationContext {
  readonly command: {
    readonly transform: (callback: (draft: CommandDraft) => void) => Promise<unknown>
  }
}

export async function registerBuiltinCommands(
  ctx: BuiltinCommandsRegistrationContext,
  trace?: (event: string, detail?: Record<string, unknown>) => void,
): Promise<void> {
  await ctx.command.transform((draft) => {
    for (const definition of BUILTIN_COMMAND_DEFINITIONS) {
      draft.update(definition.name, (command) => {
        command.name = definition.name
        command.description = definition.description
        command.template = definition.template
        command.subtask = definition.subtask ?? false
        if (definition.agent === undefined) {
          delete command.agent
        } else {
          command.agent = definition.agent
        }
      })
    }
  })

  trace?.("omo.commands.registered", {
    commands: BUILTIN_COMMAND_DEFINITIONS.map((definition) => definition.name),
  })
}
