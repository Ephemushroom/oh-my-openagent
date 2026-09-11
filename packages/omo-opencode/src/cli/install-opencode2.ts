import { createRequire } from "node:module"
import { bunWhich } from "@oh-my-opencode/utils"

import type { OpenCode2McpEntry } from "./config-manager/update-opencode2-mcp-config"
import { updateOpenCode2McpConfig } from "./config-manager/update-opencode2-mcp-config"
import { updateOpenCode2PluginConfig } from "./config-manager/update-opencode2-plugin-config"
import { detectConfigFormat } from "./config-manager/opencode-config-format"
import type { UpdateOpenCode2McpResult } from "./config-manager/update-opencode2-mcp-config"
import { resolveOpenCode2PluginEntry } from "./resolve-opencode2-plugin-entry"

export interface OpenCode2InstallResult extends UpdateOpenCode2McpResult {
  configPath: string
  added: string[]
  pluginEntryAdded: boolean
}

/**
 * Top-level installer entry: locates the opencode config, builds the managed
 * MCP entries and writes only the missing ones. LSP is skipped when its
 * node runtime or daemon CLI is unavailable.
 * Also appends the OMO v2 plugin entry to the plugins array.
 */
export async function runOpenCode2Installer(): Promise<OpenCode2InstallResult> {
  const plugin = resolveOpenCode2PluginEntry()
  if (!plugin.exists) throw new Error("OpenCode2 adapter requires a source checkout containing packages/omo-opencode2/src/index.ts")
  const { path } = detectConfigFormat()
  const entries = buildOpenCode2Entries({
    nodeCommand: await resolveNodeRuntime(),
    daemonCliPath: resolveLspDaemonCli(),
  })
  const mcpResult = updateOpenCode2McpConfig({ configPath: path, entries })
  const pluginResult = updateOpenCode2PluginConfig({ configPath: path, pluginEntry: plugin.entry })
  return { 
    ...mcpResult, 
    changed: mcpResult.changed || pluginResult.changed,
    configPath: path, 
    pluginEntryAdded: pluginResult.changed
  }
}

export interface OpenCode2EntriesInput {
  nodeCommand: string
  daemonCliPath: string
}

const REMOTE_MCP_ENTRIES = [
  {
    name: "context7",
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    codemode: false,
  },
  {
    name: "grep_app",
    type: "remote",
    url: "https://mcp.grep.app",
    codemode: false,
  },
] as const satisfies readonly OpenCode2McpEntry[]

/**
 * Returns the remote HTTP MCPs that OpenCode2 does not already ship
 * (context7 / grep_app). websearch is omitted: v2 has a native Exa-backed
 * websearch tool. No API keys or headers are written.
 */
export function buildRemoteMcpEntries(): OpenCode2McpEntry[] {
  return REMOTE_MCP_ENTRIES.map((entry) => ({ ...entry }))
}

/**
 * Builds the full managed MCP entry list. LSP is best-effort: it is skipped when
 * the node runtime or daemon cli is unavailable rather than failing the
 * whole install. Remote HTTP MCPs are always appended after the local entries.
 */
export function buildOpenCode2Entries(input: OpenCode2EntriesInput): OpenCode2McpEntry[] {
  const entries: OpenCode2McpEntry[] = []
  if (input.nodeCommand && input.daemonCliPath) {
    entries.push(
      buildLspMcpEntry({
        nodeCommand: input.nodeCommand,
        daemonCliPath: input.daemonCliPath,
        projectConfig: [`.opencode/lsp.json`],
      }),
    )
  }
  entries.push(...buildRemoteMcpEntries())
  return entries
}

export interface LspResolutionInput {
  nodeCommand: string
  daemonCliPath: string
  projectConfig: string[]
  userConfig?: string
}

/**
 * Builds the lsp MCP server entry: `[node, <daemon cli>, "mcp"]` plus the
 * LSP_TOOLS_MCP_* environment pointers.
 */
export function buildLspMcpEntry(resolution: LspResolutionInput): OpenCode2McpEntry {
  if (!resolution.nodeCommand) {
    throw new Error("node runtime not available for the lsp daemon")
  }
  const environment: Record<string, string> = {}
  if (resolution.projectConfig.length > 0) {
    environment.LSP_TOOLS_MCP_PROJECT_CONFIG = resolution.projectConfig.join(";")
  }
  if (resolution.userConfig) {
    environment.LSP_TOOLS_MCP_USER_CONFIG = resolution.userConfig
  }
  return {
    name: "lsp",
    type: "local",
    command: [resolution.nodeCommand, resolution.daemonCliPath, "mcp"],
    environment,
    codemode: false,
  }
}

/** Resolves the lsp daemon cli via package export (createRequire) or returns "". */
export function resolveLspDaemonCli(): string {
  try {
    const require = createRequire(import.meta.url)
    return require.resolve("@code-yeongyu/lsp-daemon/cli")
  } catch {
    return ""
  }
}

/** Resolves a runnable node executable (via the node-safe bunWhich helper). */
export async function resolveNodeRuntime(): Promise<string> {
  return bunWhich("node") ?? ""
}
