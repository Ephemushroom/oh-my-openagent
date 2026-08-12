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
  injected: boolean
}

interface UserMessageLike {
  role?: string
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>
}

/**
 * Appends the <ultrawork-mode> directive inline to the LAST real user turn's
 * final text part (v1 parity: the directive sits at the end of the user's own
 * message, so the model treats "first response" literally and says the banner
 * before its thinking block). Mutates the message in place — the v2 context
 * hook runtime reads the mutated draft back after hooks.
 *
 * Idempotent across same-turn follow-up dispatches (tool results etc.): if the
 * last user message already carries the tag, nothing is appended.
 */
export function injectUltraworkIntoUserTurn(
  messages: UserMessageLike[],
  input: { agent?: string; model?: string },
): UltraworkInjectionResult {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "user") continue
    const content = message.content ?? []
    for (let partIndex = content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = content[partIndex]
      if (part.type !== "text" || typeof part.text !== "string") continue
      if (part.text.includes(ULTRAWORK_MODE_TAG)) return { injected: false }
      const selection = selectUltraworkPrompt(input)
      part.text = `${part.text}\n\n---\n\n${selection.text}`
      return { injected: true }
    }
    // The last user turn has no text part — do not reach into older turns.
    return { injected: false }
  }
  return { injected: false }
}
