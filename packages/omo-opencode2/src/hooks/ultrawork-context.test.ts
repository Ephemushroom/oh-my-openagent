import { describe, expect, test } from "bun:test"

import { detectUltraworkIntent, selectUltraworkPrompt, injectUltraworkSystemPart } from "./ultrawork-context"

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

describe("injectUltraworkSystemPart", () => {
  test("#given a system array without the tag #when injecting #then one tagged part is appended", () => {
    // given
    const system = [{ type: "text", text: "[existing]" }]

    // when
    const result = injectUltraworkSystemPart(system, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.injected).toBe(true)
    expect(result.system).toHaveLength(2)
    expect(result.system[0]).toEqual({ type: "text", text: "[existing]" })
    expect(result.system[1]?.text).toContain("<ultrawork-mode>")
  })

  test("#given a system array already containing the tag #when injecting #then nothing is appended", () => {
    // given
    const system = [
      { type: "text", text: "[existing]" },
      { type: "text", text: "<ultrawork-mode>already here" },
    ]

    // when
    const result = injectUltraworkSystemPart(system, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(result.injected).toBe(false)
    expect(result.system).toHaveLength(2)
  })

  test("#given repeated injections #when invoking twice #then only one tagged part exists", () => {
    // given
    let system: Array<{ type: string; text?: string }> = [{ type: "text", text: "[existing]" }]

    // when
    const first = injectUltraworkSystemPart(system, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })
    system = first.system
    const second = injectUltraworkSystemPart(system, { agent: "sisyphus", model: "anthropic/claude-sonnet-5" })

    // then
    expect(second.injected).toBe(false)
    expect(second.system.filter((part) => part.text?.includes("<ultrawork-mode>"))).toHaveLength(1)
  })
})
