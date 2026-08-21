import { existsSync } from "node:fs"
import {
  buildCodegraphEnv,
  resolveCodegraphCommand,
  resolveCodegraphNodeSupport,
  shouldExcludeCodegraphProject,
} from "@oh-my-opencode/utils"
import { resolvePinnedCodegraphBin } from "@oh-my-opencode/utils/codegraph"

import type { LocalMcpServerConfig } from "./types"
import type { OpenCode2CodegraphSettings } from "../config/schema"

export type CodegraphMcpConfigOptions = {
  readonly cwd?: string
  readonly config?: OpenCode2CodegraphSettings
  readonly homeDir?: string
  readonly fileExists?: (path: string) => boolean
}

type CodegraphEnvSource = {
  readonly CODEGRAPH_INSTALL_DIR?: string
} & Record<string, string | undefined>

function codegraphEnv(config: OpenCode2CodegraphSettings | undefined, homeDir: string | undefined): Record<string, string> {
  const env = buildCodegraphEnv({ homeDir, daemon: config?.daemon !== false })
  return config?.install_dir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.install_dir }
}

/**
 * Local stdio MCP config for codegraph. Disabled unless the binary resolves
 * (bundled / provisioned / PATH) and node support holds; v2 keeps v1's
 * default-on-but-gated-on-binary semantics under [opencode2].codegraph.
 */
export function createCodegraphMcpConfig(options: CodegraphMcpConfigOptions = {}): LocalMcpServerConfig | undefined {
  const fileExists = options.fileExists ?? existsSync
  const env = process.env as CodegraphEnvSource
  const which = (commandName: string): string | null => {
    // PATH lookup without a shell; resolveCodegraphCommand treats null as absent.
    const candidates = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
    for (const candidate of candidates) {
      for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
        if (dir.length === 0) continue
        const full = `${dir}${process.platform === "win32" ? "\\" : "/"}${commandName}${candidate}`
        if (fileExists(full)) return full
      }
    }
    return null
  }

  const resolved = resolveCodegraphCommand({
    env,
    fileExists,
    homeDir: options.homeDir,
    provisioned: () => resolvePinnedCodegraphBin(options.config?.install_dir, { fileExists }),
    which,
  })
  if (!resolved.exists) return undefined

  const nodeSupport = resolveCodegraphNodeSupport({ env, fileExists, which })
  const enabled = resolved.source === "bundled" || resolved.source === "env" || nodeSupport.supported
  if (!enabled) return undefined

  const excluded = options.cwd
    ? shouldExcludeCodegraphProject(options.cwd, {
        homeDir: options.homeDir,
        ...(options.config?.excluded_roots === undefined ? {} : { excludedRoots: options.config.excluded_roots }),
      }).excluded
    : false
  if (excluded) return undefined

  return {
    type: "local",
    command: [resolved.command, ...resolved.argsPrefix, "serve", "--mcp"],
    environment: codegraphEnv(options.config, options.homeDir),
  }
}
