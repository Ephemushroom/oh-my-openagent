import { describe, expect, test } from "bun:test"

import { registerGoalFeature } from "./index"
import type { GoalFeatureContext } from "./index"

async function* emptyEvents() {
  return
}

function fakeContext(calls: { transforms: number; subscriptions: number; tools: string[] }): GoalFeatureContext {
  return {
    tool: {
      transform: async (register) => {
        calls.transforms += 1
        await register({
          add: (tool: { readonly name: string }) => calls.tools.push(tool.name),
        })
      },
    },
    event: {
      subscribe: () => {
        calls.subscriptions += 1
        return emptyEvents()
      },
    },
    session: {
      get: async () => ({ id: "s1" }),
      synthetic: async () => ({ id: "pending" }),
    },
  }
}

describe("registerGoalFeature", () => {
  test("#given goal is disabled #when registration runs #then no tools or lifecycle subscription are installed", async () => {
    // given
    const calls = { transforms: 0, subscriptions: 0, tools: [] as string[] }

    // when
    const feature = await registerGoalFeature(fakeContext(calls), {
      directory: process.cwd(),
      enabled: false,
    })

    // then
    expect(calls).toEqual({ transforms: 0, subscriptions: 0, tools: [] })
    feature.dispose()
  })

  test("#given goal is enabled #when registration runs #then exactly the three goal tools and event pump are installed", async () => {
    // given
    const calls = { transforms: 0, subscriptions: 0, tools: [] as string[] }

    // when
    const feature = await registerGoalFeature(fakeContext(calls), {
      directory: process.cwd(),
      enabled: true,
    })

    // then
    expect(calls.transforms).toBe(1)
    expect(calls.subscriptions).toBe(1)
    expect(calls.tools.toSorted()).toEqual(["create_goal", "get_goal", "update_goal"])
    feature.dispose()
  })
})
