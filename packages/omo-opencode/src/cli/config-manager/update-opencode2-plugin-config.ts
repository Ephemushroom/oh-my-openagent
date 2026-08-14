import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ParseError } from "jsonc-parser"
import { applyEdits, modify, parse } from "jsonc-parser"

import { backupConfigFile } from "./backup-config"

export type OpenCode2PluginEntry = string | Record<string, unknown>

export interface UpdateOpenCode2PluginResult {
  changed: boolean
  configPath: string
  backupPath?: string
  added?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function entriesMatch(existing: unknown, candidate: OpenCode2PluginEntry): boolean {
  if (typeof candidate === "string") {
    if (typeof existing === "string") return existing === candidate
    return isRecord(existing) && existing.package === candidate
  }
  if (typeof existing === "string") return existing === candidate.package
  return isRecord(existing) && existing.package === candidate.package
}

/**
 * Adds the OMO plugin entry to opencode.json(c) `plugins`, preserving comments,
 * trailing commas, the `mcp` block, and any user-owned entries.
 *
 * Fail-closed: a missing file, malformed JSONC, or a non-array `plugins` throws
 * and leaves the original untouched. Idempotent: an entry already present (by
 * identity for strings, by `package` for objects) is not written again.
 */
export function updateOpenCode2PluginConfig(input: {
  configPath: string
  pluginEntry: OpenCode2PluginEntry
}): UpdateOpenCode2PluginResult {
  const { configPath, pluginEntry } = input
  if (!existsSync(configPath)) {
    throw new Error(`opencode config not found: ${configPath}`)
  }

  const text = readFileSync(configPath, "utf8")
  // jsonc-parser recovers from syntax errors instead of throwing, so a malformed
  // file would otherwise parse into a partial object and be silently rewritten.
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) {
    throw new Error(`opencode config is not valid JSONC: ${configPath}`)
  }
  if (!isRecord(parsed)) {
    throw new Error("opencode config must be a JSON object")
  }

  const plugins = parsed.plugins ?? []
  if (!Array.isArray(plugins)) {
    throw new Error("opencode config `plugins` must be an array")
  }

  if (plugins.some((existing) => entriesMatch(existing, pluginEntry))) {
    return { changed: false, configPath }
  }

  const edits = modify(text, ["plugins"], [...plugins, pluginEntry], {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  const updated = applyEdits(text, edits)
  if (updated === text) {
    return { changed: false, configPath }
  }

  const backup = backupConfigFile(configPath)
  const tempPath = join(dirname(configPath), `.opencode2-plugin.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(tempPath, updated, "utf8")
  renameSync(tempPath, configPath)

  const added = typeof pluginEntry === "string" ? pluginEntry : String(pluginEntry.package ?? "")
  return { changed: true, configPath, backupPath: backup.backupPath, added }
}
