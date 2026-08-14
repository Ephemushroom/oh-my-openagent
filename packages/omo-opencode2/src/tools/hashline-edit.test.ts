import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { registerHashlineEditTool } from "./hashline-edit"
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { computeLineHash } from "@oh-my-opencode/hashline-core"

describe("Hashline Edit Tool", () => {
  let tmpDir: string
  let targetFile: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hashline-edit-test-"))
    targetFile = join(tmpDir, "test.txt")
  })

  afterEach(async () => {
    try {
      await unlink(targetFile)
    } catch (e) {}
  })

  describe("#given a valid edit operation", () => {
    test("#when executed #then it updates the file successfully", async () => {
      const content = "const x = 1;\nconst y = 2;\n"
      await writeFile(targetFile, content, "utf8")
      const hash1 = computeLineHash(1, "const x = 1;")
      const hash2 = computeLineHash(2, "const y = 2;")
      
      let registeredDraft: any
      const ctx = {
        tool: {
          transform: mock((draftFn) => {
            const draft = {
              add: mock((def) => { registeredDraft = def })
            }
            draftFn(draft)
          })
        }
      }

      registerHashlineEditTool(ctx as any)
      
      const result = await registeredDraft.execute({
        filePath: targetFile,
        edits: [
          { op: "replace", pos: `2#${hash2}`, lines: ["const y = 3;"] }
        ]
      }, { sessionID: "ses-1" })

      expect(result.content).toContain(`Updated ${targetFile}`)
      
      const newContent = await readFile(targetFile, "utf8")
      expect(newContent).toBe("const x = 1;\nconst y = 3;\n")
    })
  })

  describe("#given a stale hash", () => {
    test("#when executed #then it rejects the edit and leaves file byte-identical", async () => {
      const content = "const x = 1;\nconst y = 2;\n"
      await writeFile(targetFile, content, "utf8")
      
      let registeredDraft: any
      const ctx = {
        tool: {
          transform: mock((draftFn) => {
            const draft = { add: mock((def) => { registeredDraft = def }) }
            draftFn(draft)
          })
        }
      }

      registerHashlineEditTool(ctx as any)
      
      const result = await registeredDraft.execute({
        filePath: targetFile,
        edits: [
          { op: "replace", pos: `2#ZZ`, lines: ["const y = 3;"] } // Stale/Wrong hash
        ]
      }, { sessionID: "ses-1" })

      expect(result.content).toContain("Error: hash mismatch")
      
      // File must be byte-identical
      const newContent = await readFile(targetFile, "utf8")
      expect(newContent).toBe(content)
    })
  })

  describe("#given a missing file and append operation", () => {
    test("#when executed #then it creates the file", async () => {
      let registeredDraft: any
      const ctx = {
        tool: {
          transform: mock((draftFn) => {
            const draft = { add: mock((def) => { registeredDraft = def }) }
            draftFn(draft)
          })
        }
      }

      registerHashlineEditTool(ctx as any)
      
      const result = await registeredDraft.execute({
        filePath: targetFile,
        edits: [
          { op: "append", lines: ["new file content"] }
        ]
      }, { sessionID: "ses-1" })

      expect(result.content).toContain(`Updated ${targetFile}`)
      
      const newContent = await readFile(targetFile, "utf8")
      expect(newContent).toBe("new file content")
    })
  })
})
