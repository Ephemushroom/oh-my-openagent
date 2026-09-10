/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const workflowsDir = new URL("../.github/workflows/", import.meta.url)
const pinnedBunVersion = 'bun-version: "1.4.2"'
const workflowPaths = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => new URL(name, workflowsDir))

const workflowChecks = [
  {
    path: ciWorkflowPath,
    testRuns: [
      "run: bun test",
    ],
  },
]

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

function sliceWorkflowSectionToEnd(workflow: string, startMarker: string): string {
  const start = workflow.indexOf(startMarker)
  if (start < 0) {
    throw new Error(`missing workflow section starting at ${startMarker}`)
  }
  return workflow.slice(start)
}

function sliceWorkflowStep(workflow: string, stepName: string): string {
  const startMarker = `      - name: ${stepName}`
  const start = workflow.indexOf(startMarker)
  if (start < 0) {
    throw new Error(`missing workflow step ${stepName}`)
  }
  const nextStep = workflow.indexOf("\n      - name: ", start + startMarker.length)
  return workflow.slice(start, nextStep < 0 ? workflow.length : nextStep + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPackageScript(scriptName: string): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  if (!isRecord(parsed)) throw new Error("package.json must be an object")
  const scripts = parsed["scripts"]
  if (!isRecord(scripts)) throw new Error("package.json scripts must be an object")
  const script = scripts[scriptName]
  if (typeof script !== "string") throw new Error(`package.json scripts.${scriptName} must be a string`)
  return script
}

describe("test workflows", () => {
  test("use pure bun test for workflows", () => {
    for (const workflowCheck of workflowChecks) {
      // #given
      const workflow = readFileSync(workflowCheck.path, "utf8")

      for (const testRun of workflowCheck.testRuns) {
        expect(workflow).toContain(testRun)
      }
    }
  })

  test("builds publish-main from the prepared release SHA", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")

    // #when
    const checksOutPreparedRelease = publishMainJob.includes("ref: ${{ needs.prepare-release-state.outputs.release_sha }}")
    const regeneratesInstallerBeforeMainBuild = publishMainJob.includes(
      "bun run build:codex-install && bun run build:lsp-tools-mcp && bun run build:lsp-daemon && bun run build",
    )

    // #then
    expect(checksOutPreparedRelease, "publish-main must build the release-state commit after version synchronization").toBe(true)
    expect(regeneratesInstallerBeforeMainBuild, "publish-main must regenerate the embedded Codex installer from that release commit").toBe(true)
  })

  test("dispatches a source-pinned publish run before provenance-bearing release operations", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")
    const dispatchJob = sliceWorkflowSection(workflow, "  dispatch-provenance-safe-publish:", "  publish-main:")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")
    const publishPlatformJob = sliceWorkflowSection(workflow, "  publish-platform:", "  release:")
    const releaseJob = sliceWorkflowSectionToEnd(workflow, "  release:")

    // #when
    const exposesPreparedSourceInput = workflow.includes("prepared_release_sha:")
    const validatesDispatchSource = prepareJob.includes("PREPARED_RELEASE_SHA: ${{ inputs.prepared_release_sha }}") &&
      prepareJob.includes('"$PREPARED_RELEASE_SHA" != "$GITHUB_SHA"')
    const dispatchesPinnedTagRun =
      dispatchJob.includes('git tag "v${VERSION}" "$RELEASE_SHA"') &&
      dispatchJob.includes('gh workflow run publish.yml --ref "v${VERSION}"') &&
      dispatchJob.includes('prepared_release_sha=${RELEASE_SHA}')
    const provenanceOperationsRequirePinnedRun =
      publishMainJob.includes("inputs.prepared_release_sha != ''") &&
      publishPlatformJob.includes("inputs.prepared_release_sha != ''") &&
      releaseJob.includes("inputs.prepared_release_sha != ''")
    const releaseChecksOutPreparedSource = releaseJob.includes("ref: ${{ needs.prepare-release-state.outputs.release_sha }}")
    const releaseDoesNotRestampOrRetag =
      !releaseJob.includes("name: Apply release version to source tree") &&
      !releaseJob.includes("name: Create release tag")

    // #then
    expect(exposesPreparedSourceInput, "the follow-up publish run must receive the exact prepared source SHA").toBe(true)
    expect(validatesDispatchSource, "the provenance-bearing run must reject a dispatch SHA different from the prepared source").toBe(true)
    expect(dispatchesPinnedTagRun, "the preparation run must tag and dispatch the exact prepared source").toBe(true)
    expect(provenanceOperationsRequirePinnedRun, "npm, platform, marketplace, and GitHub release operations must only run from the pinned follow-up dispatch").toBe(true)
    expect(releaseChecksOutPreparedSource, "GitHub release and marketplace operations must check out the prepared source directly").toBe(true)
    expect(releaseDoesNotRestampOrRetag, "the provenance-bearing release run must not mutate its release source").toBe(true)
  })

  test("passes the omo-ai version to the platform publish workflow", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishPlatformJob = sliceWorkflowSection(workflow, "  publish-platform:", "  release:")

    // #when
    const passesOmoAiVersion = publishPlatformJob.includes(
      "omo_ai_version: ${{ needs.release-metadata.outputs.omo_ai_version }}",
    )
    const keepsVersionSourcedFromMetadata = publishPlatformJob.includes(
      "version: ${{ needs.release-metadata.outputs.version }}",
    )

    // #then
    expect(passesOmoAiVersion, "the publish-platform call must forward the mapped omo-ai version so binaries stamp it").toBe(true)
    expect(keepsVersionSourcedFromMetadata, "the publish-platform call must keep sourcing the release version from release-metadata").toBe(true)
  })

  test("attaches and verifies release-binary assets on every GitHub release", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const releaseJob = sliceWorkflowSection(workflow, "  release:", "  post-publish-verify:")
    const downloadStep = sliceWorkflowStep(releaseJob, "Download release-binary artifacts")
    const uploadStep = sliceWorkflowStep(releaseJob, "Upload release assets")
    const verifyStep = sliceWorkflowStep(releaseJob, "Verify uploaded assets")

    // #when
    const createIndex = releaseJob.indexOf("      - name: Create GitHub release")
    const downloadIndex = releaseJob.indexOf("      - name: Download release-binary artifacts")
    const uploadIndex = releaseJob.indexOf("      - name: Upload release assets")
    const verifyIndex = releaseJob.indexOf("      - name: Verify uploaded assets")
    const stepsFollowReleaseCreation =
      createIndex >= 0 && downloadIndex > createIndex && uploadIndex > downloadIndex && verifyIndex > uploadIndex
    const downloadStagesReleaseBinaries =
      downloadStep.includes("actions/download-artifact@") &&
      downloadStep.includes("pattern: release-binary-*") &&
      downloadStep.includes("path: .omo/release-binaries")
    const generatesCombinedChecksums = uploadStep.includes("shasum -a 256 omo-* > SHA256SUMS")
    const uploadClobbersAssets = uploadStep.includes(
      'gh release upload "v${VERSION}" .omo/release-binaries/omo-* .omo/release-binaries/SHA256SUMS --clobber',
    )
    const uploadSourcesVersionFromMetadata = uploadStep.includes(
      "VERSION: ${{ needs.release-metadata.outputs.version }}",
    )
    const verifyRedownloadsEveryAsset =
      verifyStep.includes('gh release download "v${VERSION}"') && verifyStep.includes("mktemp -d")
    const verifyChecksEveryHash = verifyStep.includes("shasum -a 256 -c SHA256SUMS")
    const verifyFailsBelowThirteenAssets = verifyStep.includes('"$ASSET_COUNT" -ne 13')
    const stepsAreChannelNeutral = ![downloadStep, uploadStep, verifyStep].some((step) => step.includes("dist_tag"))
    const verifyRunsUnconditionally = !verifyStep.includes("if:") && !verifyStep.includes("skip_platform")

    // #then
    expect(stepsFollowReleaseCreation, "release-binary steps must live inside the release job after Create GitHub release").toBe(true)
    expect(downloadStagesReleaseBinaries, "the release job must stage every per-target binary under .omo/release-binaries").toBe(true)
    expect(generatesCombinedChecksums, "the release job must generate the combined SHA256SUMS from the downloaded binaries (per-leg checksums would collide)").toBe(true)
    expect(uploadClobbersAssets, "asset upload must clobber so reruns stay idempotent").toBe(true)
    expect(uploadSourcesVersionFromMetadata, "asset upload must source the release version from release-metadata").toBe(true)
    expect(verifyRedownloadsEveryAsset, "verification must re-download every uploaded asset from the GitHub release").toBe(true)
    expect(verifyChecksEveryHash, "verification must re-check every SHA256SUMS entry").toBe(true)
    expect(verifyFailsBelowThirteenAssets, "verification must fail the job unless exactly 13 assets (12 binaries + SHA256SUMS) verified").toBe(true)
    expect(stepsAreChannelNeutral, "release-binary steps must run for both stable and dist-tagged releases").toBe(true)
    expect(verifyRunsUnconditionally, "Verify uploaded assets must stay ungated so platform-skip reruns still prove the release contract").toBe(true)
  })

  test("builds bundled MCP runtimes before Codex compatibility tests", () => {
    // #given
    const codexTestScript = readPackageScript("test:codex")

    // #when
    const requiredPrerequisites = [
      ["generated Codex installer", "bun run build:codex-install"],
      ["Git Bash MCP runtime", "bun run build:git-bash-mcp"],
      ["lsp-tools MCP runtime", "bun run build:lsp-tools-mcp"],
      ["lsp daemon runtime", "bun run build:lsp-daemon"],
      ["vendored lsp-tools package tests", "npm --prefix packages/lsp-tools-mcp test"],
      ["nested Codex plugin npm install", "npm --prefix packages/omo-codex/plugin ci"],
      ["nested Codex plugin build", "bun run --cwd packages/omo-codex/plugin build"],
      ["third-party notices ship check", "node scripts/check-third-party-notices.mjs --ship"],
      ["Codex compatibility Bun tests", "bun test"],
    ] as const

    // #then
    let previousIndex = -1
    for (const [description, command] of requiredPrerequisites) {
      const index = codexTestScript.indexOf(command)
      expect(index, `test:codex must run ${description}`).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  test("runs Git Bash installer regressions in Codex compatibility checks", () => {
    // #given
    const packageManifest = readFileSync(new URL("../package.json", import.meta.url), "utf8")

    // #when
    const codexTestScriptRunsGitBashRegressions =
      packageManifest.includes("packages/omo-codex/scripts/install-local-git-bash-preflight.test.mjs") &&
      packageManifest.includes("packages/omo-codex/scripts/install-generated-bundle.test.mjs")

    // #then
    expect(codexTestScriptRunsGitBashRegressions, "test:codex must cover Windows Git Bash preflight and install guidance").toBe(true)
  })

  test("tracks the nested Codex plugin lockfile used by npm ci", () => {
    // #given
    const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8")

    // #when
    const lockfileIsUnignored = gitignore.includes("!packages/omo-codex/plugin/package-lock.json")
    const trackedLockfile = execFileSync("git", ["ls-files", "packages/omo-codex/plugin/package-lock.json"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    }).trim()

    // #then
    expect(lockfileIsUnignored, "the aggregate Codex plugin lockfile must escape the root package-lock ignore").toBe(true)
    expect(trackedLockfile, "npm ci in CI requires the nested Codex plugin package-lock.json to be tracked").toBe("packages/omo-codex/plugin/package-lock.json")
  })

  test("pins every workflow Bun setup to the tested runtime", () => {
    for (const workflowPath of workflowPaths) {
      // #given
      const workflow = readFileSync(workflowPath, "utf8")
      const bunVersionLines = workflow.match(/bun-version: .*/g) ?? []

      // #when
      const unpinnedBunLines = bunVersionLines.filter((line) => line !== pinnedBunVersion)

      // #then
      expect(unpinnedBunLines, `${workflowPath.pathname} must pin Bun to 1.4.2`).toEqual([])
    }
  })

})
