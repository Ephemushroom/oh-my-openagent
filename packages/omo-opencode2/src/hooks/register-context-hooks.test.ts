import { describe, expect, test } from "bun:test"

import { createContextHookComposer } from "./register-context-hooks"
import { buildSisyphusPromptForModel } from "../agents/sisyphus-prompt"

const STATIC_SISYPHUS = buildSisyphusPromptForModel("anthropic/claude-sonnet-5", [], [], [], [], false)

function makeHookInput() {
  return {
    sessionID: "ses_1",
    agent: "sisyphus",
    model: { id: "claude-sonnet-5", providerID: "anthropic" },
    system: [
      { type: "text", text: "[project] keep" },
      { type: "text", text: STATIC_SISYPHUS },
    ],
    messages: [],
    tools: { task: { description: "delegate", input: {} } },
  }
}

describe("createContextHookComposer", () => {
  test("#given a sisyphus session with live catalogs and a matching user turn #when composed #then dynamic rebake and one mode tag coexist", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => [
        { id: "oracle", name: "oracle", description: "Oracle", mode: "subagent" },
        { id: "deep", name: "deep", description: "Deep", mode: "subagent" },
      ],
      skillList: async () => [{ name: "git-master", description: "Git", location: "project" }],
      lastUserText: async () => "run ulw now",
    })
    const input = makeHookInput() as Parameters<typeof composer>[0]

    // when
    const output = await composer(input)

    // then: project part preserved; sisyphus part rebaked with oracle; mode tag appended once
    expect(output.system[0]).toEqual({ type: "text", text: "[project] keep" })
    expect(output.system[1]?.text).toContain("oracle")
    const tagged = output.system.filter((part) => part.text?.includes("<ultrawork-mode>"))
    expect(tagged).toHaveLength(1)
  })

  test("#given a non-matching user turn #when composed #then rebake happens but no mode tag is appended", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => [{ id: "oracle", name: "oracle", description: "Oracle", mode: "subagent" }],
      skillList: async () => [],
      lastUserText: async () => "just help me",
    })
    const input = makeHookInput() as Parameters<typeof composer>[0]

    // when
    const output = await composer(input)

    // then
    expect(output.system[1]?.text).toContain("oracle")
    expect(output.system.some((part) => part.text?.includes("<ultrawork-mode>"))).toBe(false)
  })

  test("#given the live agent list rejects #when composed #then the static sisyphus part survives and mode still injects", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => {
        throw new Error("catalog down")
      },
      skillList: async () => [],
      lastUserText: async () => "ulw",
    })
    const input = makeHookInput() as Parameters<typeof composer>[0]

    // when
    const output = await composer(input)

    // then: static sisyphus part untouched (rebake non-fatal), mode tag still appended
    expect(output.system[1]).toEqual({ type: "text", text: STATIC_SISYPHUS })
    expect(output.system.some((part) => part.text?.includes("<ultrawork-mode>"))).toBe(true)
  })

  test("#given repeated composed calls #when the same user turn triggers #then exactly one mode tag persists", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => [{ id: "oracle", name: "oracle", description: "Oracle", mode: "subagent" }],
      skillList: async () => [],
      lastUserText: async () => "ulw",
    })

    // when
    let input = makeHookInput() as Parameters<typeof composer>[0]
    input = await composer(input)
    const second = await composer(input)

    // then
    const tagged = second.system.filter((part) => part.text?.includes("<ultrawork-mode>"))
    expect(tagged).toHaveLength(1)
  })
})
