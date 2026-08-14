import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { loadOpenCode2Config } from "./loader"

function writeJsonc(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function makeFixture(): {
  readonly homeDir: string
  readonly projectDir: string
} {
  const root = mkdtempSync(join(tmpdir(), "opencode2-config-loader-"))
  const homeDir = join(root, "home")
  const projectDir = join(root, "project")
  mkdirSync(homeDir, { recursive: true })
  mkdirSync(projectDir, { recursive: true })
  return { homeDir, projectDir }
}

describe("loadOpenCode2Config", () => {
  test("#given layers with overlapping keys #when loaded #then precedence is base(user)<base(proj)<block(user)<block(proj)<options", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{
        "agents": { "sisyphus": { "model": "base-user", "temperature": 0.1 } },
        "[opencode2]": { "agents": { "sisyphus": { "model": "block-user" } }, "default_agent": "block-user-default" }
      }`
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{
        "agents": { "sisyphus": { "model": "base-proj", "description": "proj-desc" } },
        "[opencode2]": { "agents": { "sisyphus": { "model": "block-proj" } }, "default_agent": "block-proj-default" }
      }`
    )
    const options = { agents: { sisyphus: { model: "options-model" } } }

    // when
    const result = loadOpenCode2Config({
      directory: fixture.projectDir,
      environment: { HOME: fixture.homeDir },
      options,
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.default_agent).toBe("block-proj-default")
    expect(result.config.agents?.sisyphus?.model).toBe("options-model")
    // Keys inherited from lower priority layers should be preserved
    expect(result.config.agents?.sisyphus?.temperature).toBe(0.1)
    expect(result.config.agents?.sisyphus?.description).toBe("proj-desc")
  })

  test("#given a missing config file #when loaded #then defaults survive with no errors", () => {
    // given
    const fixture = makeFixture()

    // when
    const result = loadOpenCode2Config({
      directory: fixture.projectDir,
      environment: { HOME: fixture.homeDir },
      options: {},
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.default_agent).toBeUndefined()
  })

  test("#given a malformed config file #when loaded #then it returns diagnostics but does not throw", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(join(fixture.homeDir, ".omo", "omo.jsonc"), `{ "agents": { "bad" `) // Syntax error

    // when
    const result = loadOpenCode2Config({
      directory: fixture.projectDir,
      environment: { HOME: fixture.homeDir },
      options: {},
    })

    // then
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]?.kind).toBe("parse")
    expect(result.config.default_agent).toBeUndefined()
  })

  test("#given security-restricted keys in project or options #when loaded #then they are ignored and only user values are kept", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, ".omo", "omo.jsonc"),
      `{
        "[opencode2]": {
          "mcp_env_allowlist": ["USER_KEY"],
          "browser_automation_engine": { "playwright_mcp_args": ["--user"] }
        }
      }`
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{
        "[opencode2]": {
          "mcp_env_allowlist": ["PROJ_KEY"],
          "browser_automation_engine": { "playwright_mcp_args": ["--proj"] }
        }
      }`
    )
    const options = {
      mcp_env_allowlist: ["OPTIONS_KEY"],
      browser_automation_engine: { playwright_mcp_args: ["--options"] }
    }

    // when
    const result = loadOpenCode2Config({
      directory: fixture.projectDir,
      environment: { HOME: fixture.homeDir },
      options,
    })

    // then
    expect(result.diagnostics).toEqual([])
    
    // Note: The adapter doesn't type these in OpenCode2ConfigSchema but they should exist 
    // on the returned object from the raw merger because they are user-only security keys.
    const rawResult = result.rawConfig as any
    expect(rawResult.mcp_env_allowlist).toEqual(["USER_KEY"])
    expect(rawResult.browser_automation_engine?.playwright_mcp_args).toEqual(["--user"])
  })
})
