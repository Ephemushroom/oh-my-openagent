import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  ROOT_TEST_SERIAL_QUARANTINE_PATHS,
  serialQuarantineCommand,
} from "./root-test-serial-quarantine.ts"

const windowsTelemetryScript = readFileSync(
  new URL("../.github/scripts/windows-ci-telemetry.ps1", import.meta.url),
  "utf8",
)
const rootConfig = readFileSync(new URL("../bunfig.root.toml", import.meta.url), "utf8")
const win2Config = readFileSync(new URL("../bunfig.win2.toml", import.meta.url), "utf8")
const win2ParallelConfig = readFileSync(new URL("../bunfig.win2.parallel.toml", import.meta.url), "utf8")

function quotedPatterns(config: string): readonly string[] {
  return [...config.matchAll(/"([^"]+\/\*\*)"/g)].map((match) => match[1] ?? "")
}

function assertWindowsTelemetryContract(script: string): void {
  if (
    !script.includes("$postTestUtc") ||
    !script.includes("$postTestStopwatchTimestamp") ||
    !script.includes("postTest =")
  ) {
    throw new Error("windows telemetry contract: missing post-test capture")
  }
}

describe("root test partition support", () => {
  test("#given the quarantine module #when its serial command is rendered #then every listed path runs once", () => {
    const command = serialQuarantineCommand()
    expect(ROOT_TEST_SERIAL_QUARANTINE_PATHS.length).toBeGreaterThan(0)
    expect(command.split(" ").slice(4)).toEqual([...ROOT_TEST_SERIAL_QUARANTINE_PATHS])
  })

  test("#given the shared quarantine module #when the shard-2 bunfig is read #then it ignores exactly the quarantined files", () => {
    const quarantinedPaths = [...win2ParallelConfig.matchAll(/"([^"]+\.test\.ts)"/g)].map((match) => match[1] ?? "")
    expect(quarantinedPaths).toEqual([...ROOT_TEST_SERIAL_QUARANTINE_PATHS])
  })

  test("#given shard-2 config #when its exclusions are inspected #then every root exclusion remains active", () => {
    for (const pattern of quotedPatterns(rootConfig)) {
      expect(quotedPatterns(win2ParallelConfig)).toContain(pattern)
    }
  })

  test("#given local partition configs #when exclusions are inspected #then opencode and memory stay outside the remainder", () => {
    expect(quotedPatterns(win2Config)).toContain("packages/omo-opencode/**")
    expect(quotedPatterns(win2Config)).toContain("packages/memory-core/**")
  })

  test("#given local Senpi partitioning #when partition configs are read #then Senpi runs separately", () => {
    for (const config of [rootConfig, win2Config, win2ParallelConfig]) {
      expect(quotedPatterns(config)).toContain("packages/omo-senpi/**")
    }
  })

  test("#given a telemetry fixture without post-test state #when the contract is checked #then the diagnostic is stable", () => {
    const missingPostTestCapture = `
      $preTestUtc = [DateTime]::UtcNow.ToString("o")
      $preTestStopwatchTimestamp = [System.Diagnostics.Stopwatch]::GetTimestamp()
      exit $testExitCode
    `
    expect(() => assertWindowsTelemetryContract(missingPostTestCapture)).toThrow(
      "windows telemetry contract: missing post-test capture",
    )
  })

  test("#given Windows root-test telemetry #when the collector runs #then timing and process state avoid secrets", () => {
    assertWindowsTelemetryContract(windowsTelemetryScript)
    expect(windowsTelemetryScript).toContain("$preTestUtc")
    expect(windowsTelemetryScript).toContain("$preTestStopwatchTimestamp")
    expect(windowsTelemetryScript).toContain("stopwatchFrequency")
    expect(windowsTelemetryScript).toContain("-OperationTimeoutSec 5")
    expect(windowsTelemetryScript).toContain("[string]$postTestStopwatchTimestamp")
    expect(windowsTelemetryScript).toContain("name =")
    expect(windowsTelemetryScript).toContain("pid =")
    expect(windowsTelemetryScript).toContain("parentPid =")
    expect(windowsTelemetryScript).toContain("creationTimeUtc =")
    expect(windowsTelemetryScript).toContain("temporaryPaths =")
    expect(windowsTelemetryScript).toContain("testExitCode = $testExitCode")
    expect(windowsTelemetryScript).toContain("survivingDescendants =")
    expect(windowsTelemetryScript).not.toContain("CommandLine")
    expect(windowsTelemetryScript).not.toContain("ExecutablePath")
    expect(windowsTelemetryScript).not.toContain("Get-ChildItem Env:")
  })

  test("#given Windows test failures #when telemetry completes #then the Bun exit code remains authoritative", () => {
    expect(windowsTelemetryScript).toContain("$testExitCode = $testProcess.ExitCode")
    expect(windowsTelemetryScript).toContain("exit $testExitCode")
    expect(windowsTelemetryScript).toContain("Write-Warning")
    expect(windowsTelemetryScript).not.toContain("exit 0")
  })
})
