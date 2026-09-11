import type { Context } from "@opencode/plugin/promise/plugin"

import { createSessionTools, type SessionToolsOptions } from "./tools"

type Trace = (event: string, detail?: Record<string, unknown>) => void

export type RegisterSessionToolsOptions = SessionToolsOptions & { readonly trace?: Trace }

/** Adds session_list / session_read / session_search / session_info to the registry. */
export async function registerSessionTools(ctx: Context, options: RegisterSessionToolsOptions): Promise<void> {
  const tools = createSessionTools(options)

  await ctx.tool.transform((draft) => {
    for (const tool of tools) {
      draft.add({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        options: { codemode: false },
        execute: tool.execute,
      })
    }
  })

  options.trace?.("omo.session-tools.registered", { tools: tools.map((tool) => tool.name) })
}
