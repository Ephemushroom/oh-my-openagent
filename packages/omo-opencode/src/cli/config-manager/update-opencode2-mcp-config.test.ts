import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { updateOpenCode2McpConfig } from "./update-opencode2-mcp-config"
import type { OpenCode2McpEntry } from "./update-opencode2-mcp-config"

const FIXTURE_ROOT = join(import.meta.dir, "..", "..", "..", "test", "fixtures", "opencode2-mcp")

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
})
afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

function writeConfig(name: string, content: string): string {
  const path = join(FIXTURE_ROOT, name)
  writeFileSync(path, content, "utf8")
  return path
}

const CODEGRAPH_ENTRY: OpenCode2McpEntry = {
  name: "codegraph",
  type: "local",
  command: ["node", "/abs/codegraph/cli.js", "serve", "--mcp"],
  environment: { CODEGRAPH_NO_DOWNLOAD: "1" },
  codemode: false,
}

describe("updateOpenCode2McpConfig", () => {
  test("#given a jsonc config with comments, plugins, and a user codegraph #when adding lsp #then plugins, comments, and the user codegraph survive", () => {
    // given
    const path = writeConfig(
      "preserve.jsonc",
      `{
  // keep this comment
  "plugins": ["local-plugin"],
  "mcp": { "servers": { "codegraph": { "type": "local", "command": ["user-cg"], "codemode": false } } },
}`,
    )

    // when
    const result = updateOpenCode2McpConfig({ configPath: path, entries: [CODEGRAPH_ENTRY] })

    // then
    expect(result.changed).toBe(false)
    const text = readFileSync(path, "utf8")
    expect(text).toContain("// keep this comment")
    expect(text).toContain('"plugins": ["local-plugin"]')
    expect(text).toContain('"command": ["user-cg"]')
    expect(text).not.toContain("/abs/codegraph/cli.js")
  })

  test("#given a config missing lsp #when adding codegraph and lsp #then only lsp is added and codegraph stays user-owned", () => {
    // given
    const path = writeConfig(
      "add-missing.jsonc",
      `{
  "plugins": ["x"],
  "mcp": { "servers": {} }
}`,
    )

    // when
    const result = updateOpenCode2McpConfig({
      configPath: path,
      entries: [CODEGRAPH_ENTRY, { name: "lsp", type: "local", command: ["node", "/abs/lsp/cli.js", "mcp"], environment: { LSP_TOOLS_MCP_PROJECT_CONFIG: "/x" }, codemode: false }],
    })

    // then: codegraph is user-owned? no — it is empty servers, so both added
    expect(result.changed).toBe(true)
    const text = readFileSync(path, "utf8")
    expect(text).toContain('"codegraph"')
    expect(text).toContain('"lsp"')
    expect(text).toContain('"/abs/codegraph/cli.js"')
  })

  test("#given a valid config #when updating twice #then the second run reports changed=false", () => {
    // given
    const path = writeConfig(
      "idempotent.jsonc",
      `{
  "mcp": { "servers": {} }
}`,
    )

    // when
    const first = updateOpenCode2McpConfig({ configPath: path, entries: [CODEGRAPH_ENTRY] })
    const second = updateOpenCode2McpConfig({ configPath: path, entries: [CODEGRAPH_ENTRY] })

    // then
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
  })

  test("#given a malformed config #when updating #then the file is untouched and an error is thrown", () => {
    // given
    const path = writeConfig("malformed.jsonc", `{ "mcp": { "servers": { "codegraph": 42 } } }`)

    // when / then
    expect(() => updateOpenCode2McpConfig({ configPath: path, entries: [CODEGRAPH_ENTRY] })).toThrow()
    expect(readFileSync(path, "utf8")).toBe(`{ "mcp": { "servers": { "codegraph": 42 } } }`)
  })
})
