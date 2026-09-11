import type { Context } from "@opencode/plugin/promise/plugin"

import { loadOpenCode2Config } from "../../config"
import { resolveMonitorConfig } from "../../features/monitor/config"
import { MonitorDelivery } from "../../features/monitor/delivery"
import { MonitorManager } from "../../features/monitor/manager"
import { createMonitorTools } from "./tools"

type Trace = (event: string, detail?: Record<string, unknown>) => void

export interface RegisterMonitorToolsOptions {
  readonly cwd: string
  readonly resolveSessionID: (toolCtx: unknown) => string | undefined
  readonly trace?: Trace
}

export interface MonitorRegistration {
  readonly manager: MonitorManager
  readonly dispose: () => Promise<void>
}

/**
 * Registers monitor_start / monitor_stop / monitor_list / monitor_output.
 * Returns undefined when `monitor.enabled` is not true, so the tools are absent
 * from the registry rather than present-and-refusing.
 */
export async function registerMonitorTools(
  ctx: Context,
  options: RegisterMonitorToolsOptions,
): Promise<MonitorRegistration | undefined> {
  const loaded = loadOpenCode2Config({ directory: options.cwd, options: { ...ctx.options } })
  const config = resolveMonitorConfig(loaded.config.monitor)
  const disabled = loaded.config.disabled_hooks?.includes("monitor") === true
  if (!config.enabled || disabled) {
    options.trace?.("omo.monitor.disabled", {
      reason: disabled ? "listed in disabled_hooks" : "monitor.enabled is not true",
    })
    return undefined
  }

  const delivery = new MonitorDelivery({ ctx, ...(options.trace ? { trace: options.trace } : {}) })
  const manager = new MonitorManager({ config, delivery, cwd: options.cwd })
  const tools = createMonitorTools({ manager, config, resolveSessionID: options.resolveSessionID })

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

  options.trace?.("omo.monitor.registered", {
    tools: tools.map((tool) => tool.name),
    allowedCommands: config.allowed_commands ?? [],
    maxMonitorsPerSession: config.max_monitors_per_session,
  })

  return { manager, dispose: () => manager.shutdown() }
}
