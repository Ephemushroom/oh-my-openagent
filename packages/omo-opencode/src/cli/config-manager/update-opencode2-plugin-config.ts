import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

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
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0 || !isRecord(parsed)) {
    throw new Error("opencode config must be a valid JSON object")
  }

  const directory = resolve(pluginEntry)
  const legacyFile = join(directory, "index.ts")
  const matches: { key: string; index: number; path: (string | number)[]; configured: boolean; legacy: boolean }[] = []
  let nativeCount = 0
  for (const key of ["plugin", "plugins"]) {
    const value: unknown = parsed[key]
    if (value === undefined) continue
    if (!Array.isArray(value)) throw new Error(`opencode config \`${key}\` must be an array`)
    const entries: readonly unknown[] = value
    if (key === "plugins") nativeCount = entries.length
    entries.forEach((entry, index) => {
      let specifier: unknown = entry
      const path: (string | number)[] = [key, index]
      if (key === "plugin" && Array.isArray(entry)) {
        specifier = entry[0]
        path.push(0)
      } else if (key === "plugins" && isRecord(entry)) {
        specifier = entry.package
        path.push("package")
      }
      if (typeof specifier !== "string") return
      if (!isAbsolute(specifier) && !specifier.startsWith(".") && !specifier.startsWith("file:")) return
      const target = specifier.startsWith("file:")
        ? resolve(fileURLToPath(specifier))
        : resolve(dirname(configPath), specifier)
      if (target !== directory && target !== legacyFile) return
      matches.push({ key, index, path, configured: typeof entry !== "string", legacy: target === legacyFile })
    })
  }
  const configured = matches.filter((entry) => entry.configured)
  if (configured.length > 1) throw new Error("multiple configured OMO plugin entries require manual reconciliation")
  const retained = configured[0] ?? matches[0]
  const formattingOptions = { insertSpaces: true, tabSize: 2 }
  let updated = text
  if (retained) {
    if (retained.legacy) updated = applyEdits(updated, modify(updated, retained.path, pluginEntry, { formattingOptions }))
    for (const duplicate of [...matches].reverse()) {
      if (duplicate === retained) continue
      updated = applyEdits(updated, modify(updated, [duplicate.key, duplicate.index], undefined, { formattingOptions }))
    }
  } else {
    updated = applyEdits(updated, parsed.plugins === undefined
      ? modify(updated, ["plugins"], [pluginEntry], { formattingOptions })
      : modify(updated, ["plugins", nativeCount], pluginEntry, { formattingOptions, isArrayInsertion: true }))
  }
  if (updated === text) {
    return { changed: false, configPath }
  }

  const backup = backupConfigFile(configPath)
  const tempPath = join(dirname(configPath), `.opencode2-plugin.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(tempPath, updated, "utf8")
  renameSync(tempPath, configPath)

  return { changed: true, configPath, backupPath: backup.backupPath }
}
