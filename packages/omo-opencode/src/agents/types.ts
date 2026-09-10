import type { AgentConfig } from "@opencode-ai/sdk";

export {
  isClaudeFable5Model,
  isClaudeFableOrMythosModel,
  isClaudeOpus46Model,
  isClaudeOpus47Model,
  isClaudeOpus47OrLaterModel,
  isClaudeOpus48Model,
  isClaudeOpus5Model,
  isGeminiModel,
  isGlmModel,
  isGptModel,
  isGrok45Model,
  isGrok46Model,
  isKimiK2Model,
  isKimiK27Model,
  isKimiK3Model,
  isMiniMaxModel,
  buildClaudeThinkingConfig,
  isGptNativeSisyphusModel,
  isGpt5_5Model,
  isGpt5_6Model,
  isGpt6Model,
} from "@oh-my-opencode/agents-core";

export type {
  AgentMode,
  AgentCategory,
  AgentCost,
  DelegationTrigger,
  AgentPromptMetadata,
  BuiltinAgentName,
  OverridableAgentName,
  AgentName,
} from "@oh-my-opencode/agents-core";

import type { OverridableAgentName } from "@oh-my-opencode/agents-core";
import type { AgentMode } from "@oh-my-opencode/agents-core";

/**
 * Agent factory function with static mode property.
 * Mode is exposed as static property for pre-instantiation access.
 */
export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
};

export type AgentOverrideConfig = Partial<AgentConfig> & {
  category?: string;
  prompt_append?: string;
  skills?: string[];
  tools?: Record<string, boolean>;
  variant?: string;
  fallback_models?: string | (string | import("../config/schema/fallback-models").FallbackModelObject)[];
};

export type AgentOverrides = Partial<
  Record<OverridableAgentName, AgentOverrideConfig>
>;
