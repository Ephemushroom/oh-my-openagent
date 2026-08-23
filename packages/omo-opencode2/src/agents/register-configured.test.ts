import { describe, expect, test } from "bun:test"

import { resolveAgentRegistrationConfig } from "./register-configured"

describe("resolveAgentRegistrationConfig", () => {
  test("#given distinct overrides and a configured default #when resolved #then neither falls back to built-in values", () => {
    // given
    const agents = {
      sisyphus: { model: "custom-primary/sisyphus-model", variant: "primary-variant" },
      oracle: { model: "custom-subagent/oracle-model", variant: "subagent-variant" },
      quick: { model: "custom-category/quick-model", variant: "category-variant" },
    }

    // when
    const resolved = resolveAgentRegistrationConfig({
      agents,
      default_agent: "atlas",
    })

    // then
    expect(resolved.agentOverrides).toBe(agents)
    expect(resolved.defaultAgent).toBe("atlas")
  })

  test("#given no configured default #when resolved #then sisyphus remains the product default", () => {
    expect(resolveAgentRegistrationConfig({}).defaultAgent).toBe("sisyphus")
  })
})
