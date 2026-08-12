import { describe, expect, test } from "bun:test"

import { createContextHookComposer } from "./register-context-hooks"
import { buildSisyphusPromptForModel } from "../agents/sisyphus-prompt"

const STATIC_SISYPHUS = buildSisyphusPromptForModel("anthropic/claude-sonnet-5", [], [], [], [], false)

function makeHookInput(userText = "run ulw now") {
  return {
    sessionID: "ses_1",
    agent: "sisyphus",
    model: { id: "claude-sonnet-5", providerID: "anthropic" },
    system: [
      { type: "text", text: "[project] keep" },
      { type: "text", text: STATIC_SISYPHUS },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    tools: { task: { description: "delegate", input: {} } },
  }
}

function modeTaggedInMessages(messages: Array<{ role?: string; content?: Array<{ type: string; text?: string }> }>): boolean {
  return messages.some(
    (message) => message.role === "user" && (message.content ?? []).some((part) => part.type === "text" && part.text?.includes("<ultrawork-mode>")),
  )
}

describe("createContextHookComposer", () => {
  test("#given a sisyphus session with live catalogs and a matching user turn #when composed #then dynamic rebake and the inline mode tag coexist", async () => {
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

    // then: project part preserved; sisyphus part rebaked with oracle; the mode
    // tag lands inline on the user message (not as a system part)
    expect(output.system[0]).toEqual({ type: "text", text: "[project] keep" })
    expect(output.system[1]?.text).toContain("oracle")
    expect(output.system.some((part) => part.text?.includes("<ultrawork-mode>"))).toBe(false)
    expect(modeTaggedInMessages(output.messages)).toBe(true)
  })

  test("#given a non-matching user turn #when composed #then rebake happens but no mode tag is appended", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => [{ id: "oracle", name: "oracle", description: "Oracle", mode: "subagent" }],
      skillList: async () => [],
      lastUserText: async () => "just help me",
    })
    const input = makeHookInput("just help me") as Parameters<typeof composer>[0]

    // when
    const output = await composer(input)

    // then
    expect(output.system[1]?.text).toContain("oracle")
    expect(modeTaggedInMessages(output.messages)).toBe(false)
  })

  test("#given the live agent list rejects #when composed #then the static sisyphus part survives and mode still injects inline", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => {
        throw new Error("catalog down")
      },
      skillList: async () => [],
      lastUserText: async () => "ulw",
    })
    const input = makeHookInput("ulw") as Parameters<typeof composer>[0]

    // when
    const output = await composer(input)

    // then: static sisyphus part untouched (rebake non-fatal), mode tag still injected inline
    expect(output.system[1]).toEqual({ type: "text", text: STATIC_SISYPHUS })
    expect(modeTaggedInMessages(output.messages)).toBe(true)
  })

  test("#given repeated composed calls #when the same user turn triggers #then exactly one mode tag persists in the user message", async () => {
    // given
    const composer = createContextHookComposer({
      staticSisyphusPrompt: STATIC_SISYPHUS,
      agentList: async () => [{ id: "oracle", name: "oracle", description: "Oracle", mode: "subagent" }],
      skillList: async () => [],
      lastUserText: async () => "ulw",
    })

    // when
    let input = makeHookInput("ulw") as Parameters<typeof composer>[0]
    input = await composer(input)
    const second = await composer(input)

    // then
    const text = second.messages[0]?.content?.[0]?.text ?? ""
    expect(text.split("<ultrawork-mode>").length - 1).toBe(1)
  })
})
