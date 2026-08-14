import { computeLineHash } from "@oh-my-opencode/hashline-core"
import type { Context } from "@opencode-ai/plugin/promise/plugin"

const COLON_READ_LINE_PATTERN = /^\s*(\d+): ?(.*)$/
const PIPE_READ_LINE_PATTERN = /^\s*(\d+)\| ?(.*)$/
const CONTENT_OPEN_TAG = "<content>"
const CONTENT_CLOSE_TAG = "</content>"
const FILE_OPEN_TAG = "<file>"
const FILE_CLOSE_TAG = "</file>"
const OPENCODE_LINE_TRUNCATION_SUFFIX = "... (line truncated to 2000 chars)"

function isReadTool(toolName: string): boolean {
  return toolName.toLowerCase() === "read"
}

function isTextFile(output: string): boolean {
  const firstLine = output.split("\n")[0] ?? ""
  return COLON_READ_LINE_PATTERN.test(firstLine) || PIPE_READ_LINE_PATTERN.test(firstLine)
}

function parseReadLine(line: string): { lineNumber: number; content: string } | null {
  const colonMatch = COLON_READ_LINE_PATTERN.exec(line)
  if (colonMatch) {
    return {
      lineNumber: Number.parseInt(colonMatch[1], 10),
      content: colonMatch[2],
    }
  }

  const pipeMatch = PIPE_READ_LINE_PATTERN.exec(line)
  if (pipeMatch) {
    return {
      lineNumber: Number.parseInt(pipeMatch[1], 10),
      content: pipeMatch[2],
    }
  }

  return null
}

function transformLine(line: string): string {
  const parsed = parseReadLine(line)
  if (!parsed) {
    return line
  }
  if (parsed.content.endsWith(OPENCODE_LINE_TRUNCATION_SUFFIX)) {
    return line
  }
  
  const hash = computeLineHash(parsed.lineNumber, parsed.content)
  return `${parsed.lineNumber}#${hash}|${parsed.content}`
}

export function transformOutput(output: string): string {
  if (!output) {
    return output
  }

  const lines = output.split("\n")
  const contentStart = lines.findIndex(
    (line) => line === CONTENT_OPEN_TAG || line.startsWith(CONTENT_OPEN_TAG)
  )
  const contentEnd = lines.indexOf(CONTENT_CLOSE_TAG)
  const fileStart = lines.findIndex((line) => line === FILE_OPEN_TAG || line.startsWith(FILE_OPEN_TAG))
  const fileEnd = lines.indexOf(FILE_CLOSE_TAG)

  const blockStart = contentStart !== -1 ? contentStart : fileStart
  const blockEnd = contentStart !== -1 ? contentEnd : fileEnd
  const openTag = contentStart !== -1 ? CONTENT_OPEN_TAG : FILE_OPEN_TAG

  let targetLines = lines
  let prefixLines: string[] = []
  let suffixLines: string[] = []

  if (blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart) {
    const openLine = lines[blockStart] ?? ""
    const inlineFirst = openLine.startsWith(openTag) && openLine !== openTag
      ? openLine.slice(openTag.length)
      : null
    targetLines = inlineFirst !== null
      ? [inlineFirst, ...lines.slice(blockStart + 1, blockEnd)]
      : lines.slice(blockStart + 1, blockEnd)
    prefixLines = inlineFirst !== null
      ? [...lines.slice(0, blockStart), openTag]
      : lines.slice(0, blockStart + 1)
    suffixLines = lines.slice(blockEnd)
  }

  // To support v2 read tool output which has headers like "Read file test.txt, lines 1-2"
  const result: string[] = []
  for (const line of targetLines) {
    if (parseReadLine(line)) {
      result.push(transformLine(line))
    } else {
      result.push(line)
    }
  }

  return [...prefixLines, ...result, ...suffixLines].join("\n")
}

export async function registerHashlineReadEnhancer(ctx: Context, trace?: (event: string, detail?: Record<string, unknown>) => void) {
  await ctx.tool.hook("execute.after", (event: any) => {
    trace?.("hashline.hook.fired", { tool: event.tool, status: event.status, content: event.result.content })
    if (!isReadTool(event.tool) || event.status !== "completed") return
    
    try {
      const content = event.result.content
      if (typeof content === "string") {
        const transformed = transformOutput(content)
        if (transformed !== content) {
          event.result = { ...event.result, content: transformed }
          trace?.("hashline.read-enhancer.applied", { tool: event.tool, via: "string", sessionID: event.sessionID })
        }
        return
      }
      
      if (Array.isArray(content)) {
        let changed = false
        const next = content.map((part: any) => {
          if (part.type === "text" && typeof part.text === "string") {
            const transformed = transformOutput(part.text)
            if (transformed !== part.text) {
              changed = true
              return { ...part, text: transformed }
            }
          }
          return part
        })
        if (changed) {
          event.result = { ...event.result, content: next }
          trace?.("hashline.read-enhancer.applied", { tool: event.tool, via: "array", sessionID: event.sessionID })
        }
      }
    } catch (e) {
      trace?.("hashline.read-enhancer.error", { error: String(e) })
    }
  })
}
