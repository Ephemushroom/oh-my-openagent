import type { Context } from "@opencode-ai/plugin/promise/plugin"
import { Agent, Model } from "@opencode-ai/plugin"
import {
  buildFallbackSisyphusPrompt,
  buildClaudeFable5SisyphusPrompt,
  buildClaudeOpus47SisyphusPrompt,
  buildClaudeOpus48SisyphusPrompt,
  buildClaudeOpus5SisyphusPrompt,
  buildGlm52SisyphusPrompt,
  buildGpt54SisyphusPrompt,
  buildGpt55SisyphusPrompt,
  buildKimiK26SisyphusPrompt,
  buildKimiK27SisyphusPrompt,
  buildKimiK3SisyphusPrompt,
  buildDynamicHephaestusPrompt,
  isHephaestusSupportedModel,
  isClaudeFable5Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isClaudeOpus5Model,
  isGlmModel,
  isGpt5_5Model,
  isGpt5_6Model,
  isGptNativeSisyphusModel,
  isKimiK2Model,
  isKimiK27Model,
  isKimiK3Model,
} from "@oh-my-opencode/agents-core"
import { atlasPromptVariants, loadPromptSync, resolveVariant } from "@oh-my-opencode/prompts-core"
import { getPrometheusPrompt } from "./prometheus"

import { resolveAgentModel } from "./model-resolution"
import type { CatalogSource } from "./model-resolution"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"

const PRIMARY = "primary"

interface PrimaryDefinition {
  id: string;
  description: string;
  color?: string;
  temperature?: number;
  maxOutputTokens?: number;
  buildPrompt: (model: string) => string;
  /** v1 parity: agent only registers when the resolved model satisfies this. */
  supportsModel?: (model: string) => boolean;
}

/**
 * Sisyphus prompt for a resolved model, with empty runtime catalogs. Routes to
 * the model-family prompt exactly like v1's resolveSisyphusPromptFamily; the
 * dynamic agent/skill/category sections degrade to empty strings (full dynamic
 * injection arrives with the Phase 2 orchestration layer).
 */
function buildSisyphusBase(model: string): string {
  if (isKimiK3Model(model)) return buildKimiK3SisyphusPrompt(model, [], [], [], [], false)
  if (isKimiK27Model(model)) return buildKimiK27SisyphusPrompt(model, [], [], [], [], false)
  if (isKimiK2Model(model)) return buildKimiK26SisyphusPrompt(model, [], [], [], [], false)
  if (isGpt5_5Model(model) || isGpt5_6Model(model)) return buildGpt55SisyphusPrompt(model, [], [], [], [], false)
  if (isGptNativeSisyphusModel(model)) return buildGpt54SisyphusPrompt(model, [], [], [], [], false)
  if (isClaudeFable5Model(model)) return buildClaudeFable5SisyphusPrompt(model, [], [], [], [], false)
  if (isClaudeOpus5Model(model)) return buildClaudeOpus5SisyphusPrompt(model, [], [], [], [], false)
  if (isClaudeOpus48Model(model)) return buildClaudeOpus48SisyphusPrompt(model, [], [], [], [], false)
  if (isClaudeOpus47Model(model)) return buildClaudeOpus47SisyphusPrompt(model, [], [], [], [], false)
  if (isGlmModel(model)) return buildGlm52SisyphusPrompt(model, [], [], [], [], false)
  return buildFallbackSisyphusPrompt(model, [], [], [], [], false)
}

function buildAtlasBase(model: string): string {
  const source = resolveVariant({ agentName: "atlas", modelID: model, variants: atlasPromptVariants })
  const variant = (
    Object.prototype.hasOwnProperty.call(atlasPromptVariants, source) ? source : "default"
  ) as keyof typeof atlasPromptVariants
  return loadPromptSync({ source: atlasPromptVariants[variant], name: "atlas", variant }).body
}

