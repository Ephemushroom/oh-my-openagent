import { describe, expect, test } from "bun:test"

import { registerConfiguredGoalFeature, registerGoalFeature } from "./index"
import type { GoalFeatureContext } from "./index"

async function* emptyEvents() {
  return
}

type RegistrationCalls = {
  contextHooks: number
  transforms: number
  subscriptions: number
  tools: string[]
}

function fakeContext(calls: RegistrationCalls): GoalFeatureContext {
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
      get: async () => ({}),
      hook: async () => {
        calls.contextHooks += 1
      },
      synthetic: async () => ({ id: "pending" }),
    },
  }
}

describe("registerGoalFeature", () => {
  test("#given goal is disabled #when registration runs #then no tools or lifecycle subscription are installed", async () => {
    // given
    const calls = { contextHooks: 0, transforms: 0, subscriptions: 0, tools: [] as string[] }

    // when
    const feature = await registerGoalFeature(fakeContext(calls), {
      directory: process.cwd(),
      enabled: false,
    })

    // then
    expect(calls).toEqual({ contextHooks: 0, transforms: 0, subscriptions: 0, tools: [] })
    feature.dispose()
  })

  test("#given goal is enabled #when registration runs #then exactly the three goal tools and event pump are installed", async () => {
    // given
    const calls = { contextHooks: 0, transforms: 0, subscriptions: 0, tools: [] as string[] }

    // when
    const feature = await registerGoalFeature(fakeContext(calls), {
      directory: process.cwd(),
      enabled: true,
    })

    // then
    expect(calls.transforms).toBe(1)
    expect(calls.subscriptions).toBe(1)
    expect(calls.contextHooks).toBe(0)
    expect(calls.tools.toSorted()).toEqual(["create_goal", "get_goal", "update_goal"])
    feature.dispose()
  })

  test("#given configured auto-start is enabled #when registration runs #then the goal context hook is installed", async () => {
    // given
    const calls = { contextHooks: 0, transforms: 0, subscriptions: 0, tools: [] as string[] }
    const context = {
      ...fakeContext(calls),
      options: {
        goal: {
          enabled: true,
          auto_start: true,
        },
      },
    }

    // when
    const feature = await registerConfiguredGoalFeature(context, {
      directory: process.cwd(),
    })

    // then
    expect(calls.contextHooks).toBe(1)
    feature.dispose()
  })
})
