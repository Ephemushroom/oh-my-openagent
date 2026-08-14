import * as z from "zod"

export const OpenCode2AgentOverrideSchema = z.object({
  model: z.string().optional(),
  variant: z.string().optional(),
  prompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
}).strip() // permissive: drops unknown fields from shared OmoAgentDef

export const OpenCode2GoalSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  auto_start: z.boolean().optional(),
  default_max_iterations: z.number().int().min(1).optional(),
}).strip()

export const OpenCode2ConfigSchema = z.object({
  default_agent: z.string().optional(),
  agents: z.record(z.string(), OpenCode2AgentOverrideSchema).optional(),
  goal: OpenCode2GoalSettingsSchema.optional(),
  disabled_hooks: z.array(z.string()).optional(),
}).strip() // permissive: ignores all core root keys (categories, task, etc.)

export type OpenCode2AgentOverride = z.infer<typeof OpenCode2AgentOverrideSchema>
export type OpenCode2GoalSettings = z.infer<typeof OpenCode2GoalSettingsSchema>
export type OpenCode2Config = z.infer<typeof OpenCode2ConfigSchema>
