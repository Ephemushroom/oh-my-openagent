import { describe, expect, test } from "bun:test"

import { detectUltraworkIntent, selectUltraworkPrompt, injectUltraworkIntoUserTurn } from "./ultrawork-context"

describe("detectUltraworkIntent", () => {
  test("#given a message containing whole-word ulw #when detected #then true", () => {
    // when
    const result = detectUltraworkIntent("please ulw this task")

    // then
    expect(result).toBe(true)
  })

  test("#given a message containing ultrawork #when detected #then true", () => {
    // when
    const result = detectUltraworkIntent("start ultrawork mode now")

    // then
    expect(result).toBe(true)
  })

  test("#given ulw embedded in a word #when detected #then false", () => {
    // when
    const result = detectUltraworkIntent("the mulw tool works")

    // then
    expect(result).toBe(false)
  })

  test("#given ulw inside fenced code #when detected #then false", () => {
    // when
    const result = detectUltraworkIntent("```\nulw\n```")

    // then
    expect(result).toBe(false)
  })

  test("#given ulw inside inline code #when detected #then false", () => {
    // when
    const result = detectUltraworkIntent("use `ulw` here")

    // then
    expect(result).toBe(false)
  })

  test("#given a slash command #when detected #then false", () => {
    // when
    const result = detectUltraworkIntent("/help me with ulw")

    // then
    expect(result).toBe(false)
  })
})

describe("selectUltraworkPrompt", () => {
  test("#given a planner agent #when selecting #then the planner variant is chosen", () => {
    // when
    const result = selectUltraworkPrompt({ agent: "prometheus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.route).toBe("planner")
    expect(result.text).toContain("<ultrawork-mode>")
  })

  test("#given a gpt model #when selecting #then the gpt variant is chosen", () => {
    // when
    const result = selectUltraworkPrompt({ agent: "sisyphus", model: "openai/gpt-5.6-sol" })

    // then
    expect(result.route).toBe("gpt")
    expect(result.text).toContain("<ultrawork-mode>")
  })

  test("#given a gemini model #when selecting #then the gemini variant is chosen", () => {
    // when
    const result = selectUltraworkPrompt({ agent: "sisyphus", model: "google/gemini-3.1-pro" })

    // then
    expect(result.route).toBe("gemini")
  })

  test("#given a glm model #when selecting #then the glm variant is chosen", () => {
    // when
    const result = selectUltraworkPrompt({ agent: "sisyphus", model: "zai-coding-plan/glm-5.2" })

    // then
    expect(result.route).toBe("glm")
  })

  test("#given any other model #when selecting #then the default variant is chosen", () => {
    // when
    const result = selectUltraworkPrompt({ agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.route).toBe("default")
  })
})

describe("injectUltraworkIntoUserTurn", () => {
  test("#given a last user text part without the tag #when injecting #then the directive is appended inline to that part", () => {
    // given
    const messages = [
      { role: "user", content: [{ type: "text", text: "please ulw this" }] },
    ]

    // when
    const result = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then: the same message object is mutated in place (v1 parity)
    expect(result.injected).toBe(true)
    expect(messages[0]?.content[0]?.text).toContain("please ulw this")
    expect(messages[0]?.content[0]?.text).toContain("<ultrawork-mode>")
    expect(messages[0]?.content[0]?.text).toMatch(/please ulw this[\s\S]*<ultrawork-mode>/)
  })

  test("#given the last user turn already carries the tag #when injecting #then nothing is appended", () => {
    // given
    const original = "please ulw this\n\n---\n\n<ultrawork-mode>already here"
    const messages = [
      { role: "user", content: [{ type: "text", text: original }] },
    ]

    // when
    const result = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.injected).toBe(false)
    expect(messages[0]?.content[0]?.text).toBe(original)
  })

  test("#given a same-turn follow-up dispatch #when injecting twice #then only one directive exists in the user message", () => {
    // given: first dispatch mutates the message; a tool-result follow-up dispatch
    // sees the same (already-mutated) last user message.
    const messages = [
      { role: "user", content: [{ type: "text", text: "ulw" }] },
    ]

    // when
    const first = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })
    const second = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(first.injected).toBe(true)
    expect(second.injected).toBe(false)
    const text = messages[0]?.content[0]?.text ?? ""
    expect(text.split("<ultrawork-mode>").length - 1).toBe(1)
  })

  test("#given the last user turn has no text part #when injecting #then nothing happens", () => {
    // given
    const messages = [
      { role: "user", content: [{ type: "image", url: "data:..." }] },
    ]

    // when
    const result = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.injected).toBe(false)
  })

  test("#given assistant and tool messages after the keyword turn #when injecting #then the last real user turn is the one mutated", () => {
    // given: tool follow-up dispatch — assistant/tool messages sit after the user turn
    const messages = [
      { role: "user", content: [{ type: "text", text: "ulw fix this" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
      { role: "tool", content: [{ type: "text", text: "tool result" }] },
    ]

    // when
    const result = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then: only the user message is mutated; assistant/tool untouched
    expect(result.injected).toBe(true)
    expect(messages[0]?.content[0]?.text).toContain("<ultrawork-mode>")
    expect(messages[1]?.content[0]?.text).toBe("working")
    expect(messages[2]?.content[0]?.text).toBe("tool result")
  })

  test("#given a multi-part user message #when injecting #then the directive lands on the last text part", () => {
    // given
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "first part" },
          { type: "text", text: "second part ulw" },
        ],
      },
    ]

    // when
    const result = injectUltraworkIntoUserTurn(messages, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.injected).toBe(true)
    expect(messages[0]?.content[0]?.text).toBe("first part")
    expect(messages[0]?.content[1]?.text).toContain("<ultrawork-mode>")
  })
})
