import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode } from "./types";
import { buildClaudeThinkingConfig, isGptModel } from "./types";
import {
  ORACLE_AGENT_DESCRIPTION,
  getOraclePromptSelection,
} from "@oh-my-opencode/agents-core";
import { createAgentToolRestrictions } from "../shared/permission-compat";

const MODE: AgentMode = "subagent";

export { ORACLE_PROMPT_METADATA } from "@oh-my-opencode/agents-core";

export function createOracleAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "apply_patch",
    "task",
  ]);

  const selection = getOraclePromptSelection(model);

  const base = {
    description: ORACLE_AGENT_DESCRIPTION,
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
createOracleAgent.mode = MODE;
