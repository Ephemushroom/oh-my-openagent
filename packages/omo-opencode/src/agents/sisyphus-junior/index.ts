// Re-export shim: pure prompt builders + router moved to @oh-my-opencode/agents-core
// during the OpenCode2 port (Phase 1). The harness-coupled agent factory stays here.
export {
  buildDefaultSisyphusJuniorPrompt,
  buildKimiK26SisyphusJuniorPrompt,
  buildKimiK27SisyphusJuniorPrompt,
  buildKimiK3SisyphusJuniorPrompt,
  buildGptSisyphusJuniorPrompt,
  buildGpt54SisyphusJuniorPrompt,
  buildGpt55SisyphusJuniorPrompt,
  buildGeminiSisyphusJuniorPrompt,
  buildGlm52SisyphusJuniorPrompt,
  SISYPHUS_JUNIOR_DEFAULTS,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt,
} from "@oh-my-opencode/agents-core"
export type { SisyphusJuniorPromptSource } from "@oh-my-opencode/agents-core"
export { createSisyphusJuniorAgentWithOverrides } from "./agent"
