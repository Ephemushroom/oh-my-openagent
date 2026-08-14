import type { SkillDraft } from "@opencode-ai/plugin/promise/skill"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Source } from "@opencode-ai/schema/skill"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"

export interface SharedSkillsRegistrationContext {
  readonly skill: {
    readonly transform: (callback: (draft: SkillDraft) => void) => Promise<unknown>
  }
}

export async function registerSharedSkills(
  ctx: SharedSkillsRegistrationContext,
  trace?: (event: string, detail?: Record<string, unknown>) => void,
): Promise<void> {
  const path = sharedSkillsRootPath()

  await ctx.skill.transform((draft) => {
    draft.source(Source.make({ type: "directory", path: AbsolutePath.make(path) }))
  })

  trace?.("omo.skills.registered", { path })
}
