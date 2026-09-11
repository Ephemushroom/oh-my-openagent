import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { resolveOpenCode2PluginEntry } from "./resolve-opencode2-plugin-entry"

describe("resolveOpenCode2PluginEntry", () => {
  const created: string[] = []

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "omo-oc2-entry-"))
    created.push(root)
    return root
  }

  function plantPluginEntry(root: string): string {
    const dir = join(root, "packages", "omo-opencode2", "src")
    mkdirSync(dir, { recursive: true })
    const entry = join(dir, "index.ts")
    writeFileSync(entry, "export default {}\n", "utf8")
    return entry
  }

  afterEach(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true })
    created.length = 0
  })

  describe("#given a source checkout containing the v2 adapter", () => {
    it("should find the entry when starting from a deeply nested directory", () => {
      // given a checkout with the plugin entry planted at the root
      const root = makeRoot()
      const entry = plantPluginEntry(root)
      const nested = join(root, "packages", "omo-opencode", "src", "cli")
      mkdirSync(nested, { recursive: true })

      // when resolving from the nested cli directory
      const result = resolveOpenCode2PluginEntry(nested)

      // then the walk-up locates the entry
      expect(result.exists).toBe(true)
      expect(result.entry).toBe(dirname(entry))
    })
  })

  describe("#given a tree without the v2 adapter", () => {
    it("should report the entry as missing instead of guessing a path", () => {
      // given a checkout that never ships omo-opencode2, as an npm install would be
      const root = makeRoot()
      const nested = join(root, "dist")
      mkdirSync(nested, { recursive: true })

      // when resolving
      const result = resolveOpenCode2PluginEntry(nested)

      // then it fails closed with no fabricated path
      expect(result.exists).toBe(false)
      expect(result.entry).toBe("")
    })
  })
})
