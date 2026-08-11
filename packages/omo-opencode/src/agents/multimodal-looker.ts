import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import {
  MULTIMODAL_LOOKER_AGENT_DESCRIPTION,
  MULTIMODAL_LOOKER_PROMPT,
} from "@oh-my-opencode/agents-core"
import { createAgentToolAllowlist } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export { MULTIMODAL_LOOKER_PROMPT_METADATA } from "@oh-my-opencode/agents-core"

export function createMultimodalLookerAgent(model: string): AgentConfig {
  const restrictions = createAgentToolAllowlist(["read"])

  return {
    description: MULTIMODAL_LOOKER_AGENT_DESCRIPTION,
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: MULTIMODAL_LOOKER_PROMPT,
  }
}
createMultimodalLookerAgent.mode = MODE
