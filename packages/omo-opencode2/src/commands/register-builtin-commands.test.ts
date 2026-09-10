import { describe, expect, test } from "bun:test"

import type { CommandDraft } from "@opencode-ai/plugin/promise/command"

import { registerBuiltinCommands } from "./register-builtin-commands"
import type { BuiltinCommandsRegistrationContext } from "./register-builtin-commands"

type CommandInfo = NonNullable<ReturnType<CommandDraft["get"]>>

const EXPECTED_COMMANDS = [
  "goal",
  "refactor",
  "ulw-execute",
  "stop-continuation",
  "handoff",
  "remove-ai-slops",
  "hyperplan",
] as const

describe("registerBuiltinCommands", () => {
  test("#given an empty command catalog #when registering #then all builtin commands are upserted", async () => {
    // given
    const commands = new Map<string, CommandInfo>()
    const draft: CommandDraft = {
      list: () => [...commands.values()],
      get: (name) => commands.get(name),
      update: (name, update) => {
        const command = commands.get(name) ?? { name, template: "" }
        update(command)
        commands.set(name, command)
      },
      remove: (name) => {
        commands.delete(name)
      },
    }
    const context: BuiltinCommandsRegistrationContext = {
      command: {
        transform: async (callback) => {
          callback(draft)
          return { dispose: async () => undefined }
        },
      },
    }

    // when
    await registerBuiltinCommands(context)

    // then
    expect([...commands.keys()]).toEqual([...EXPECTED_COMMANDS])
    for (const command of commands.values()) {
      expect(command.template.length).toBeGreaterThan(0)
      expect(command.description?.length).toBeGreaterThan(0)
    }
    expect(commands.get("ulw-execute")?.agent).toBe("atlas")
  })
})
