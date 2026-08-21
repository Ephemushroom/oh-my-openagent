import { describe, expect, test } from "bun:test"

import { registerBuiltinMcps } from "./register"
import type { Context } from "@opencode-ai/plugin/promise/plugin"

type DraftServer = [string, Record<string, unknown>]

function createContextWith(initial: DraftServer[]): {
  ctx: Context
  set: (callback: (draft: { list(): DraftServer[]; set(name: string, config: unknown): void }) => void | Promise<void>) => Promise<unknown>
} {
  let servers: DraftServer[] = [...initial]
  const registrations: unknown[] = []
  const ctx = {
    mcp: {
      transform: (callback: (draft: { list(): DraftServer[]; set(name: string, config: unknown): void }) => void | Promise<void>) => {
        const registration = Promise.resolve(
          callback({
            list: () => servers,
            set: (name, config) => {
              servers = [...servers, [name, config as Record<string, unknown>]]
            },
          }),
        )
        registrations.push(registration)
        return registration
      },
      list: () => Promise.resolve({ location: {}, data: servers.map(([name]) => ({ name, status: { status: "pending" } })) }),
      reload: () => Promise.resolve(),
    },
    options: {},
  }
  return { ctx: ctx as unknown as Context, set: async (cb) => Promise.all(registrations.push(Promise.resolve(cb)) as never) }
}

function writeOmoConfig(dir: string, config: Record<string, unknown>): void {
  const fs = require("node:fs") as typeof import("node:fs")
  fs.mkdirSync(`${dir}/.omo`, { recursive: true })
  fs.writeFileSync(`${dir}/.omo/omo.json`, JSON.stringify(config))
}

describe("registerBuiltinMcps", () => {
  test("registers remote + lsp built-ins; codegraph only when the binary resolves", async () => {
    const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "oc2-mcp-"))
    const { ctx } = createContextWith([])
    const result = await registerBuiltinMcps(ctx, { cwd: dir, env: {} })
    // context7 / grep_app / lsp always register; codegraph depends on the
    // binary resolving in the temp environment, so assert it as a subset.
    expect(result.registered).toContain("context7")
    expect(result.registered).toContain("grep_app")
    expect(result.registered).toContain("lsp")
    expect(result.registered.length).toBeGreaterThanOrEqual(3)
    expect(result.registered.length).toBeLessThanOrEqual(4)
  })

  test("never overwrites a user-defined server", async () => {
    const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "oc2-mcp-"))
    const userConfig = { type: "remote", url: "https://user.example/mcp" }
    const { ctx } = createContextWith([["context7", userConfig]])
    const result = await registerBuiltinMcps(ctx, { cwd: dir, env: {} })
    expect(result.registered).not.toContain("context7")
  })

  test("disabled_mcps removes built-ins entirely", async () => {
    const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "oc2-mcp-"))
    writeOmoConfig(dir, { "[opencode2]": { disabled_mcps: ["context7", "grep_app"] } })
    const { ctx } = createContextWith([])
    const result = await registerBuiltinMcps(ctx, { cwd: dir, env: {} })
    expect(result.registered).not.toContain("context7")
    expect(result.registered).not.toContain("grep_app")
  })
})
