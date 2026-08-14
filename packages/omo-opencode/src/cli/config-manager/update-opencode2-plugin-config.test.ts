import { describe, expect, it, afterEach } from "bun:test"
import { writeFileSync, existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { updateOpenCode2PluginConfig } from "./update-opencode2-plugin-config"

describe("updateOpenCode2PluginConfig", () => {
  const tempFiles: string[] = []

  function createTempConfig(content: string): string {
    const p = join(tmpdir(), `.test-opencode2-plugin-${Date.now()}-${Math.random()}.jsonc`)
    writeFileSync(p, content, "utf8")
    tempFiles.push(p)
    return p
  }

  afterEach(() => {
    for (const p of tempFiles) {
      if (existsSync(p)) rmSync(p)
    }
  })

  describe("#given a fresh config with no plugins key", () => {
    it("should append the plugins array with the entry", () => {
      const config = createTempConfig(`{
  "mcp": { "servers": {} }
}`)
      const result = updateOpenCode2PluginConfig({ configPath: config, pluginEntry: "/absolute/path/to/plugin" })
      expect(result.changed).toBe(true)
      const text = readFileSync(config, "utf8")
      expect(text).toContain('"plugins": [')
      expect(text).toContain('"/absolute/path/to/plugin"')
    })
  })

  describe("#given a config with an existing unrelated plugin entry", () => {
    it("should append the new entry, not replace", () => {
      const config = createTempConfig(`{
  "plugins": [
    "other-plugin"
  ]
}`)
      const result = updateOpenCode2PluginConfig({ configPath: config, pluginEntry: "/absolute/path/to/plugin" })
      expect(result.changed).toBe(true)
      const text = readFileSync(config, "utf8")
      expect(text).toContain('"other-plugin"')
      expect(text).toContain('"/absolute/path/to/plugin"')
    })
  })

  describe("#given the entry is already present", () => {
    it("should not duplicate the entry", () => {
      const config = createTempConfig(`{
  "plugins": [
    "other-plugin",
    "/absolute/path/to/plugin"
  ]
}`)
      const result = updateOpenCode2PluginConfig({ configPath: config, pluginEntry: "/absolute/path/to/plugin" })
      expect(result.changed).toBe(false)
      const text = readFileSync(config, "utf8")
      const matches = text.match(/\/absolute\/path\/to\/plugin/g)
      expect(matches?.length).toBe(1)
    })
  })

  describe("#given malformed JSONC", () => {
    it("should fail closed and leave the file untouched", () => {
      // given a config whose syntax jsonc-parser would otherwise recover from
      const original = `{ "plugins": [ }`
      const config = createTempConfig(original)

      // when the writer runs
      const run = () => updateOpenCode2PluginConfig({ configPath: config, pluginEntry: "/abs/path" })

      // then it refuses to write and the original bytes survive
      expect(run).toThrow("opencode config is not valid JSONC")
      expect(readFileSync(config, "utf8")).toBe(original)
    })
  })

  describe("#given a non-array plugins value", () => {
    it("should fail closed", () => {
      const config = createTempConfig(`{ "plugins": "not-an-array" }`)
      expect(() => updateOpenCode2PluginConfig({ configPath: config, pluginEntry: "/abs/path" })).toThrow("opencode config `plugins` must be an array")
    })
  })
})
