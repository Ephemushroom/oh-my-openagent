import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { loadOpenCode2Config } from "../../../packages/omo-opencode2/src/config"

function probe(label: string, body: Record<string, unknown>): void {
  const home = join(tmpdir(), `oc2cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const project = join(home, "project")
  mkdirSync(join(project, ".omo"), { recursive: true })
  writeFileSync(join(project, ".omo", "omo.json"), JSON.stringify(body))
  process.env.HOME = home
  process.env.USERPROFILE = home

  const result = loadOpenCode2Config({ directory: project, options: {} })
  console.log(`--- ${label}`)
  console.log("  sources:", result.sources.length)
  console.log("  monitor:", JSON.stringify(result.config.monitor))
  console.log("  boulder:", JSON.stringify(result.config.boulder))
  console.log("  diag:", result.diagnostics.length === 0 ? "none" : result.diagnostics[0]?.message?.slice(0, 90))
  rmSync(home, { recursive: true, force: true })
}

probe("root boulder only", { boulder: { enabled: true } })
probe("root monitor only", { monitor: { enabled: true, allowed_commands: ["node"] } })
probe("opencode2 block monitor", { "[opencode2]": { monitor: { enabled: true, allowed_commands: ["node"] } } })
probe("opencode block monitor", { "[opencode]": { monitor: { enabled: true, allowed_commands: ["node"] } } })
