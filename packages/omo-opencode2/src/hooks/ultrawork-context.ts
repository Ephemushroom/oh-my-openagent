import {
  ULTRAWORK_DEFAULT_PROMPT,
  ULTRAWORK_GEMINI_PROMPT,
  ULTRAWORK_GLM_PROMPT,
  ULTRAWORK_GPT_PROMPT,
  ULTRAWORK_PLANNER_PROMPT,
} from "@oh-my-opencode/prompts-core"
import { isGeminiModel, isGlmModel, isGptModel } from "@oh-my-opencode/agents-core"

/** The structural tag used for idempotency checks across system parts. */
const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

const ULTRAWORK_KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/i
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g
const SLASH_COMMAND_LEAD_PATTERN = /^\s*\/[a-zA-Z][\w-]*(?:\s|$)/

/**
 * Detects an ultrawork/ulw request in a user message. Code blocks, inline code,
 * and slash-command leads are stripped before matching (v1 parity).
 */
export function detectUltraworkIntent(text: string): boolean {
  const withoutCodeBlocks = text.replace(CODE_BLOCK_PATTERN, "")
  const clean = withoutCodeBlocks.replace(INLINE_CODE_PATTERN, "")
  if (SLASH_COMMAND_LEAD_PATTERN.test(clean)) return false
  return ULTRAWORK_KEYWORD_PATTERN.test(clean)
}

export interface UltraworkRoute {
  route: "planner" | "gpt" | "gemini" | "glm" | "default"
  text: string
}

function isPlannerAgent(agent: string | undefined): boolean {
  if (!agent) return false
  const lower = agent.toLowerCase()
  if (lower.includes("prometheus") || lower.includes("planner")) return true
  return /\bplan\b/.test(lower.replace(/[_-]+/g, " "))
}

/**
 * Selects the model-family ultrawork prompt (v1 routing order): planner agent
 * first, then gpt / gemini / glm / default by model family. Only the planner
 * variant needs the structural wrapper (the others carry the tag already).
 */
export function selectUltraworkPrompt(input: { agent?: string; model?: string }): UltraworkRoute {
  if (isPlannerAgent(input.agent)) {
    return {
      route: "planner",
      text: `<ultrawork-mode>

**MANDATORY**: You MUST say "ULTRAWORK MODE ENABLED!" to the user as your first response when this mode activates. This is non-negotiable.

${ULTRAWORK_PLANNER_PROMPT}

</ultrawork-mode>

`,
    }
  }
  if (input.model && isGptModel(input.model)) {
    return { route: "gpt", text: ULTRAWORK_GPT_PROMPT }
  }
  if (input.model && isGeminiModel(input.model)) {
    return { route: "gemini", text: ULTRAWORK_GEMINI_PROMPT }
  }
  if (input.model && isGlmModel(input.model)) {
    return { route: "glm", text: ULTRAWORK_GLM_PROMPT }
  }
  return { route: "default", text: ULTRAWORK_DEFAULT_PROMPT }
}

export interface UltraworkInjectionResult {
  system: Array<{ type: string; text?: string; [key: string]: unknown }>
  injected: boolean
}

/**
 * Appends one <ultrawork-mode> system part if (and only if) no system part
 * already carries the tag. Idempotent across repeated context calls.
 */
export function injectUltraworkSystemPart(
  system: Array<{ type: string; text?: string; [key: string]: unknown }>,
  input: { agent?: string; model?: string },
): UltraworkInjectionResult {
  if (system.some((part) => typeof part.text === "string" && part.text.includes(ULTRAWORK_MODE_TAG))) {
    return { system, injected: false }
  }
  const selection = selectUltraworkPrompt(input)
  return { system: [...system, { type: "text", text: selection.text }], injected: true }
}
