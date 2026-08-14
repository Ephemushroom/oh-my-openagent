import { createRequire } from "node:module"
import { resolveCodegraphCommand, buildCodegraphEnv, bunWhich } from "@oh-my-opencode/utils"

import type { OpenCode2McpEntry } from "./config-manager/update-opencode2-mcp-config"
import { updateOpenCode2McpConfig } from "./config-manager/update-opencode2-mcp-config"
import { detectConfigFormat } from "./config-manager/opencode-config-format"
import type { UpdateOpenCode2McpResult } from "./config-manager/update-opencode2-mcp-config"
import { updateOpenCode2PluginConfig } from "./config-manager/update-opencode2-plugin-config"
import { resolveOpenCode2PluginEntry } from "./resolve-opencode2-plugin-entry"

export interface OpenCode2InstallResult extends UpdateOpenCode2McpResult {
  configPath: string
  added: string[]
  pluginEntry: string
  pluginAdded: boolean
}

export const MISSING_PLUGIN_ENTRY_MESSAGE =
  "omo-opencode2 plugin source not found. The v2 adapter is an unpublished workspace package, so it installs only from a source checkout of this repository."

/**
 * Top-level installer entry: locates the opencode config, then writes both the
 * managed MCP entries (codegraph + lsp + remote HTTP) and the OMO plugin entry.
 *
 * Every input is resolved before the first write so a missing dependency cannot
 * leave the config half-updated. Fails closed on a missing codegraph or a
 * missing v2 plugin source; lsp degrades to a skip when the node runtime or
 * daemon cli is unavailable.
 */
export async function runOpenCode2Installer(): Promise<OpenCode2InstallResult> {
  const { path } = detectConfigFormat()
  const entries = buildOpenCode2Entries({
    codegraph: resolveCodegraphForInstall(),
    nodeCommand: await resolveNodeRuntime(),
    daemonCliPath: resolveLspDaemonCli(),
  })
  const plugin = resolveOpenCode2PluginEntry()
  if (!plugin.exists) {
    throw new Error(MISSING_PLUGIN_ENTRY_MESSAGE)
  }

  const result = updateOpenCode2McpConfig({ configPath: path, entries })
  const pluginResult = updateOpenCode2PluginConfig({ configPath: path, pluginEntry: plugin.entry })

  return {
    ...result,
    configPath: path,
    pluginEntry: plugin.entry,
    pluginAdded: pluginResult.changed,
  }
}

export interface OpenCode2EntriesInput {
  codegraph: CodegraphResolutionInput
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
 * Builds the full managed MCP entry list. codegraph is the core value; a
 * missing command is a hard failure. lsp is best-effort: it is skipped when
 * the node runtime or daemon cli is unavailable rather than failing the
 * whole install. Remote HTTP MCPs are always appended after the local entries.
 */
export function buildOpenCode2Entries(input: OpenCode2EntriesInput): OpenCode2McpEntry[] {
  const entries: OpenCode2McpEntry[] = [buildCodegraphMcpEntry(input.codegraph)]
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

export interface CodegraphResolutionInput {
  command: string
  argsPrefix: string[]
  exists: boolean
  source: string
}

/**
 * Builds the codegraph MCP server entry. The resolved command may carry an
 * args prefix (bundled shim); the entry command is
 * `[command, ...argsPrefix, "serve", "--mcp"]`.
 */
export function buildCodegraphMcpEntry(resolution: CodegraphResolutionInput): OpenCode2McpEntry {
  if (!resolution.exists) {
    throw new Error("codegraph not available: no codegraph command resolved")
  }
  return {
    name: "codegraph",
    type: "local",
    command: [resolution.command, ...resolution.argsPrefix, "serve", "--mcp"],
    environment: buildCodegraphEnv(),
    codemode: false,
  }
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

/** Resolves the codegraph command via the shared utils resolver. */
export function resolveCodegraphForInstall(): CodegraphResolutionInput {
  const resolved = resolveCodegraphCommand()
  return {
    command: resolved.command,
    argsPrefix: [...resolved.argsPrefix],
    exists: resolved.exists,
    source: resolved.source,
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
