import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import { buildClaudeThinkingConfig } from "./types"
import { METIS_AGENT_DESCRIPTION, getMetisPrompt } from "@oh-my-opencode/agents-core"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export { METIS_SYSTEM_PROMPT, METIS_K2_7_SYSTEM_PROMPT, metisPromptMetadata } from "@oh-my-opencode/agents-core"

const metisRestrictions = createAgentToolRestrictions([
  "write",
  "edit",
  "apply_patch",
])

export function createMetisAgent(model: string): AgentConfig {
  const prompt = getMetisPrompt(model)
  return {
    description: METIS_AGENT_DESCRIPTION,
    mode: MODE,
    model,
    temperature: 0.3,
    ...metisRestrictions,
    prompt,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig
}
createMetisAgent.mode = MODE
