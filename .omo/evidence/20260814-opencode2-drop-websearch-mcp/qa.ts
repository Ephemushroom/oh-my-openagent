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
const written = readFileSync(configPath, "utf8")
const names = entries.map((entry) => entry.name)

const realJson = join(process.env.USERPROFILE ?? "", ".config", "opencode", "opencode.json")
const hashFile = (path: string): string => {
  if (!existsSync(path)) return ""
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase()
}
const realAfter = hashFile(realJson)
const realBefore = existsSync(join(outDir, "real-hash-before.txt"))
  ? readFileSync(join(outDir, "real-hash-before.txt"), "utf8")
  : ""

const isolationClean = realBefore.length > 0 && realAfter === realBefore
const pass =
  names.includes("codegraph") &&
  names.includes("lsp") &&
  names.includes("context7") &&
  names.includes("grep_app") &&
  !names.includes("websearch") &&
  !written.includes("mcp.exa.ai") &&
  written.includes("https://mcp.context7.com/mcp") &&
  written.includes("https://mcp.grep.app") &&
  first.changed &&
  isolationClean

const report = { pass, isolationClean, realBefore, realAfter, names, firstAdded: first.added, written }
writeFileSync(join(outDir, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
writeFileSync(join(outDir, "written-opencode.json"), written, "utf8")
console.log(JSON.stringify({ pass, isolationClean, names, firstAdded: first.added }, null, 2))
if (!pass) process.exit(1)
