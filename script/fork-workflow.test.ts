import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const workflowsDirectory = new URL("../.github/workflows/", import.meta.url)
const workflowSchema = z.object({
  on: z.record(z.string(), z.unknown()),
  permissions: z.record(z.string(), z.string()),
  jobs: z.record(z.string(), z.object({
    "runs-on": z.string().optional(),
    "timeout-minutes": z.number().optional(),
    if: z.string().optional(),
    strategy: z.unknown().optional(),
    steps: z.array(z.object({
      name: z.string().optional(),
      run: z.string().optional(),
      uses: z.string().optional(),
      with: z.record(z.string(), z.unknown()).optional(),
    })).optional(),
  })),
})

function readWorkflow(name: string) {
  return workflowSchema.parse(Bun.YAML.parse(readFileSync(new URL(name, workflowsDirectory), "utf8")))
}

describe("fork workflow policy", () => {
  test.each(["master", "dev"])("#given a %s PR without checkout #when the real guard and summary run #then only master is rejected and the summary succeeds", (baseRef) => {
    const steps = readWorkflow("ci.yml").jobs["block-master-pr"]?.steps ?? []
    const guard = steps.find((step) => step.name === "Check PR target branch")?.run
    const summary = steps.find((step) => step.name === "Write job summary")?.run
    if (guard === undefined || summary === undefined) throw new Error("PR guard and summary steps must exist")
    expect(steps.some((step) => step.uses?.startsWith("actions/checkout"))).toBe(false)
    const directory = mkdtempSync(join(tmpdir(), "omo-pr-guard-"))
    const summaryPath = join(directory, "summary.md")
    const status = baseRef === "master" ? "failure" : "success"
    const env = {
      ...process.env, BASE_REF: baseRef, PR_URL: "https://example.invalid/pull/1", PR_AUTHOR: "fixture",
      GITHUB_STEP_SUMMARY: summaryPath, JOB_SUMMARY_STATUS: status,
    }
    try {
      const result = Bun.spawnSync(["bash", "-c", `gh() { printf 'gh %s\\n' "$*"; }; ${guard}`], {
        cwd: directory, env, stdout: "pipe", stderr: "pipe",
      })
      expect(result.exitCode).toBe(baseRef === "master" ? 1 : 0)
      expect(result.stdout.toString().includes("gh pr close https://example.invalid/pull/1")).toBe(baseRef === "master")
      const summaryResult = Bun.spawnSync(["bash", "-c", summary], {
        cwd: directory, env, stdout: "pipe", stderr: "pipe",
      })
      expect(summaryResult.exitCode, summaryResult.stderr.toString()).toBe(0)
      const content = readFileSync(summaryPath, "utf8")
      expect(content).toContain(baseRef)
      expect(content).toContain(status)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("#given merged workflows #when triggers are inspected #then only CI and lint run automatically", () => {
    const names = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name)).sort()
    expect(names).toEqual(["ci.yml", "lint-workflows.yml", "publish-platform.yml", "publish.yml"])
    expect(Object.keys(readWorkflow("ci.yml").on).sort()).toEqual(["pull_request", "push"])
    expect(Object.keys(readWorkflow("lint-workflows.yml").on).sort()).toEqual(["pull_request", "push"])
    expect(Object.keys(readWorkflow("publish.yml").on)).toEqual(["workflow_dispatch"])
    expect(Object.keys(readWorkflow("publish-platform.yml").on).sort()).toEqual(["workflow_call", "workflow_dispatch"])
  })

  test("#given fork CI #when jobs are inspected #then Linux gates cannot restore release or platform jobs", () => {
    const workflow = readWorkflow("ci.yml")
    expect(Object.keys(workflow.jobs).sort()).toEqual(["block-master-pr", "test", "typecheck"])
    expect(workflow.permissions).toEqual({ contents: "read" })
    for (const job of Object.values(workflow.jobs)) {
      expect(job["runs-on"]).toBe("ubuntu-latest")
      expect(job.strategy).toBeUndefined()
    }
  })

  test("#given upstream runtime requirements #when test preparation is inspected #then the serial gate builds before testing", () => {
    const job = readWorkflow("ci.yml").jobs["test"]
    expect(job?.["timeout-minutes"]).toBe(60)
    const steps = job?.steps ?? []
    expect(steps.find((step) => step.uses === "oven-sh/setup-bun@v2")?.with?.["bun-version"]).toBe("1.4.2")
    expect(steps.find((step) => step.uses === "actions/setup-node@v7")?.with?.["node-version"]).toBe("24")
    const commands = steps.flatMap((step) => step.run === undefined ? [] : [step.run])
    expect(commands.filter((command) => command.startsWith("bun "))).toEqual([
      "bun install --frozen-lockfile --ignore-scripts",
      "bun run build",
      "bun run script/remove-stale-self-package-tests.ts",
      "bun test --timeout 20000",
    ])
    expect(readWorkflow("ci.yml").jobs["typecheck"]?.steps?.some((step) => step.run === "bun run typecheck")).toBe(true)
  })
})
