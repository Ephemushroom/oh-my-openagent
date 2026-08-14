import { readFile, writeFile, unlink } from "node:fs/promises"
import type { Context } from "@opencode-ai/plugin/promise/plugin"
import {
  applyHashlineEditsWithReport,
  canonicalizeFileText,
  restoreFileText,
  normalizeHashlineEdits,
  type RawHashlineEdit,
  HashlineMismatchError,
} from "@oh-my-opencode/hashline-core"
import type { JsonSchemaLike } from "../orchestration/task-tool"

const HASHLINE_EDIT_DESCRIPTION = `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read target file/range and copy exact LINE#ID tags.
2. Pick the smallest operation per logical mutation site.
3. Submit one edit call per file with all related operations.
4. If same file needs another call, re-read first.
5. Use anchors as "LINE#ID" only (never include trailing "|content").

<must>
- SNAPSHOT: All edits in one call reference the ORIGINAL file state. Do NOT adjust line numbers for prior edits in the same call - the system applies them bottom-up automatically.
- replace removes lines pos..end (inclusive) and inserts lines in their place. Lines BEFORE pos and AFTER end are UNTOUCHED - do NOT include them in lines. If you do, they will appear twice.
- lines must contain ONLY the content that belongs inside the consumed range. Content after end survives unchanged.
- Tags MUST be copied exactly from read output or >>> mismatch output. NEVER guess tags.
- Batch = multiple operations in edits[], NOT one big replace covering everything. Each operation targets the smallest possible change.
- lines must contain plain replacement text only (no LINE#ID prefixes, no diff + markers).
</must>

<operations>
LINE#ID FORMAT:
  Each line reference must be in "{line_number}#{hash_id}" format where:
  {line_number}: 1-based line number
  {hash_id}: Two CID letters from the set ZPMQVRWSNKTXJBYH

OPERATION CHOICE:
  replace with pos only -> replace one line at pos
  replace with pos+end -> replace range pos..end inclusive as a block (ranges MUST NOT overlap across edits)
  append with pos/end anchor -> insert after that anchor
  prepend with pos/end anchor -> insert before that anchor
  append/prepend without anchors -> EOF/BOF insertion (also creates missing files)

CONTENT FORMAT:
  lines can be a string (single line) or string[] (multi-line, preferred).
  If you pass a multi-line string, it is split by real newline characters.
  lines: null or lines: [] with replace -> delete those lines.

FILE MODES:
  delete=true deletes file and requires edits=[] with no rename
  rename moves final content to a new path and removes old path

RULES:
  1. Minimize scope: one logical mutation site per operation.
  2. Preserve formatting: keep indentation, punctuation, line breaks, trailing commas, brace style.
  3. Prefer insertion over neighbor rewrites: anchor to structural boundaries (}, ], },), not interior property lines.
  4. No no-ops: replacement content must differ from current content.
  5. Touch only requested code: avoid incidental edits.
  6. Use exact current tokens: NEVER rewrite approximately.
  7. For swaps/moves: prefer one range operation over multiple single-line operations.
  8. Anchor to structural lines (function/class/brace), NEVER blank lines.
  9. Re-read after each successful edit call before issuing another on the same file.
</operations>`

export const HASHLINE_EDIT_INPUT: JsonSchemaLike = {
  type: "object",
  properties: {
    filePath: {
      type: "string",
      description: "Absolute path to the file to edit",
    },
    delete: {
      type: "boolean",
      description: "Delete file instead of editing",
    },
    rename: {
      type: "string",
      description: "Rename output file path after edits",
    },
    edits: {
      type: "array",
      description: "Array of edit operations to apply (empty when delete=true)",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["replace", "append", "prepend"],
            description: "Hashline edit operation mode",
          },
          pos: {
            type: "string",
            description: "Primary anchor in LINE#ID format",
          },
          end: {
            type: "string",
            description: "Range end anchor in LINE#ID format",
          },
          lines: {
            anyOf: [
              { type: "array", items: { type: "string" } },
              { type: "string" },
              { type: "null" }
            ],
            description: "Replacement or inserted lines as newline-delimited string. null deletes with replace",
          },
        },
        required: ["op"],
      },
    },
  },
  required: ["filePath", "edits"],
  additionalProperties: false,
}

