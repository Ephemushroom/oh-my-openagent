import { describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import * as configFormat from "./config-manager/opencode-config-format"
import * as sourceResolver from "./resolve-opencode2-plugin-entry"

import {
  buildLspMcpEntry,
  buildOpenCode2Entries,
  buildRemoteMcpEntries,
  runOpenCode2Installer,
} from "./install-opencode2"

test("#given the production installer #when installing from source #then it writes the loadable directory and repeats without changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "oc2-production-install-"))
  const path = join(root, "opencode.jsonc")
  writeFileSync(path, "{}")
  const format = spyOn(configFormat, "detectConfigFormat").mockReturnValue({ path, format: "jsonc" })
  try {
    await runOpenCode2Installer()
    expect(parse(readFileSync(path, "utf8")).plugins).toEqual([sourceResolver.resolveOpenCode2PluginEntry().entry])
    expect((await runOpenCode2Installer()).changed).toBe(false)
  } finally {
    format.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})

test("#given missing adapter source #when production installation runs #then config remains untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "oc2-missing-source-"))
  const path = join(root, "opencode.jsonc")
  writeFileSync(path, "{}")
  const format = spyOn(configFormat, "detectConfigFormat").mockReturnValue({ path, format: "jsonc" })
  const resolver = spyOn(sourceResolver, "resolveOpenCode2PluginEntry").mockReturnValue({ entry: "", exists: false, searchedFrom: root })
  try {
    await expect(runOpenCode2Installer()).rejects.toThrow("source checkout")
    expect(readFileSync(path, "utf8")).toBe("{}")
  } finally {
    resolver.mockRestore()
    format.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
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
  test("#given the managed remotes #when building #then context7 and grep_app are remote with url and codemode false and websearch is omitted", () => {
    // when
    const remotes = buildRemoteMcpEntries()

    // then
    expect(remotes.map((entry) => entry.name)).toEqual(["context7", "grep_app"])
    for (const entry of remotes) {
      expect(entry.type).toBe("remote")
      expect(entry.codemode).toBe(false)
      expect(entry.url).toBeDefined()
      expect(entry.environment).toBeUndefined()
    }
    expect(remotes.find((entry) => entry.name === "websearch")).toBeUndefined()
    expect(remotes.find((entry) => entry.name === "context7")?.url).toBe("https://mcp.context7.com/mcp")
    expect(remotes.find((entry) => entry.name === "grep_app")?.url).toBe("https://mcp.grep.app")
  })
})

describe("buildOpenCode2Entries", () => {
  test("#given no CodeGraph installation #when assembling MCP entries #then supported MCPs do not require it", () => {
    // given
    const input = {
      codegraph: { command: "codegraph", argsPrefix: [], exists: false, source: "path" },
      nodeCommand: "C:/node/node.exe",
      daemonCliPath: "C:/lsp/dist/cli.js",
    }

    // when / then
    expect(() => buildOpenCode2Entries(input)).not.toThrow()
    expect(buildOpenCode2Entries(input).map((entry) => entry.name)).toEqual(["lsp", "context7", "grep_app"])
  })

  test("#given node and daemon #when assembling #then LSP and remotes are returned", () => {
    // when
    const entries = buildOpenCode2Entries({
      nodeCommand: "C:/node/node.exe",
      daemonCliPath: "C:/lsp/dist/cli.js",
    })

    // then
    expect(entries.map((e) => e.name)).toEqual(["lsp", "context7", "grep_app"])
  })

  test("#given a missing node runtime #when assembling #then lsp is skipped and remotes remain", () => {
    // when
    const entries = buildOpenCode2Entries({
      nodeCommand: "",
      daemonCliPath: "C:/lsp/dist/cli.js",
    })

    // then
    expect(entries.map((e) => e.name)).toEqual(["context7", "grep_app"])
  })

  test("#given a missing daemon cli #when assembling #then lsp is skipped and remotes remain", () => {
    // when
    const entries = buildOpenCode2Entries({
      nodeCommand: "C:/node/node.exe",
      daemonCliPath: "",
    })

    // then
    expect(entries.map((e) => e.name)).toEqual(["context7", "grep_app"])
  })

  test("#given no local runtime #when assembling #then remote MCPs remain available", () => {
    // when / then
    expect(buildOpenCode2Entries({ nodeCommand: "", daemonCliPath: "" }).map((entry) => entry.name))
      .toEqual(["context7", "grep_app"])
  })
})
