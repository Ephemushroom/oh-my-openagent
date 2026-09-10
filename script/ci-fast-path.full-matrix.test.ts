/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const classifierPath = new URL("./ci-fast-path.mjs", import.meta.url)

interface FullMatrixMode {
  readonly generatedReleasePush: boolean
  readonly webOnly: boolean
  readonly runHeavy: boolean
  readonly fullMatrix: boolean
}

interface ClassifyInput {
  readonly eventName: string
  readonly message?: string
  readonly changedPaths?: readonly string[]
  readonly diffAvailable?: boolean
  readonly mergeParents?: number
  readonly headRef?: string
  readonly labels?: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function classify(input: ClassifyInput): FullMatrixMode {
  const changedPaths = input.changedPaths ?? []
  const stdout = execFileSync(
    "node",
    [
      fileURLToPath(classifierPath),
      "--event",
      input.eventName,
      "--message",
      input.message ?? "chore: routine change",
      "--diff-available",
      String(input.diffAvailable ?? true),
      "--merge-parents",
      String(input.mergeParents ?? 1),
      "--head-ref",
      input.headRef ?? "",
      "--labels",
      JSON.stringify(input.labels ?? []),
    ],
    {
      encoding: "utf8",
      input: changedPaths.length === 0 ? "" : `${changedPaths.join("\0")}\0`,
    },
  )
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed)) throw new Error("classifier output must be an object")
  const generatedReleasePush = parsed["generatedReleasePush"]
  const webOnly = parsed["webOnly"]
  const runHeavy = parsed["runHeavy"]
  const fullMatrix = parsed["fullMatrix"]
  if (
    typeof generatedReleasePush !== "boolean" ||
    typeof webOnly !== "boolean" ||
    typeof runHeavy !== "boolean" ||
    typeof fullMatrix !== "boolean"
  ) {
    throw new Error("classifier output must contain boolean CI mode fields including fullMatrix")
  }
  return { generatedReleasePush, webOnly, runHeavy, fullMatrix }
}

describe("full-matrix classification", () => {
  describe("#given a push event", () => {
    test("#then the full matrix always runs", () => {
      // given / when
      const mode = classify({ eventName: "push", changedPaths: ["packages/utils/src/index.ts"] })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given an ordinary pull request touching platform-neutral paths", () => {
    test("#then the full matrix is skipped", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["packages/utils/src/index.ts", "packages/model-core/src/index.ts"],
      })

      // then
      expect(mode.fullMatrix).toBe(false)
      expect(mode.runHeavy).toBe(true)
    })
  })

  describe("#given a release-state head branch", () => {
    test.each([
      "release/v5.0.0-source-state",
      "release/v5.0.0-beta.11-source-state",
    ])("#then %s forces the full matrix", (headRef) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef,
        changedPaths: ["package.json"],
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given the ci:full-matrix label", () => {
    test("#then the full matrix is forced on an otherwise neutral pull request", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["packages/utils/src/index.ts"],
        labels: ["bug", "ci:full-matrix"],
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given a platform-sensitive changed path", () => {
    test.each([
      ["basename contains windows", "packages/senpi-task/src/runners/rpc-process.windows.test.ts"],
      ["basename contains win32", "packages/utils/src/spawn-win32.ts"],
      ["powershell script", "script/qa/run-smoke.ps1"],
      ["ci workflow", ".github/workflows/ci.yml"],
      ["classifier itself", "script/ci-fast-path.mjs"],
      ["windows shard bunfig", "bunfig.win2.parallel.toml"],
      ["shared serial quarantine", "script/root-test-serial-quarantine.ts"],
      ["reply-listener process identity (win32 branch)", "packages/openclaw-core/src/reply-listener-process.ts"],
    ])("#then %s forces the full matrix", (_name, changedPath) => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        changedPaths: ["packages/utils/src/index.ts", changedPath],
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })

  describe("#given the diff is unavailable", () => {
    test("#then the classifier fails open to the full matrix", () => {
      // given / when
      const mode = classify({
        eventName: "pull_request",
        headRef: "feature/tidy-docs",
        diffAvailable: false,
      })

      // then
      expect(mode.fullMatrix).toBe(true)
    })
  })
})
