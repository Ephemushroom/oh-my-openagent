import { describe, expect, test } from "bun:test"

import { OpenCode2ConfigSchema } from "./schema"

describe("OpenCode2ConfigSchema disabled_mcps", () => {
  test("accepts known built-in names", () => {
    const parsed = OpenCode2ConfigSchema.safeParse({
      disabled_mcps: ["context7", "grep_app", "lsp", "codegraph"],
    })
    expect(parsed.success).toBe(true)
  })

  test("passes unknown names through permissively", () => {
    const parsed = OpenCode2ConfigSchema.safeParse({ disabled_mcps: ["whatever"] })
    expect(parsed.success).toBe(true)
  })
})

describe("OpenCode2ConfigSchema codegraph", () => {
  test("accepts the settings block", () => {
    const parsed = OpenCode2ConfigSchema.safeParse({
      codegraph: { daemon: false, install_dir: "/opt/cg", excluded_roots: ["/tmp"] },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.codegraph?.daemon).toBe(false)
      expect(parsed.data.codegraph?.install_dir).toBe("/opt/cg")
    }
  })

  test("drops unknown codegraph fields", () => {
    const parsed = OpenCode2ConfigSchema.safeParse({ codegraph: { bogus: 1 } })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.codegraph).toEqual({})
    }
  })
})
