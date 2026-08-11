import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import { EXPLORE_AGENT_DESCRIPTION, EXPLORE_PROMPT } from "@oh-my-opencode/agents-core"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export { EXPLORE_PROMPT_METADATA } from "@oh-my-opencode/agents-core"

export function createExploreAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    ["lsp_symbols", "lsp_goto_definition", "lsp_find_references", "lsp_diagnostics"],
  )

  return {
    description: EXPLORE_AGENT_DESCRIPTION,
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: EXPLORE_PROMPT,
  }
}
createExploreAgent.mode = MODE
