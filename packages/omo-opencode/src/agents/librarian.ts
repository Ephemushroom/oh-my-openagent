import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import { LIBRARIAN_AGENT_DESCRIPTION, buildLibrarianPrompt } from "@oh-my-opencode/agents-core"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export { LIBRARIAN_PROMPT_METADATA } from "@oh-my-opencode/agents-core"

export function createLibrarianAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "apply_patch",
    "task",
    "call_omo_agent",
  ])

  return {
    description: LIBRARIAN_AGENT_DESCRIPTION,
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: buildLibrarianPrompt(),
  }
}
createLibrarianAgent.mode = MODE
