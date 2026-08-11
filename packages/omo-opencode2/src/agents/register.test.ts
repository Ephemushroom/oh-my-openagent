import { describe, expect, test } from "bun:test"

import type { Context } from "@opencode-ai/plugin/promise/plugin"

import { registerCategories } from "./register-categories"
import { registerPrimaries } from "./register-primaries"
import { registerSubagents } from "./register-subagents"
import { resolveAgentModel } from "./model-resolution"

/**
 * Minimal structural stand-ins for the v2 catalog/agent drafts. The
 * registration code only reads provider ids + model keys and mutates agent
 * fields, so a plain-object draft is sufficient and faithful for unit testing.
 */

type MutableAgent = {
  name: unknown
  description?: string
  mode?: string
  hidden?: boolean
  color?: string
  system?: string
  model?: { id: string; providerID: string; variant?: string }
  request: { settings: Record<string, unknown>; headers: Record<string, string>; body: Record<string, unknown> }
  permissions: { action: string; resource: string; effect: string }[]
}

function emptyAgent(): MutableAgent {
  return { name: undefined, request: { settings: {}, headers: {}, body: {} }, permissions: [] }
}

function createMockContext(input: {
  availableModels?: string[]
  connectedProviders?: string[]
  defaultModel?: string
}) {
  const agents = new Map<string, MutableAgent>()
  let defaultAgent: string | undefined

  const providers = new Map<string, Set<string>>()
  for (const full of input.availableModels ?? []) {
    const [provider, ...rest] = full.split("/")
    if (!provider || rest.length === 0) continue
    if (!providers.has(provider)) providers.set(provider, new Set())
    providers.get(provider)?.add(rest.join("/"))
  }
  const providerRecords = [...providers.entries()].map(([id, models]) => ({
    provider: { id },
    models: new Map([...models].map((m) => [m, {}])),
  }))

  const defaultParts = (input.defaultModel ?? "").split("/")
  const defaultRef =
    defaultParts.length >= 2
      ? { providerID: defaultParts[0], modelID: defaultParts.slice(1).join("/") }
      : undefined

  const ctx = {
    catalog: {
      transform: async (cb: (draft: unknown) => void) => {
        cb({
          provider: { list: () => providerRecords, get: () => undefined, update: () => {}, remove: () => {} },
          model: {
            get: () => undefined,
            update: () => {},
            remove: () => {},
            default: { get: () => defaultRef, set: () => {} },
          },
        })
      },
      reload: async () => {},
    },
    agent: {
      transform: async (cb: (draft: unknown) => void) => {
        cb({
          list: () => [...agents.values()],
          get: (id: string) => agents.get(id),
          default: (id: string | undefined) => {
            defaultAgent = id
          },
          update: (id: string, fn: (agent: MutableAgent) => void) => {
            const agent = agents.get(id) ?? emptyAgent()
            fn(agent)
            agents.set(id, agent)
          },
          remove: (id: string) => {
            agents.delete(id)
          },
        })
      },
      reload: async () => {},
    },
  } as unknown as Context

  return { ctx, agents, getDefault: () => defaultAgent }
}

describe("resolveAgentModel", () => {
  test("#given a chain model available in the catalog #when resolving #then it uses the chain entry", () => {
    const result = resolveAgentModel(
      { fallbackChain: [{ providers: ["openai"], model: "gpt-5.6-sol", variant: "xhigh" }] },
      { availableModels: new Set(["openai/gpt-5.6-sol"]), connectedProviders: ["openai"] },
    )

    expect(result?.model).toBe("openai/gpt-5.6-sol")
    expect(result?.variant).toBe("xhigh")
  })

  test("#given no chain entry available and a system default #when resolving #then it falls back to the default", () => {
    const result = resolveAgentModel(
      { fallbackChain: [{ providers: ["openai"], model: "gpt-5.6-sol" }] },
      { availableModels: new Set(["zhipuai/glm-4.7"]), connectedProviders: ["zhipuai"] },
      "zhipuai/glm-4.7",
    )

    expect(result?.model).toBe("zhipuai/glm-4.7")
  })

  test("#given a cold catalog and no default #when resolving #then it uses the first fallback entry", () => {
    const result = resolveAgentModel(
      { fallbackChain: [{ providers: ["anthropic"], model: "claude-opus-5", variant: "max" }] },
      { availableModels: new Set(), connectedProviders: [] },
    )

    expect(result?.model).toBe("anthropic/claude-opus-5")
    expect(result?.variant).toBe("max")
  })
})

