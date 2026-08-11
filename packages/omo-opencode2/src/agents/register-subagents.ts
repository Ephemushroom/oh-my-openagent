import type { Context } from "@opencode-ai/plugin/promise/plugin"
import { Agent, Model } from "@opencode-ai/plugin"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"

import { SUBAGENT_DEFINITIONS } from "./agent-catalog"
import { resolveAgentModel, snapshotCatalog } from "./model-resolution"

export interface RegisterAgentsOptions {
  /** System default model applied when an agent's chain yields nothing. */
  systemDefaultModel?: string;
  /** Optional per-agent trace hook (QA evidence; records resolved model/mode). */
  trace?: (event: string, detail?: Record<string, unknown>) => void;
}

/**
 * Register the OMO subagent catalog with OpenCode 2.
 *
 * Captures the model catalog once (catalog transform) and upserts each agent in
 * a single agent.transform callback (update is an upsert in v2). Sisyphus,
 * Hephaestus, Prometheus, and Atlas are registered separately by callers that
 * can supply their richer runtime context.
 *
 * Returns the list of agent ids actually registered (agents whose model
 * requirement could not be satisfied are skipped).
 */
export async function registerSubagents(
  ctx: Context,
  options: RegisterAgentsOptions = {},
): Promise<string[]> {
  const snapshot = await snapshotCatalog(ctx)
  const effectiveDefault = options.systemDefaultModel ?? snapshot.systemDefaultModel
  const registered: string[] = []

  await ctx.agent.transform((draft) => {
    for (const def of SUBAGENT_DEFINITIONS) {
      const requirement = AGENT_MODEL_REQUIREMENTS[def.id]
      const resolved = resolveAgentModel(requirement, snapshot, effectiveDefault)
      if (!resolved) continue

      const systemPrompt = def.buildPrompt(resolved.model)
      draft.update(def.id, (agent) => {
        agent.name = Agent.Name.make(def.name)
        agent.description = def.description
        agent.mode = def.mode
        if (def.hidden !== undefined) agent.hidden = def.hidden
        if (def.color !== undefined) agent.color = def.color
        agent.system = systemPrompt

        if (resolved.model.includes("/")) {
          agent.model = Model.Ref.parse(resolved.model) as typeof agent.model
          if (resolved.variant !== undefined && agent.model) {
            agent.model.variant = Model.VariantID.make(resolved.variant)
          }
        }

        agent.permissions = def.permissions.map((rule) => ({
          action: rule.action,
          resource: rule.resource,
          effect: rule.effect,
        }))

        const body: Record<string, unknown> = {}
        if (def.request?.temperature !== undefined) body.temperature = def.request.temperature
        if (def.request?.maxOutputTokens !== undefined) {
          body.max_output_tokens = def.request.maxOutputTokens
        }
        if (Object.keys(body).length > 0) {
          agent.request.body = { ...agent.request.body, ...body }
        }
      })

      registered.push(def.id)
      options.trace?.("omo.agent.registered", {
        id: def.id,
        mode: def.mode,
        model: resolved.model,
        variant: resolved.variant,
        systemLength: systemPrompt.length,
      })
    }
  })

  return registered
}
