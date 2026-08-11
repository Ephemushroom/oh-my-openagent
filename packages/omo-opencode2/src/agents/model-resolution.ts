import type { Context } from "@opencode-ai/plugin/promise/plugin"
import { resolveModelPipeline } from "@oh-my-opencode/model-core"
import type { ModelRequirement } from "@oh-my-opencode/model-core"

import type { ResolvedAgentDefinition } from "./agent-catalog"

/**
 * A point-in-time view of the harness model catalog, captured inside a single
 * ctx.catalog.transform callback (synchronous draft access — no v1 config-phase
 * deadlock). Feeds model-core's pure resolution pipeline.
 */
export interface CatalogSnapshot {
  /** "<provider>/<model>" for every model known to the catalog. */
  availableModels: Set<string>;
  /** Providers that have at least one model registered. */
  connectedProviders: string[];
  /** The harness's configured default model ("<provider>/<model>"), if any. */
  systemDefaultModel?: string;
}

/**
 * Capture the catalog into a snapshot inside a catalog transform. Also reads
 * the harness's configured default model so agents whose dedicated fallback
 * chain has no available entry resolve onto the user's actual chosen model.
 */
export async function snapshotCatalog(ctx: Context): Promise<CatalogSnapshot> {
  const snapshot: CatalogSnapshot = { availableModels: new Set(), connectedProviders: [] }
  await ctx.catalog.transform((draft) => {
    for (const record of draft.provider.list()) {
      const providerID = record.provider.id as unknown as string
      snapshot.connectedProviders.push(providerID)
      for (const modelID of record.models.keys()) {
        snapshot.availableModels.add(`${providerID}/${modelID as unknown as string}`)
      }
    }
    const def = draft.model.default.get()
    if (def) {
      snapshot.systemDefaultModel = `${def.providerID as unknown as string}/${def.modelID as unknown as string}`
    }
  })
  return snapshot
}

export interface ResolvedModel {
  model: string;
  variant?: string;
}

/**
 * Resolve an agent's model through model-core's pure pipeline. Returns the
 * system default model when no chain entry matches and the agent tolerates it,
 * or undefined to skip registration for hard-requirement agents with no model.
 */
export function resolveAgentModel(
  requirement: ModelRequirement | undefined,
  snapshot: CatalogSnapshot,
  systemDefaultModel?: string,
): ResolvedModel | undefined {
  // Mirror the v1 adapter's requiresProvider gate: on a warm catalog, an agent
  // whose required providers are all disconnected is skipped (not registered).
  // A cold catalog (first run, no provider data) proceeds to the chain so the
  // agent still registers at its first fallback.
  const requiredProviders = requirement?.requiresProvider
  if (requiredProviders && requiredProviders.length > 0 && snapshot.availableModels.size > 0) {
    const anyConnected = snapshot.connectedProviders.some((p) => requiredProviders.includes(p))
    if (!anyConnected) return undefined
  }

  const resolution = resolveModelPipeline(
    {
      intent: {},
      constraints: {
        availableModels: snapshot.availableModels,
        connectedProviders: snapshot.connectedProviders,
      },
      policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel },
    },
  )

  if (resolution) {
    return { model: resolution.model, variant: resolution.variant }
  }

  // Cold catalog (no connected providers / first run): fall back to the first
  // fallback-chain entry so the agent is still registered and resolvable later.
  const first = requirement?.fallbackChain?.[0]
  if (first && first.providers.length > 0) {
    return { model: `${first.providers[0]}/${first.model}`, variant: first.variant }
  }
  return undefined
}
