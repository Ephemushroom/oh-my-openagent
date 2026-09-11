import { existsSync } from "node:fs"
import { dirname, join, parse as parsePath } from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_ENTRY_SEGMENTS = ["packages", "omo-opencode2", "src", "index.ts"] as const

export interface OpenCode2PluginEntryResolution {
  entry: string
  exists: boolean
  searchedFrom: string
}

/**
 * Walks up from `startDir` looking for the omo-opencode2 plugin entry.
 *
 * The v2 adapter is a private, unpublished workspace package and is not part of
 * the root `files` array, so it exists only in a source checkout. An installed
 * npm copy resolves nothing, which callers must treat as a hard failure rather
 * than writing a path that would not load.
 */
export function resolveOpenCode2PluginEntry(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): OpenCode2PluginEntryResolution {
  const { root } = parsePath(startDir)
  let current = startDir

  while (true) {
    const candidate = join(current, ...PLUGIN_ENTRY_SEGMENTS)
    if (existsSync(candidate)) {
      return { entry: dirname(candidate), exists: true, searchedFrom: startDir }
    }
    if (current === root) {
      return { entry: "", exists: false, searchedFrom: startDir }
    }
    const parent = dirname(current)
    if (parent === current) {
      return { entry: "", exists: false, searchedFrom: startDir }
    }
    current = parent
  }
}
