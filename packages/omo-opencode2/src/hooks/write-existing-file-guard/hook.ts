import type { Context } from "@opencode/plugin/promise/plugin"
import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path"

import { handleWriteExistingFileGuardToolExecuteBefore } from "./tool-execute-before-handler"

export type GuardArgs = {
  filePath?: string
  path?: string
  file_path?: string
  overwrite?: boolean | string
}

const MAX_TRACKED_SESSIONS = 256
export const MAX_TRACKED_PATHS_PER_SESSION = 1024

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

export function getPathFromArgs(args: GuardArgs | undefined): string | undefined {
  return args?.filePath ?? args?.path ?? args?.file_path
}

export function resolveInputPath(directory: string, inputPath: string): string {
  return normalize(isAbsolute(inputPath) ? inputPath : resolve(directory, inputPath))
}

export function isPathInsideDirectory(pathToCheck: string, directory: string): boolean {
  const relativePath = relative(directory, pathToCheck)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

export function toCanonicalPath(absolutePath: string): string {
  let canonicalPath = absolutePath
  if (existsSync(absolutePath)) {
    try {
      canonicalPath = realpathSync.native(absolutePath)
    } catch {
      canonicalPath = absolutePath
    }
  } else {
    const absoluteDir = dirname(absolutePath)
    const resolvedDir = existsSync(absoluteDir) ? realpathSync.native(absoluteDir) : absoluteDir
    canonicalPath = join(resolvedDir, basename(absolutePath))
  }
  return normalize(canonicalPath)
}

export function isOverwriteEnabled(value: boolean | string | undefined): boolean {
  if (value === true) return true
  if (typeof value === "string") return value.toLowerCase() === "true"
  return false
}

type Trace = (event: string, detail?: Record<string, unknown>) => void

export async function registerWriteExistingFileGuard(ctx: Context, trace?: Trace, directory?: string): Promise<void> {
  const readPermissionsBySession = new Map<string, Set<string>>()
  const sessionLastAccess = new Map<string, number>()
  const maxTrackedSessions = MAX_TRACKED_SESSIONS
  const maxTrackedPathsPerSession = MAX_TRACKED_PATHS_PER_SESSION
  let canonicalSessionRoot: string | undefined
  const workDir = directory ?? process.cwd()

  function getCanonicalSessionRoot(): string {
    if (!canonicalSessionRoot) {
      canonicalSessionRoot = toCanonicalPath(resolveInputPath(workDir, workDir))
    }
    return canonicalSessionRoot
  }

  void (async () => {
    for await (const event of ctx.event.subscribe()) {
      if (event.type === "session.deleted") {
        readPermissionsBySession.delete(event.id)
        sessionLastAccess.delete(event.id)
      }
    }
  })()

  await ctx.tool.hook("execute.before", async (event) => {
    await handleWriteExistingFileGuardToolExecuteBefore({
      ctx,
      event,
      readPermissionsBySession,
      sessionLastAccess,
      getCanonicalSessionRoot,
      maxTrackedSessions,
      maxTrackedPathsPerSession,
      trace,
      directory: workDir,
    })
  })
}