describe("registerSubagents", () => {
  test("#given a catalog #when registering #then all seven subagents are upserted as subagents with a prompt", async () => {
    const { ctx, agents } = createMockContext({ defaultModel: "zhipuai/glm-4.7" })

    const registered = await registerSubagents(ctx)

    expect(registered.sort()).toEqual(
      ["oracle", "librarian", "explore", "multimodal-looker", "metis", "momus", "sisyphus-junior"].sort(),
    )
    for (const id of registered) {
      const agent = agents.get(id)
      expect(agent?.mode).toBe("subagent")
      expect(typeof agent?.system).toBe("string")
      expect(agent?.system?.length).toBeGreaterThan(0)
    }
  })

  test("#given a catalog #when registering oracle #then write/edit/task are denied", async () => {
    const { ctx, agents } = createMockContext({ defaultModel: "zhipuai/glm-4.7" })

    await registerSubagents(ctx)

    const oracle = agents.get("oracle")
    const effects = new Map(oracle?.permissions.map((rule) => [rule.action, rule.effect]))
    expect(effects.get("write")).toBe("deny")
    expect(effects.get("edit")).toBe("deny")
    expect(effects.get("task")).toBe("deny")
  })

  test("#given an available chain model #when registering #then the agent model resolves from the catalog", async () => {
    const { ctx, agents } = createMockContext({ availableModels: ["openai/gpt-5.6-sol"], defaultModel: "zhipuai/glm-4.7" })

    await registerSubagents(ctx)

    const oracle = agents.get("oracle")
    expect(oracle?.model?.providerID).toBe("openai")
    expect(oracle?.model?.id).toBe("gpt-5.6-sol")
  })
})

describe("registerPrimaries", () => {
  test("#given a catalog with a GPT model available #when registering #then all four primaries register and default becomes sisyphus", async () => {
    const { ctx, agents, getDefault } = createMockContext({
      availableModels: ["openai/gpt-5.6-sol"],
      defaultModel: "zhipuai/glm-4.7",
    })

    const registered = await registerPrimaries(ctx)

    expect(registered.sort()).toEqual(["atlas", "hephaestus", "prometheus", "sisyphus"].sort())
    for (const id of registered) {
      expect(agents.get(id)?.mode).toBe("primary")
      expect(agents.get(id)?.system?.length).toBeGreaterThan(0)
    }
    expect(agents.get("hephaestus")?.model?.id).toBe("gpt-5.6-sol")
    expect(getDefault()).toBe("sisyphus")
  })

  test("#given a non-GPT system default on a cold catalog #when registering #then hephaestus is skipped but the other primaries register", async () => {
    const { ctx, agents } = createMockContext({ defaultModel: "zhipuai/glm-4.7" })

    const registered = await registerPrimaries(ctx)

    expect(registered.sort()).toEqual(["atlas", "prometheus", "sisyphus"].sort())
    expect(agents.get("hephaestus")).toBeUndefined()
    expect(agents.get("sisyphus")?.system?.length).toBeGreaterThan(0)
  })

  test("#given a warm catalog without a required provider #when registering #then hephaestus is skipped via the requiresProvider gate", async () => {
    const { ctx, agents } = createMockContext({
      availableModels: ["zhipuai/glm-4.7"],
      defaultModel: "zhipuai/glm-4.7",
    })

    const registered = await registerPrimaries(ctx)

    expect(registered).not.toContain("hephaestus")
    expect(agents.get("hephaestus")).toBeUndefined()
  })

  test("#given a catalog #when registering #then the built-in build agent is downgraded to a hidden subagent", async () => {
    const { ctx, agents } = createMockContext({ defaultModel: "zhipuai/glm-4.7" })

    await registerPrimaries(ctx)

    expect(agents.get("build")?.mode).toBe("subagent")
    expect(agents.get("build")?.hidden).toBe(true)
  })
})

describe("registerCategories", () => {
  test("#given a catalog #when registering #then all eight categories register as subagents with the executor prompt", async () => {
    const { ctx, agents } = createMockContext({ defaultModel: "zhipuai/glm-4.7" })

    const registered = await registerCategories(ctx)

    expect(registered.sort()).toEqual(
      ["visual-engineering", "ultrabrain", "deep", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"].sort(),
    )
    for (const name of registered) {
      expect(agents.get(name)?.mode).toBe("subagent")
      expect(agents.get(name)?.system?.length).toBeGreaterThan(0)
    }
  })
})
