import type { Context } from "@opencode-ai/plugin/promise/plugin"
import { 
  HOOK_NAME, 
  BLOCKED_TOOLS, 
  PLANNING_CONSULT_WARNING, 
  PLANNING_CONTEXT_OPEN, 
  PROMETHEUS_WORKFLOW_REMINDER,
  PROMETHEUS_AGENT
} from "./constants"
import { isAllowedFile } from "./path-policy"

const TASK_TOOLS = ["task", "call_omo_agent"]

function isPrometheusAgent(agentName: string | undefined): boolean {
  return agentName?.toLowerCase().includes(PROMETHEUS_AGENT) ?? false
}

type Trace = (event: string, detail?: Record<string, unknown>) => void

interface ContentPartLike {
  type: string
  text?: string
  [key: string]: unknown
}

interface ToolResultLike {
  content?: string | ReadonlyArray<ContentPartLike>
  [key: string]: unknown
}

function appendToResult(result: ToolResultLike, textToAppend: string): ToolResultLike {
  const content = result.content
  if (typeof content === "string") {
    return { ...result, content: content + textToAppend }
  }
  if (Array.isArray(content)) {
    const next = [...content, { type: "text", text: textToAppend }]
    return { ...result, content: next }
  }
  // If undefined or unknown shape, just return it.
  return result
}

export async function registerPrometheusMdOnly(ctx: Context, trace?: Trace): Promise<void> {
  await ctx.tool.hook("execute.before", async (event) => {
    if (!isPrometheusAgent(event.agent)) {
      return
    }

    const toolName = event.tool

    if (TASK_TOOLS.includes(toolName)) {
      const inputArgs = event.input as Record<string, unknown>
      const prompt = inputArgs.prompt as string | undefined
      if (prompt && !prompt.includes(PLANNING_CONTEXT_OPEN)) {
        inputArgs.prompt = PLANNING_CONSULT_WARNING + prompt
        trace?.(`omo.${HOOK_NAME}.injected-warning`, {
          sessionID: event.sessionID,
          tool: toolName,
          agent: event.agent,
        })
      }
      return
    }

    if (!BLOCKED_TOOLS.includes(toolName)) {
      return
    }

    const inputArgs = event.input as Record<string, unknown>
    const filePath = (inputArgs.filePath ?? inputArgs.path ?? inputArgs.file) as string | undefined
    if (!filePath) {
      return
    }

    if (!isAllowedFile(filePath, process.cwd())) {
      trace?.(`omo.${HOOK_NAME}.blocked`, {
        sessionID: event.sessionID,
        tool: toolName,
        filePath,
        agent: event.agent,
      })
      throw new Error(
        `[${HOOK_NAME}] Prometheus is a planning agent. File operations restricted to .omo/*.md plan files only. ` +
        `Do NOT route this change through a subagent either - delegated implementation is still implementation. ` +
        `Record the intended change as a todo in the plan; implementation starts only when the user runs /ulw-execute. ` +
        `Attempted to modify: ${filePath}.`
      )
    }

    trace?.(`omo.${HOOK_NAME}.allowed`, {
      sessionID: event.sessionID,
      tool: toolName,
      filePath,
      agent: event.agent,
    })
  })

  await ctx.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return
    if (!isPrometheusAgent(event.agent)) return

    const toolName = event.tool
    if (!BLOCKED_TOOLS.includes(toolName)) return

    const inputArgs = event.input as Record<string, unknown>
    const filePath = (inputArgs.filePath ?? inputArgs.path ?? inputArgs.file) as string | undefined
    if (!filePath) return

    const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/")
    if (normalizedPath.includes(".omo/plans/") || normalizedPath.includes(".omo/plans")) {
      trace?.(`omo.${HOOK_NAME}.injected-reminder`, {
        sessionID: event.sessionID,
        tool: toolName,
        filePath,
        agent: event.agent,
      })
      
      event.result = appendToResult(event.result as ToolResultLike, PROMETHEUS_WORKFLOW_REMINDER) as typeof event.result
    }
  })
}
