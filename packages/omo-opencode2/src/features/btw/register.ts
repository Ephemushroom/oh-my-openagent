import type { Context } from "@opencode/plugin/promise/plugin"

import { createBtwTools } from "./tools"
import { registerBtwToolGuard } from "./tool-guard"
import { loadOpenCode2Config } from "../../config"
import type { ChildSessionDeps } from "../../orchestration/child-session"

type Trace = (event: string, detail?: Record<string, unknown>) => void

export interface RegisterBtwOptions {
  readonly cwd: string
  readonly deps: ChildSessionDeps
  readonly resolveSessionID: (toolCtx: unknown) => string | undefined
  readonly trace?: Trace
}

export interface BtwRegistration {
  readonly dispose: () => void
}

/**
 * Registers the BTW side-conversation tools (btw_start / btw_reply /
 * btw_list) plus the context-hook guard that blocks delegation tools inside
 * side sessions. Gated on `btw.enabled` under `[opencode2]` (default off);
 * `disabled_hooks` respects the name `btw`.
 */
export async function registerBtwFeature(
  ctx: Context,
  options: RegisterBtwOptions,
): Promise<BtwRegistration | undefined> {
  const loaded = loadOpenCode2Config({ directory: options.cwd, options: { ...ctx.options } })
  const disabled = loaded.config.disabled_hooks?.includes("btw") === true
  if (!loaded.config.btw?.enabled || disabled) {
    options.trace?.("omo.btw.disabled", {
      reason: disabled ? "listed in disabled_hooks" : "btw.enabled is not true",
    })
    return undefined
  }

  await registerBtwToolGuard(ctx, options.trace)

  const tools = createBtwTools({
    ctx,
    deps: options.deps,
    cwd: options.cwd,
    resolveSessionID: options.resolveSessionID,
    trace: options.trace,
  })

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

  options.trace?.("omo.btw.registered", { tools: tools.map((tool) => tool.name) })
  return { dispose: () => undefined }
}