const PRIMARIES: PrimaryDefinition[] = [
  {
    id: "sisyphus",
    description:
      "Powerful AI orchestrator. Plans obsessively with todos, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses explore for internal code (parallel-friendly), librarian for external docs. (Sisyphus - OhMyOpenCode)",
    color: "#00CED1",
    buildPrompt: buildSisyphusBase,
  },
  {
    id: "hephaestus",
    description:
      "Autonomous Deep Worker - goal-oriented execution with GPT Codex. Explores thoroughly before acting, uses explore/librarian agents for comprehensive context, completes tasks end-to-end. Inspired by AmpCode deep mode. (Hephaestus - OhMyOpenCode)",
    color: "#D97706",
    maxOutputTokens: 32000,
    buildPrompt: (model) => buildDynamicHephaestusPrompt({ model }),
    supportsModel: isHephaestusSupportedModel,
  },
  {
    id: "prometheus",
    description: "Plan agent (Prometheus - OhMyOpenCode)",
    color: "#FF5722",
    buildPrompt: () => getPrometheusPrompt(),
  },
  {
    id: "atlas",
    description:
      "Orchestrates work via task() to complete ALL tasks in a todo list until fully done. (Atlas - OhMyOpenCode)",
    color: "#10B981",
    temperature: 0.1,
    buildPrompt: buildAtlasBase,
  },
]

/**
 * Register the primary OMO agents (sisyphus / hephaestus / prometheus / atlas)
 * with OpenCode 2, and set the harness default + downgrade the built-in `build`
 * agent to a hidden subagent (matching the v1 adapter's behaviour).
 */
export async function registerPrimaries(
  ctx: Context,
  options: {
    catalog: CatalogSource;
    systemDefaultModel?: string;
    defaultAgent?: string;
    trace?: (event: string, detail?: Record<string, unknown>) => void;
  },
): Promise<Set<string>> {
  const registered = new Set<string>()

  await ctx.agent.transform((draft) => {
    const snapshot = options.catalog.current
    const effectiveDefault = options.systemDefaultModel ?? snapshot.systemDefaultModel
    for (const def of PRIMARIES) {
      const requirement = AGENT_MODEL_REQUIREMENTS[def.id]
      const resolved = resolveAgentModel(requirement, snapshot, effectiveDefault)
      if (!resolved) continue

      // v1 parity: an agent with a model-support predicate is skipped (not
      // registered) when the resolved model fails it — e.g. Hephaestus is
      // GPT-5.x-only and never falls back onto a non-GPT system default.
      if (def.supportsModel && !def.supportsModel(resolved.model)) {
        options.trace?.("omo.agent.skipped", {
          id: def.id,
          reason: "unsupported-model",
          model: resolved.model,
        })
        continue
      }

      const systemPrompt = def.buildPrompt(resolved.model)
      draft.update(def.id, (agent) => {
        agent.name = Agent.Name.make(def.id)
        agent.description = def.description
        agent.mode = PRIMARY
        if (def.color !== undefined) agent.color = def.color
        agent.system = systemPrompt

        if (resolved.model.includes("/")) {
          agent.model = Model.Ref.parse(resolved.model) as typeof agent.model
          if (resolved.variant !== undefined && agent.model) {
            agent.model.variant = Model.VariantID.make(resolved.variant)
          }
        }

        const body: Record<string, unknown> = {}
        if (def.temperature !== undefined) body.temperature = def.temperature
        if (def.maxOutputTokens !== undefined) body.max_output_tokens = def.maxOutputTokens
        if (Object.keys(body).length > 0) {
          agent.request.body = { ...agent.request.body, ...body }
        }
      })
      registered.add(def.id)
      options.trace?.("omo.agent.registered", {
        id: def.id,
        mode: PRIMARY,
        model: resolved.model,
        variant: resolved.variant,
        systemLength: systemPrompt.length,
      })
    }

    // Downgrade the built-in `build` agent to a hidden subagent (v1 parity).
    draft.update("build", (agent) => {
      agent.mode = "subagent"
      agent.hidden = true
    })
    options.trace?.("omo.agent.build-downgraded", {})

    // Default to sisyphus unless overridden.
    draft.default(options.defaultAgent ?? "sisyphus")
    options.trace?.("omo.agent.default", { id: options.defaultAgent ?? "sisyphus" })
  })

  return registered
}
