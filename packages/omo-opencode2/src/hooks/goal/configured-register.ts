import { loadOpenCode2Config } from "../../config"

import { registerGoalFeature } from "./register"
import type { GoalFeatureContext, RegisteredGoalFeature } from "./register"
import type { GoalTrace } from "./types"

export type ConfiguredGoalContext = GoalFeatureContext & {
  readonly options: Readonly<Record<string, unknown>>
}

export type RegisterConfiguredGoalFeatureOptions = {
  readonly directory: string
  readonly trace?: GoalTrace
}

export async function registerConfiguredGoalFeature(
  ctx: ConfiguredGoalContext,
  options: RegisterConfiguredGoalFeatureOptions,
): Promise<RegisteredGoalFeature> {
  const loaded = loadOpenCode2Config({
    directory: options.directory,
    options: { ...ctx.options },
  })
  const enabled = loaded.config.goal?.enabled === true
    && !loaded.config.disabled_hooks?.includes("goal")
  options.trace?.("omo.config.loaded", {
    diagnostics: loaded.diagnostics.length,
    goalEnabled: enabled,
    sources: loaded.sources.length,
  })
  return registerGoalFeature(ctx, {
    directory: options.directory,
    enabled,
    trace: options.trace,
  })
}
