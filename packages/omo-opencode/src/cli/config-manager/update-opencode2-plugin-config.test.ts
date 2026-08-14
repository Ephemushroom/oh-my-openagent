import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { updateOpenCode2PluginConfig } from "./update-opencode2-plugin-config"

describe("updateOpenCode2PluginConfig", () => {
  let tempDir: string
  let configPath: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `omo-test-${Date.now()}-${Math.random()}`)
    require("node:fs").mkdirSync(tempDir, { recursive: true })
    configPath = join(tempDir, "opencode.jsonc")
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("#given fresh config with no plugins key #when called #then adds plugins array with entry", () => {
    // given
    writeFileSync(configPath, `{\n  "mcp": { "servers": {} }\n}`)

    // when
    const result = updateOpenCode2PluginConfig({
      configPath,
      pluginEntry: "/absolute/path/to/plugin.js",
    })

    // then
    expect(result.changed).toBe(true)
    const text = readFileSync(configPath, "utf8")
    expect(text).toContain(`"plugins": [\n    "/absolute/path/to/plugin.js"\n  ]`)
    expect(text).toContain(`"servers": {}`)
  })

  it("#given config with existing unrelated plugin #when called #then appends without touching existing", () => {
    // given
    writeFileSync(
      configPath,
      `{\n  // comment\n  "plugins": [\n    "other-plugin"\n  ]\n}`,
    )

    // when
    const result = updateOpenCode2PluginConfig({
      configPath,
      pluginEntry: "/absolute/path/to/plugin.js",
    })

    // then
    expect(result.changed).toBe(true)
    const text = readFileSync(configPath, "utf8")
    expect(text).toContain(`"other-plugin",\n    "/absolute/path/to/plugin.js"`)
    expect(text).toContain(`// comment`)
  })

  it("#given config with the entry already #when called #then is idempotent and returns unchanged", () => {
    // given
    writeFileSync(
      configPath,
      `{\n  "plugins": [\n    "/absolute/path/to/plugin.js"\n  ]\n}`,
    )

    // when
    const result = updateOpenCode2PluginConfig({
      configPath,
      pluginEntry: "/absolute/path/to/plugin.js",
    })

    // then
    expect(result.changed).toBe(false)
  })

  it("#given config with object-based plugin entry #when called #then is idempotent", () => {
    // given
    writeFileSync(
      configPath,
      `{\n  "plugins": [\n    { "package": "/absolute/path/to/plugin.js", "options": {} }\n  ]\n}`,
    )

    // when
    const result = updateOpenCode2PluginConfig({
      configPath,
      pluginEntry: "/absolute/path/to/plugin.js",
    })

    // then
    expect(result.changed).toBe(false)
  })

  it("#given non-array plugins key #when called #then fails closed", () => {
    // given
    writeFileSync(configPath, `{\n  "plugins": "not-an-array"\n}`)

    // when / then
    expect(() =>
      updateOpenCode2PluginConfig({
        configPath,
        pluginEntry: "/path",
      }),
    ).toThrow("must be an array")
  })

  it("#given malformed JSONC #when called #then fails closed", () => {
    // given
    writeFileSync(configPath, `{\n  "plugins": [\n}`)

    // when / then
    expect(() =>
      updateOpenCode2PluginConfig({
        configPath,
        pluginEntry: "/path",
      }),
    ).toThrow("opencode config must be a valid JSON object")
  })
})