function canCreateFromMissingFile(edits: any[]): boolean {
  if (edits.length === 0) return false
  return edits.every((edit) => (edit.op === "append" || edit.op === "prepend") && !edit.pos)
}

export async function registerHashlineEditTool(ctx: Context, trace?: (event: string, detail?: Record<string, unknown>) => void) {
  await ctx.tool.transform((draft) => {
    draft.add({
      name: "hashline_edit",
      description: HASHLINE_EDIT_DESCRIPTION,
      input: HASHLINE_EDIT_INPUT,
      options: { codemode: false },
      execute: async (rawInput, toolCtx) => {
        const input = rawInput as {
          filePath: string
          edits: RawHashlineEdit[]
          delete?: boolean
          rename?: string
        }

        try {
          const filePath = input.filePath
          const deleteMode = input.delete
          const rename = input.rename

          if (deleteMode && rename) {
            return { content: "Error: delete and rename cannot be used together" }
          }
          if (deleteMode && input.edits.length > 0) {
            return { content: "Error: delete mode requires edits to be an empty array" }
          }

          if (!deleteMode && (!input.edits || !Array.isArray(input.edits) || input.edits.length === 0)) {
            return { content: "Error: edits parameter must be a non-empty array" }
          }

          const edits = deleteMode ? [] : normalizeHashlineEdits(input.edits)

          let exists = true
          let rawOldContent = ""
          try {
            rawOldContent = await readFile(filePath, "utf8")
          } catch (err: any) {
            if (err.code === "ENOENT") {
              exists = false
            } else {
              return { content: `Error reading file: ${err.message}` }
            }
          }

          if (!exists && !deleteMode && !canCreateFromMissingFile(edits)) {
            return { content: `Error: File not found: ${filePath}` }
          }

          if (deleteMode) {
            if (!exists) return { content: `Error: File not found: ${filePath}` }
            await unlink(filePath)
            trace?.("hashline.edit.deleted", { filePath, sessionID: toolCtx.sessionID })
            return { content: `Successfully deleted ${filePath}` }
          }

          const oldEnvelope = canonicalizeFileText(rawOldContent)

          const applyResult = applyHashlineEditsWithReport(oldEnvelope.content, edits)
          const canonicalNewContent = applyResult.content

          if (canonicalNewContent === oldEnvelope.content && !rename) {
            let diagnostic = `No changes made to ${filePath}. The edits produced identical content.`
            if (applyResult.noopEdits > 0) {
              diagnostic += ` No-op edits: ${applyResult.noopEdits}. Re-read the file and provide content that differs from current lines.`
            }
            trace?.("hashline.edit.noop", { filePath, sessionID: toolCtx.sessionID })
            return { content: `Error: ${diagnostic}` }
          }

          const writeContent = restoreFileText(canonicalNewContent, oldEnvelope)

          await writeFile(filePath, writeContent, "utf8")

          if (rename && rename !== filePath) {
            await writeFile(rename, writeContent, "utf8")
            if (exists) {
              await unlink(filePath)
            }
          }

          const effectivePath = rename && rename !== filePath ? rename : filePath
          
          trace?.("hashline.edit.success", { 
            filePath: effectivePath, 
            sessionID: toolCtx.sessionID,
            additions: applyResult.deduplicatedEdits 
          })

          if (rename && rename !== filePath) {
            return { content: `Moved ${filePath} to ${rename}` }
          }

          return { content: `Updated ${effectivePath}` }
        } catch (error: any) {
          trace?.("hashline.edit.error", { error: String(error) })
          if (error instanceof HashlineMismatchError) {
            return { content: `Error: hash mismatch - ${error.message}\nTip: reuse LINE#ID entries from the latest read/edit output, or batch related edits in one call.` }
          }
          return { content: `Error: ${error.message}` }
        }
      },
    })
  })
}
