// Deterministic driver for hashline_edit C4 (accept) and C5 (reject).
//
// Model tool-calling is probabilistic, so C4/C5 drive the REGISTERED tool's
// execute path directly: registerHashlineEditTool is invoked with a capturing
// context, then the captured tool.execute is called against a real fixture
// file. Correctness is asserted on the FIXTURE FILE BYTES (sha256) before and
// after, not on model prose. C3 (live model receives LINE#ID content) is proven
// separately by the live opencode2 session in qa.sh.
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerHashlineEditTool } from "../../../packages/omo-opencode2/src/tools/hashline-edit/index.ts"
import { computeLineHash } from "../../../packages/hashline-core/src/index.ts"

interface CapturedTool {
  name: string
  execute: (input: unknown, ctx: unknown) => Promise<{ content: string }>
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

async function captureTool(): Promise<CapturedTool> {
  let captured: CapturedTool | undefined
  const fakeCtx = {
    tool: {
      transform: async (fn: (draft: { add: (info: CapturedTool) => void }) => void) => {
        fn({ add: (info) => { captured = info } })
      },
    },
  }
  await registerHashlineEditTool(fakeCtx as never)
  if (!captured) throw new Error("hashline_edit tool was not registered")
  return captured
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) { console.log(`PASS  ${name}  (${detail})`); pass += 1 }
  else { console.log(`FAIL  ${name}  (${detail})`); fail += 1 }
}

async function main(): Promise<void> {
  const tool = await captureTool()
  check("tool.name", tool.name === "hashline_edit", `registered name=${tool.name}`)

  const dir = mkdtempSync(join(tmpdir(), "oc2-hashline-qa-"))
  const file = join(dir, "target.ts")
  const original = "const x = 1\nconst y = 2\nconst z = 3\n"
  writeFileSync(file, original)
  const originalHash = sha256(original)

  // C4: valid hash -> file modified on disk.
  const validRef = `1#${computeLineHash(1, "const x = 1")}`
  const acceptResult = await tool.execute(
    { filePath: file, edits: [{ op: "replace", pos: validRef, lines: "const x = 42" }] },
    {},
  )
  const afterAccept = readFileSync(file, "utf8")
  check(
    "C4.edit.accepted",
    !acceptResult.content.startsWith("Error:") && afterAccept.includes("const x = 42"),
    `content updated on disk; tool said: ${acceptResult.content.slice(0, 60)}`,
  )
  check("C4.other.lines.intact", afterAccept.includes("const y = 2") && afterAccept.includes("const z = 3"), "neighbors untouched")

  // C5: stale hash -> rejected AND file byte-identical.
  writeFileSync(file, original)
  const beforeReject = sha256(readFileSync(file, "utf8"))
  const staleRef = "1#ZZ"
  const rejectResult = await tool.execute(
    { filePath: file, edits: [{ op: "replace", pos: staleRef, lines: "const x = 999" }] },
    {},
  )
  const afterRejectRaw = readFileSync(file, "utf8")
  const afterReject = sha256(afterRejectRaw)
  check("C5.edit.rejected", rejectResult.content.startsWith("Error:"), `tool said: ${rejectResult.content.slice(0, 80)}`)
  check("C5.reject.mentions.reread", /re-read/i.test(rejectResult.content), "rejection tells model to re-read")
  check("C5.file.byte.identical", afterReject === beforeReject && beforeReject === originalHash, `sha256 before=${beforeReject.slice(0, 12)} after=${afterReject.slice(0, 12)}`)

  rmSync(dir, { recursive: true, force: true })
  console.log(`\nsummary: PASS=${pass} FAIL=${fail}`)
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
