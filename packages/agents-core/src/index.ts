// @oh-my-opencode/agents-core
// Harness-agnostic agent prompt builders, model-family prompt routing, and
// agent metadata shared across harness adapters. Populated incrementally by the
// Phase 1 extraction (pure move from packages/omo-opencode/src/agents).
export * from "./types"
export * from "./dynamic-agent-prompt-builder"
export { GPT_APPLY_PATCH_GUIDANCE, GPT_FILE_EDIT_GUIDANCE } from "./gpt-apply-patch-guard"
export * from "./gpt-prompt-identity"
export { resolvePromptAppend } from "./builtin-agents/resolve-file-uri"
export * from "./sisyphus"
export { buildFallbackSisyphusPrompt } from "./sisyphus-dynamic-prompt"
export { applyGeminiFallbackOverrides } from "./sisyphus-gemini-fallback-overrides"
export { KIMI_TOOL_LOOP_GUARD } from "./kimi-tool-loop-guard"
export * from "./sisyphus-junior"
