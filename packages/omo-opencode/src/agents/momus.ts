import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode } from "./types";
import { buildClaudeThinkingConfig, isGptModel } from "./types";
import {
  MOMUS_AGENT_DESCRIPTION,
  getMomusPromptSelection,
} from "@oh-my-opencode/agents-core";
import { createAgentToolRestrictions } from "../shared/permission-compat";

const MODE: AgentMode = "subagent";

export { MOMUS_SYSTEM_PROMPT, momusPromptMetadata } from "@oh-my-opencode/agents-core";

export function createMomusAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "apply_patch",
  ]);

  const selection = getMomusPromptSelection(model);

  const base = {
    description: MOMUS_AGENT_DESCRIPTION,
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: selection.prompt,
  } as AgentConfig;

  if (isGptModel(model)) {
    return {
      ...base,
      reasoningEffort: selection.reasoningEffort,
      textVerbosity: selection.textVerbosity,
    } as AgentConfig;
  }

  return {
    ...base,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig;
}
createMomusAgent.mode = MODE;
