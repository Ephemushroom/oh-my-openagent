import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { applyEdits, modify, parse } from "jsonc-parser"

import { backupConfigFile } from "./backup-config"

export interface UpdateOpenCode2PluginResult {
  changed: boolean
  configPath: string
  backupPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Adds the OMO plugin entry to the opencode.json(c) `plugins` array, preserving
 * comments, trailing commas, and any user-owned entries.
 *
 * Fail-closed: malformed JSONC, non-array `plugins`, or a missing
 * file cause an error and leave the original untouched. Idempotent: when the
 * entry already exists (by value equality or matching package/path), the file 
 * is not rewritten.
 */
export function updateOpenCode2PluginConfig(input: {
  configPath: string
  pluginEntry: string
}): UpdateOpenCode2PluginResult {
  const { configPath, pluginEntry } = input
  if (!existsSync(configPath)) {
    throw new Error(`opencode config not found: ${configPath}`)
  }

  const text = readFileSync(configPath, "utf8")
  const errors: any[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0 || !isRecord(parsed)) {
    throw new Error("opencode config must be a valid JSON object")
  }

  const plugins = parsed.plugins ?? []
  if (!Array.isArray(plugins)) {
    throw new Error("opencode config `plugins` must be an array")
  }

  const exists = plugins.some((p) => {
    if (typeof p === "string") return p === pluginEntry
    if (isRecord(p) && typeof p.package === "string") return p.package === pluginEntry
    return false
  })

  if (exists) {
    return { changed: false, configPath }
  }

  let edits
  if (parsed.plugins === undefined) {
    edits = modify(text, ["plugins"], [pluginEntry], {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
  } else {
    edits = modify(text, ["plugins", plugins.length], pluginEntry, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
      isArrayInsertion: true,
    })
  }

  const updated = applyEdits(text, edits)
  if (updated === text) {
    return { changed: false, configPath }
  }

  const backup = backupConfigFile(configPath)
  const tempPath = join(dirname(configPath), `.opencode2-plugin.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(tempPath, updated, "utf8")
  renameSync(tempPath, configPath)

  return { changed: true, configPath, backupPath: backup.backupPath }
}
