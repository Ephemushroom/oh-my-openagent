import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const evidence = dirname(fileURLToPath(import.meta.url))
const repo = resolve(evidence, "../../..")
const edition = process.argv[2] ?? "opencode2"
const label = process.env.QA_LABEL ?? edition
assert.ok(["opencode", "opencode2"].includes(edition))
const binary = process.env.QA_OPENCODE_BIN ?? execFileSync("which", [edition], { encoding: "utf8" }).trim()
const { sendSse, textEvents } = await import(pathToFileURL(join(repo, ".agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs")))
const root = mkdtempSync(join(tmpdir(), `omo-sync-${edition}-`))
const hostDb = join(homedir(), ".local/share/opencode/opencode.db")
const configPath = join(homedir(), ".config/opencode/opencode.json")
const digest = (path) => existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent"
const hostState = () => {
  const tables = existsSync(hostDb)
    ? execFileSync("sqlite3", ["-readonly", hostDb, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session','session_v2');"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
    : []
  return { configDigest: digest(configPath), sessions: Object.fromEntries(tables.map((table) => [table, Number(execFileSync("sqlite3", ["-readonly", hostDb, `SELECT count(*) FROM ${table};`], { encoding: "utf8" }))])) }
}
const before = hostState()
const requests = []
const children = new Set()
const results = []
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404).end()
    return
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  requests.push({ model: body.model, tools: (body.tools ?? []).map((tool) => tool.name ?? tool.function?.name) })
  sendSse(res, textEvents(requests.length, "QA_SYNC_OK"))
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
assert.ok(address && typeof address === "object")

async function run(command) {
  const child = spawn(binary, command.args, { cwd: command.cwd, env: command.env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  children.add(child)
  let output = ""
  child.stdout.on("data", (data) => { output += data })
  child.stderr.on("data", (data) => { output += data })
  const timer = setTimeout(() => {
    try { process.kill(-child.pid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
  }, 120000)
  try {
    const [code, signal] = await once(child, "exit")
    writeFileSync(join(evidence, `${label}-${command.name}.log`), output)
    return { code, signal, output }
  } finally {
    clearTimeout(timer)
    children.delete(child)
    try { process.kill(-child.pid, "SIGTERM") } catch (error) { if (error.code !== "ESRCH") throw error }
  }
}

try {
  for (const mode of ["enabled", "disabled"]) {
    const home = join(root, mode, "home")
    const project = join(home, "project")
    const config = join(root, mode, "config")
    for (const directory of [join(project, ".omo"), join(config, "opencode"), home]) mkdirSync(directory, { recursive: true })
    const env = {
      PATH: process.env.PATH, TMPDIR: tmpdir(), HOME: home, USERPROFILE: home,
      XDG_DATA_HOME: join(root, mode, "data"), XDG_CONFIG_HOME: config,
      XDG_STATE_HOME: join(root, mode, "state"), XDG_CACHE_HOME: join(root, mode, "cache"),
      OPENCODE_TEST_HOME: home, OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
      OMO_DISABLE_POSTHOG: "1", OMO_SEND_ANONYMOUS_TELEMETRY: "0", OPENAI_API_KEY: "fake-key",
      OMO_SPIKE_TRACE: join(root, mode, "trace.ndjson"),
    }
    const settings = {
      default_agent: "sisyphus", agents: { sisyphus: { model: "openai/gpt-fake" } },
      codegraph: { daemon: true, install_dir: join(root, "obsolete-codegraph") },
      disabled_mcps: mode === "disabled" ? ["context7", "grep_app", "lsp", "websearch"] : ["lsp", "websearch"],
      telemetry: false,
    }
    const observedPlugin = join(root, mode, "plugin")
    if (edition === "opencode2") {
      mkdirSync(observedPlugin, { recursive: true })
      const source = pathToFileURL(join(repo, "packages/omo-opencode2/src/index.ts")).href
      writeFileSync(join(observedPlugin, "index.ts"), `
import { appendFileSync } from "node:fs"
import plugin from ${JSON.stringify(source)}
export default { id: plugin.id, setup: async (ctx) => {
  const cleanup = await plugin.setup(ctx)
  await ctx.session.hook("context", async () => {
    const catalog = await ctx.mcp.list()
    appendFileSync(process.env.OMO_SPIKE_TRACE, JSON.stringify({ event: "qa.mcp.materialized", servers: catalog.data.map((server) => server.name) }) + "\\n")
  })
  return cleanup
} }
`)
    }
    writeFileSync(join(project, ".omo/omo.json"), JSON.stringify({ [`[${edition}]`]: settings }))
    writeFileSync(join(config, "opencode/opencode.json"), JSON.stringify({
      plugin: [edition === "opencode2" ? (process.env.QA_PLUGIN_FILES === "1" ? join(observedPlugin, "index.ts") : observedPlugin) : join(repo, "packages/omo-opencode/src/index.ts")], model: "openai/gpt-fake",
      provider: { openai: { options: { apiKey: "fake-key", baseURL: `http://127.0.0.1:${address.port}/v1`, timeout: 30000 }, models: { "gpt-fake": { tool_call: true, limit: { context: 200000, output: 8192 } } } } },
    }))
    if (mode === "enabled") {
      const version = await run({ name: "version", args: ["--version"], cwd: project, env })
      assert.equal(version.code, 0, "CLI version must succeed")
      const help = await run({ name: "help", args: ["run", "--help"], cwd: project, env })
      assert.equal(help.code, 0, "CLI help must succeed")
      const bad = await run({ name: "bad-input", args: ["run", "--omo-invalid-option"], cwd: project, env })
      assert.notEqual(bad.code, 0, "CLI must reject an unknown flag")
    }
    const args = edition === "opencode2"
      ? ["run", "--standalone", "--auto", "--log-level", "debug", "--model", "openai/gpt-fake", "Say QA_SYNC_OK."]
      : ["run", "--format", "json", "--model", "openai/gpt-fake", "Say QA_SYNC_OK."]
    const result = await run({ name: mode, args, cwd: project, env })
    assert.equal(result.code, 0, `${edition} ${mode} run must succeed`)
    assert.ok(result.output.includes("QA_SYNC_OK"), "mock response must reach the real CLI")
    if (edition === "opencode2") {
      const trace = readFileSync(env.OMO_SPIKE_TRACE, "utf8")
      writeFileSync(join(evidence, `${label}-${mode}-trace.ndjson`), trace)
      const events = trace.trim().split("\n").filter(Boolean).map(JSON.parse)
      assert.ok(events.some((event) => event.event === "omo.registration.complete"), "native OMO registration must run")
      assert.ok(events.some((event) => event.event === "omo.agent.registered" && event.id === "sisyphus"), "native Sisyphus must materialize")
      const mcps = events.findLast((event) => event.event === "qa.mcp.materialized")
      assert.ok(mcps, "native MCP registration must run")
      assert.ok(!mcps.servers.includes("codegraph"), "CodeGraph must not auto-register even with stale config")
      if (mode === "enabled") assert.deepEqual([...mcps.servers].sort(), ["context7", "grep_app"])
      else assert.deepEqual(mcps.servers, [])
    }
    results.push({ mode, status: "passed" })
  }
  assert.ok(requests.length >= 2, "real harness must contact the local mock provider")
} finally {
  for (const child of children) {
    try { process.kill(-child.pid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
  }
  await new Promise((resolveClose) => server.close(resolveClose))
  rmSync(root, { recursive: true, force: true })
  const after = hostState()
  writeFileSync(join(evidence, `${label}-receipt.json`), JSON.stringify({ results, requests, before, after, sandboxRemoved: !existsSync(root), mockClosed: !server.listening }, null, 2) + "\n")
  assert.deepEqual(after, before, "host session counts and config must stay unchanged")
}
console.log(`${edition}: live sync QA passed`)
