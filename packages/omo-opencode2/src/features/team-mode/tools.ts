import type { TeamModeConfig } from "@oh-my-opencode/team-core"

import { createTeamLifecycleTools } from "./lifecycle-tools"
import { TeamMailbox } from "./mailbox"
import { TeamMemberRuntime } from "./member-runtime"
import { createTeamMessageTool } from "./message-tool"
import { createTeamQueryTools } from "./query-tools"
import { TeamSessionRegistry } from "./session-registry"
import { createTeamTaskTools } from "./task-tools"
import type { TeamFeatureContext, TeamToolDefinition, TeamTrace } from "./types"

type TeamToolsOptions = {
  readonly ctx: Pick<TeamFeatureContext, "session">
  readonly cwd: string
  readonly config: TeamModeConfig
  readonly runtime: TeamMemberRuntime
  readonly sessions: TeamSessionRegistry
  readonly mailbox: TeamMailbox
  readonly resolveSessionID: (toolCtx: unknown) => string | undefined
  readonly trace?: TeamTrace
}

export function createTeamTools(options: TeamToolsOptions): TeamToolDefinition[] {
  return [
    ...createTeamLifecycleTools(options),
    createTeamMessageTool(options),
    ...createTeamTaskTools(options),
    ...createTeamQueryTools(options),
  ]
}
