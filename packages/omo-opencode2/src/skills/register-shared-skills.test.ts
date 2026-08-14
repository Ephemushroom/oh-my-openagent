import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import type { SkillDraft } from "@opencode-ai/plugin/promise/skill"

import { registerSharedSkills } from "./register-shared-skills"
import type { SharedSkillsRegistrationContext } from "./register-shared-skills"

type SkillSource = Parameters<SkillDraft["source"]>[0]

describe("registerSharedSkills", () => {
  test("#given the shared bundle #when registering #then one directory source exposes known skills", async () => {
    // given
    const sources: SkillSource[] = []
    const context: SharedSkillsRegistrationContext = {
      skill: {
        transform: async (callback) => {
          callback({
            source: (source) => sources.push(source),
            list: () => sources,
          })
          return { dispose: async () => undefined }
        },
      },
    }

    // when
    await registerSharedSkills(context)

    // then
    expect(sources).toHaveLength(1)
    const source = sources[0]
    expect(source?.type).toBe("directory")
    if (source?.type !== "directory") return
    expect(existsSync(join(source.path, "programming", "SKILL.md"))).toBe(true)
    expect(existsSync(join(source.path, "git-master", "SKILL.md"))).toBe(true)
  })
})
