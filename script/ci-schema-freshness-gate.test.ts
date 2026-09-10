/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const SCHEMA_GATE_STEP_NAME = "Verify generated schema artifacts are committed"
const SCHEMA_ARTIFACTS = ["assets/oh-my-opencode.schema.json", "assets/omo.schema.json"]

interface WorkflowStep {
  readonly name: string | undefined
  readonly run: string | undefined
  readonly if: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function toWorkflowStep(value: unknown): WorkflowStep {
  if (!isRecord(value)) return { name: undefined, run: undefined, if: undefined }
  return { name: stringField(value, "name"), run: stringField(value, "run"), if: stringField(value, "if") }
}

function testJobSteps(): readonly WorkflowStep[] {
  const parsed: unknown = load(readFileSync(ciWorkflowPath, "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed["jobs"]) || !isRecord(parsed["jobs"]["test"])) {
    throw new Error("ci.yml must define a test job")
  }
  const steps = parsed["jobs"]["test"]["steps"]
  if (!Array.isArray(steps)) throw new Error("ci.yml test job must define steps")
  return steps.map(toWorkflowStep)
}

describe("ci test prerequisite schema freshness gate", () => {
  test("#given the test job #when its steps are read #then a schema drift gate runs after the build that regenerates the artifacts", () => {
    // given
    const steps = testJobSteps()

    // when
    const buildIndex = steps.findIndex((step) => step.name === "Build test prerequisites")
    const gateIndex = steps.findIndex((step) => step.name === SCHEMA_GATE_STEP_NAME)
    const gate = steps[gateIndex]

    // then
    expect(buildIndex).toBeGreaterThanOrEqual(0)
    expect(gateIndex).toBeGreaterThan(buildIndex)
    expect(gate?.if).toBeUndefined()
    expect(gate?.run).toContain(`git diff --exit-code -- ${SCHEMA_ARTIFACTS.join(" ")}`)
  })

  test("#given the schema drift gate #when it fails #then it tells the author which command regenerates the artifacts", () => {
    // given
    const gate = testJobSteps().find((step) => step.name === SCHEMA_GATE_STEP_NAME)

    // when
    const run = gate?.run ?? ""

    // then
    expect(run).toContain("bun run build:schema && bun run build:omo-schema")
  })
})
