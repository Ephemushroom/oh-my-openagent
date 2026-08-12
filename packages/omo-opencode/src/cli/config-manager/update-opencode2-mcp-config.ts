import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { applyEdits, modify, parse } from "jsonc-parser"

import { backupConfigFile } from "./backup-config"

export interface OpenCode2McpEntry {
  name: string
  type: "local" | "remote"
  command?: string[]
  url?: string
  environment?: Record<string, string>
  codemode?: boolean
}

export interface UpdateOpenCode2McpResult {
  changed: boolean
  configPath: string
  backupPath?: string
  added: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Adds only missing managed MCP server entries (codegraph / lsp) to
 * opencode.json(c) `mcp.servers`, preserving comments, trailing commas, the
 * `plugins` array, and any user-owned server entries with the same name.
 *
 * Fail-closed: malformed JSONC, non-object `mcp` / `mcp.servers`, or a missing
 * file cause an error and leave the original untouched. Idempotent: when all
 * requested entries already exist, the file is not rewritten and no backup is
 * created.
 */
export function updateOpenCode2McpConfig(input: {
  configPath: string
  entries: OpenCode2McpEntry[]
}): UpdateOpenCode2McpResult {
  const { configPath, entries } = input
  if (!existsSync(configPath)) {
    throw new Error(`opencode config not found: ${configPath}`)
  }

  const text = readFileSync(configPath, "utf8")
  const parsed: unknown = parse(text, undefined, { allowTrailingComma: true, disallowComments: false })
  if (!isRecord(parsed)) {
    throw new Error("opencode config must be a JSON object")
  }

  const mcp = parsed.mcp
  if (mcp !== undefined && !isRecord(mcp)) {
    throw new Error("opencode config `mcp` must be an object")
  }
  const servers = (isRecord(mcp) ? mcp.servers : undefined) ?? {}
  if (!isRecord(servers)) {
    throw new Error("opencode config `mcp.servers` must be an object")
  }
  for (const [name, value] of Object.entries(servers)) {
    if (!isRecord(value)) {
      throw new Error(`opencode config \`mcp.servers.${name}\` must be an object`)
    }
  }

  const missing = entries.filter((entry) => !(entry.name in servers))
  if (missing.length === 0) {
    return { changed: false, configPath, added: [] }
  }

  const merged: Record<string, unknown> = { ...servers }
  for (const entry of missing) {
    merged[entry.name] = buildServerValue(entry)
  }

  const edits = modify(text, ["mcp", "servers"], merged, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  const updated = applyEdits(text, edits)
  if (updated === text) {
    return { changed: false, configPath, added: [] }
  }

  const backup = backupConfigFile(configPath)
  const tempPath = join(dirname(configPath), `.opencode2-mcp.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(tempPath, updated, "utf8")
  renameSync(tempPath, configPath)

  return { changed: true, configPath, backupPath: backup.backupPath, added: missing.map((entry) => entry.name) }
}

function buildServerValue(entry: OpenCode2McpEntry): Record<string, unknown> {
  const value: Record<string, unknown> = { type: entry.type }
  if (entry.type === "local") {
    value.command = entry.command
  } else if (entry.url !== undefined) {
    value.url = entry.url
  }
  if (entry.environment !== undefined) {
    value.environment = entry.environment
  }
  if (entry.codemode !== undefined) {
    value.codemode = entry.codemode
  }
  return value
}
