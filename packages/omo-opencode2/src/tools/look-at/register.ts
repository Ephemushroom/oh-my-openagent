import type { Context } from "@opencode/plugin/promise/plugin"

import type { CatalogSource } from "../../agents/model-resolution"
import { parseLookAtArgs } from "./look-at-arguments"
import { LOOK_AT_DESCRIPTION } from "./tool-description"
import type { SessionModelRegistry } from "./session-model-registry"
import { resolveLookAtRoute } from "./vision-gate"

type Trace = (event: string, detail?: Record<string, unknown>) => void

/** Structural stand-in for effect's JsonSchema (kept dependency-free). */
interface JsonSchemaLike {
  [key: string]: unknown
  type?: string
  properties?: Record<string, JsonSchemaLike>
  items?: JsonSchemaLike
  required?: string[]
  description?: string
  additionalProperties?: boolean
}

export const LOOK_AT_TOOL_NAME = "look_at"

const LOOK_AT_INPUT: JsonSchemaLike = {
  type: "object",
  properties: {
    file_path: { type: "string", description: "Absolute path to the media file to examine." },
    file_paths: {
      type: "array",
      description: "Absolute paths to the media files to examine.",
      items: { type: "string" },
    },
    goal: { type: "string", description: "What specific information to extract from the file." },
  },
  required: ["goal"],
  additionalProperties: false,
}

export interface LookAtDelegateInput {
  parentSessionID: string
  visionModel: string
  prompt: string
  description: string
}

/** Runs the looking on a vision-capable model. Injected so the tool stays testable. */
export type LookAtDelegate = (input: LookAtDelegateInput) => Promise<{ ok: boolean; text: string }>

export interface RegisterLookAtOptions {
  ctx: Context
  catalog: CatalogSource
  sessionModels: SessionModelRegistry
  delegate: LookAtDelegate
  trace?: Trace
}

function buildDelegatePrompt(filePaths: string[], goal: string): string {
  const files = filePaths.map((path) => `- ${path}`).join("\n")
  return [
    "Examine the following file(s) and report ONLY what the goal asks for.",
    "",
    "Files:",
    files,
    "",
    `Goal: ${goal}`,
    "",
    "Use the `read` tool on each path. Answer in plain text with no preamble.",
  ].join("\n")
}

function buildPassthroughGuidance(filePaths: string[], model: string): string {
  const files = filePaths.map((path) => `- ${path}`).join("\n")
  return [
    `No delegation needed: the current model (${model}) accepts image input.`,
    "",
    "Call `read` directly on the path(s) below. It renders images and PDFs to you,",
    "so a delegated vision session would cost an extra round trip for the same result.",
    "",
    files,
  ].join("\n")
}

/**
 * Registers `look_at` as a capability gate rather than an unconditional
 * delegation. v1 always spawned a `multimodal-looker` child session; v2's
 * native `read` renders media directly, so delegating from a model that can
 * already see the file is pure waste. See `vision-gate.ts` for the routing.
 */
export async function registerLookAtTool(options: RegisterLookAtOptions): Promise<void> {
  const { ctx, catalog, sessionModels, delegate, trace } = options

  await ctx.tool.transform((draft) => {
    draft.add({
      name: LOOK_AT_TOOL_NAME,
      description: LOOK_AT_DESCRIPTION,
      input: LOOK_AT_INPUT,
      options: { codemode: false },
      execute: async (rawInput, context) => {
        const parsed = parseLookAtArgs(rawInput)
        if (!parsed.ok) return { content: `Error: ${parsed.error}` }
        const { filePaths, goal } = parsed.args

        const sessionID = context.sessionID as unknown as string
        const sessionModel = sessionModels.read(sessionID)
        const route = resolveLookAtRoute({ sessionModel, snapshot: catalog.current })

        if (route.kind === "passthrough") {
          trace?.("omo.lookat.passthrough", { model: route.model, files: filePaths.length })
          return { content: buildPassthroughGuidance(filePaths, route.model) }
        }

        if (route.kind === "unavailable") {
          trace?.("omo.lookat.unavailable", { model: route.model, reason: route.reason })
          const detail =
            route.reason === "catalog-cold"
              ? "the model catalog has not loaded yet"
              : "no model in the catalog accepts image input"
          return {
            content: `Error: cannot examine media because ${detail}. Connect a vision-capable provider, then retry.`,
          }
        }

        trace?.("omo.lookat.delegated", {
          model: route.model,
          visionModel: route.visionModel,
          files: filePaths.length,
        })
        const result = await delegate({
          parentSessionID: sessionID,
          visionModel: route.visionModel,
          prompt: buildDelegatePrompt(filePaths, goal),
          description: `look_at: ${goal}`.slice(0, 80),
        })
        if (!result.ok) {
          return { content: `Error: the vision model failed to examine the file. ${result.text}`.trim() }
        }
        return { content: result.text }
      },
    })
  })

  trace?.("omo.lookat.tool-registered", { tool: LOOK_AT_TOOL_NAME })
}
