import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parse } from "jsonc-parser"
import { pathToFileURL } from "node:url"

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

  it.each(["absolute", "relative", "url"])("#given %s legacy OMO entry #when installing #then migrates in place and remains idempotent", (format) => {
    const entry = join(tempDir, "adapter", "src")
    const file = join(entry, "index.ts")
    const old = format === "url" ? pathToFileURL(file).href : format === "relative" ? "./adapter/src/index.ts" : file
    writeFileSync(configPath, `{// retained comment\n"plugins": ["unrelated", {"package": ${JSON.stringify(old)}, "options": {"custom": 7}}]}`)
    const first = updateOpenCode2PluginConfig({ configPath, pluginEntry: entry })
    const changed = readFileSync(configPath, "utf8")
    expect(first.changed).toBe(true)
    expect(parse(changed)).toEqual({ plugins: ["unrelated", { package: entry, options: { custom: 7 } }] })
    expect(changed).toContain("// retained comment")
    expect(first.backupPath).toBeDefined()
    expect(updateOpenCode2PluginConfig({ configPath, pluginEntry: entry }).changed).toBe(false)
    expect(readFileSync(configPath, "utf8")).toBe(changed)
  })

  it("#given a legacy tuple and duplicate native directory #when installing #then preserves options without duplicating OMO", () => {
    const entry = join(tempDir, "adapter", "src")
    writeFileSync(configPath, JSON.stringify({ plugin: [[join(entry, "index.ts"), { custom: 7 }], "v1-other"], plugins: [entry, "v2-other"] }))
    updateOpenCode2PluginConfig({ configPath, pluginEntry: entry })
    expect(parse(readFileSync(configPath, "utf8"))).toEqual({ plugin: [[entry, { custom: 7 }], "v1-other"], plugins: ["v2-other"] })
    expect(updateOpenCode2PluginConfig({ configPath, pluginEntry: entry }).changed).toBe(false)
  })

  it("#given conflicting configured OMO duplicates #when installing #then refuses without changing the file", () => {
    const entry = join(tempDir, "adapter", "src")
    const original = JSON.stringify({ plugins: [{ package: entry, options: { n: 1 } }, { package: join(entry, "index.ts"), options: { n: 2 } }] })
    writeFileSync(configPath, original)
    expect(() => updateOpenCode2PluginConfig({ configPath, pluginEntry: entry })).toThrow("multiple configured OMO")
    expect(readFileSync(configPath, "utf8")).toBe(original)
  })

  it("#given a malformed legacy plugin array #when installing #then fails closed", () => {
    const original = '{"plugin":42}'
    writeFileSync(configPath, original)
    expect(() => updateOpenCode2PluginConfig({ configPath, pluginEntry: "/adapter/src" })).toThrow("must be an array")
    expect(readFileSync(configPath, "utf8")).toBe(original)
  })

  it("#given a trailing-slash directory URL before a configured legacy entry #when migrating #then options survive in one entry", () => {
    const entry = join(tempDir, "adapter", "src")
    writeFileSync(configPath, JSON.stringify({ plugins: [pathToFileURL(`${entry}/`).href, { package: join(entry, "index.ts"), options: { custom: 7 } }] }))
    updateOpenCode2PluginConfig({ configPath, pluginEntry: entry })
    expect(parse(readFileSync(configPath, "utf8"))).toEqual({ plugins: [{ package: entry, options: { custom: 7 } }] })
    expect(updateOpenCode2PluginConfig({ configPath, pluginEntry: entry }).changed).toBe(false)
  })
})
