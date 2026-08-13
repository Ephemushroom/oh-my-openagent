import { describe, expect, test } from "bun:test"

import {
  buildCodegraphMcpEntry,
  buildLspMcpEntry,
  buildOpenCode2Entries,
  buildRemoteMcpEntries,
} from "./install-opencode2"

const resolvedCodegraph = {
  command: "node",
  argsPrefix: ["/abs/codegraph/cli.js"],
  exists: true,
  source: "bundled",
}

describe("buildCodegraphMcpEntry", () => {
  test("#given a resolved codegraph command #when building #then the entry carries command + env + codemode false", () => {
    // given
    const entry = buildCodegraphMcpEntry({
      command: "node",
      argsPrefix: ["/abs/codegraph/cli.js"],
      exists: true,
      source: "bundled",
    })

    // then
    expect(entry.name).toBe("codegraph")
    expect(entry.type).toBe("local")
    expect(entry.command).toEqual(["node", "/abs/codegraph/cli.js", "serve", "--mcp"])
    expect(entry.codemode).toBe(false)
    expect(entry.environment).toContainKey("CODEGRAPH_NO_DOWNLOAD")
  })

  test("#given a missing codegraph command #when building #then it throws", () => {
    // when / then
    expect(() =>
      buildCodegraphMcpEntry({ command: "codegraph", argsPrefix: [], exists: false, source: "path" }),
    ).toThrow(/codegraph not available/)
  })
})

describe("buildLspMcpEntry", () => {
  test("#given a node runtime and a daemon cli path #when building #then the entry carries command + env + codemode false", () => {
    // given
    const entry = buildLspMcpEntry({
      nodeCommand: "C:/node/node.exe",
      daemonCliPath: "C:/lsp/dist/cli.js",
      projectConfig: ["/proj/.opencode/lsp.json"],
    })

    // then
    expect(entry.name).toBe("lsp")
    expect(entry.type).toBe("local")
    expect(entry.command).toEqual(["C:/node/node.exe", "C:/lsp/dist/cli.js", "mcp"])
    expect(entry.codemode).toBe(false)
    expect(entry.environment?.LSP_TOOLS_MCP_PROJECT_CONFIG).toContain("/proj/.opencode/lsp.json")
  })

  test("#given no node runtime #when building #then it throws", () => {
    // when / then
    expect(() =>
      buildLspMcpEntry({ nodeCommand: "", daemonCliPath: "C:/lsp/dist/cli.js", projectConfig: [] }),
    ).toThrow(/node runtime not available/)
  })
})

describe("buildRemoteMcpEntries", () => {
  test("#given the v1 remote trio #when building #then each entry is remote with url and codemode false and no headers", () => {
    // when
    const remotes = buildRemoteMcpEntries()

    // then
    expect(remotes.map((entry) => entry.name)).toEqual(["websearch", "context7", "grep_app"])
    for (const entry of remotes) {
      expect(entry.type).toBe("remote")
      expect(entry.codemode).toBe(false)
      expect(entry.url).toBeDefined()
      expect(entry.environment).toBeUndefined()
    }
    expect(remotes.find((entry) => entry.name === "websearch")?.url).toBe(
      "https://mcp.exa.ai/mcp?tools=web_search_exa",
    )
    expect(remotes.find((entry) => entry.name === "context7")?.url).toBe("https://mcp.context7.com/mcp")
    expect(remotes.find((entry) => entry.name === "grep_app")?.url).toBe("https://mcp.grep.app")
  })
})

describe("buildOpenCode2Entries", () => {
  test("#given codegraph + node + daemon #when assembling #then locals then remotes are returned", () => {
    // when
    const entries = buildOpenCode2Entries({
      codegraph: resolvedCodegraph,
      nodeCommand: "C:/node/node.exe",
      daemonCliPath: "C:/lsp/dist/cli.js",
    })

    // then
    expect(entries.map((e) => e.name)).toEqual(["codegraph", "lsp", "websearch", "context7", "grep_app"])
  })

  test("#given a missing node runtime #when assembling #then lsp is skipped and remotes remain", () => {
    // when
    const entries = buildOpenCode2Entries({
      codegraph: resolvedCodegraph,
      nodeCommand: "",
      daemonCliPath: "C:/lsp/dist/cli.js",
    })

    // then: codegraph survives, lsp degrades to a skip, remotes stay
    expect(entries.map((e) => e.name)).toEqual(["codegraph", "websearch", "context7", "grep_app"])
  })

  test("#given a missing daemon cli #when assembling #then lsp is skipped and remotes remain", () => {
    // when
    const entries = buildOpenCode2Entries({
      codegraph: resolvedCodegraph,
      nodeCommand: "C:/node/node.exe",
      daemonCliPath: "",
    })

    // then
    expect(entries.map((e) => e.name)).toEqual(["codegraph", "websearch", "context7", "grep_app"])
  })

  test("#given a missing codegraph #when assembling #then it fails closed", () => {
    // when / then
    expect(() =>
      buildOpenCode2Entries({
        codegraph: { command: "codegraph", argsPrefix: [], exists: false, source: "path" },
        nodeCommand: "C:/node/node.exe",
        daemonCliPath: "C:/lsp/dist/cli.js",
      }),
    ).toThrow(/codegraph not available/)
  })
})
