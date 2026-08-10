// Pure prompt routing moved to @oh-my-opencode/agents-core during the OpenCode2
// port (Phase 1). The harness-coupled agent factory + metadata stay in ./agent.
export {
  createHephaestusAgent,
  hephaestusPromptMetadata,
} from "./agent";

export {
  getHephaestusPrompt,
  getHephaestusPromptSource,
  isHephaestusSupportedModel,
  UnsupportedHephaestusModelError,
} from "@oh-my-opencode/agents-core";

export type { HephaestusContext, HephaestusPromptSource } from "@oh-my-opencode/agents-core";
