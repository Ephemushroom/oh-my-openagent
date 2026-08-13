import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"

import { buildOpenCode2Entries } from "../../../packages/omo-opencode/src/cli/install-opencode2"
import { updateOpenCode2McpConfig } from "../../../packages/omo-opencode/src/cli/config-manager/update-opencode2-mcp-config"

const evidenceDir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const outDir = join(evidenceDir, "out")
mkdirSync(outDir, { recursive: true })

const isolatedDir = join(outDir, "isolated")
mkdirSync(isolatedDir, { recursive: true })
const configPath = join(isolatedDir, "opencode.json")
writeFileSync(
  configPath,
  `{
  "plugins": ["oh-my-opencode2"],
  "mcp": { "servers": {} }
}
`,
  "utf8",
)

const entries = buildOpenCode2Entries({
  codegraph: {
    command: "node",
    argsPrefix: ["/abs/codegraph/cli.js"],
    exists: true,
    source: "bundled",
  },
  nodeCommand: "node",
  daemonCliPath: "/abs/lsp/cli.js",
})

const first = updateOpenCode2McpConfig({ configPath, entries })
const second = updateOpenCode2McpConfig({ configPath, entries })
const written = readFileSync(configPath, "utf8")

const names = entries.map((entry) => entry.name)
const remotes = entries.filter((entry) => entry.type === "remote")
const checks = {
  names,
  remoteNames: remotes.map((entry) => entry.name),
  remotesHaveUrl: remotes.every((entry) => typeof entry.url === "string" && entry.url.startsWith("https://")),
  remotesCodemodeFalse: remotes.every((entry) => entry.codemode === false),
  remotesHaveNoHeaders: remotes.every((entry) => entry.environment === undefined),
  writtenHasWebsearch: written.includes("https://mcp.exa.ai/mcp?tools=web_search_exa"),
  writtenHasContext7: written.includes("https://mcp.context7.com/mcp"),
  writtenHasGrepApp: written.includes("https://mcp.grep.app"),
  firstChanged: first.changed,
  firstAdded: first.added,
  secondUnchanged: second.changed === false,
}

const realJson = join(process.env.USERPROFILE ?? "", ".config", "opencode", "opencode.json")
const realJsonc = join(process.env.USERPROFILE ?? "", ".config", "opencode", "opencode.jsonc")
const hashFile = (path: string): string => {
  if (!existsSync(path)) return ""
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase()
}
const realAfter = [hashFile(realJson), hashFile(realJsonc)].filter(Boolean).join("|")
const realBefore = existsSync(join(outDir, "real-hash-before.txt"))
  ? readFileSync(join(outDir, "real-hash-before.txt"), "utf8")
  : ""

const isolationClean = realBefore.length > 0 && realAfter === realBefore
const pass =
  names.includes("websearch") &&
  names.includes("context7") &&
  names.includes("grep_app") &&
  checks.remotesHaveUrl &&
  checks.remotesCodemodeFalse &&
  checks.remotesHaveNoHeaders &&
  checks.writtenHasWebsearch &&
  checks.writtenHasContext7 &&
  checks.writtenHasGrepApp &&
  checks.firstChanged &&
  checks.secondUnchanged &&
  isolationClean

const report = {
  pass,
  isolationClean,
  realBefore,
  realAfter,
  checks,
  written,
}

writeFileSync(join(outDir, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
writeFileSync(join(outDir, "written-opencode.json"), written, "utf8")
console.log(JSON.stringify({ pass, isolationClean, names, firstAdded: first.added }, null, 2))
if (!pass) process.exit(1)
