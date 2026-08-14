import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { registerPrometheusMdOnly } from "./index"
import { PLANNING_CONSULT_WARNING, PROMETHEUS_WORKFLOW_REMINDER } from "./constants"

describe("prometheus-md-only hook", () => {
  let mockCtx: any
  let beforeHook: (event: any) => Promise<void>
  let afterHook: (event: any) => Promise<void>
  const traceMsgs: any[] = []

  beforeEach(async () => {
    traceMsgs.length = 0
    mockCtx = {
      tool: {
        hook: (name: string, handler: any) => {
          if (name === "execute.before") beforeHook = handler
          if (name === "execute.after") afterHook = handler
        }
      }
    }

    await registerPrometheusMdOnly(mockCtx, (evt, det) => traceMsgs.push({ evt, det }))
  })

  test("#when agent is prometheus and writes non-md, #then blocks", async () => {
    await expect(beforeHook({
      agent: "prometheus",
      tool: "write",
      sessionID: "sess-1",
      input: { filePath: "src/index.ts" }
    })).rejects.toThrow("File operations restricted to .omo/*.md plan files only")
  })

  test("#when agent is prometheus and writes outside .omo, #then blocks", async () => {
    await expect(beforeHook({
      agent: "prometheus",
      tool: "write",
      sessionID: "sess-1",
      input: { filePath: "test.md" }
    })).rejects.toThrow("File operations restricted to .omo/*.md plan files only")
  })

  test("#when agent is prometheus and writes .omo plan, #then allows", async () => {
    await expect(beforeHook({
      agent: "prometheus",
      tool: "write",
      sessionID: "sess-1",
      input: { filePath: ".omo/plans/design.md" }
    })).resolves.toBeUndefined()
  })

  test("#when agent is NOT prometheus and writes non-md, #then allows", async () => {
    await expect(beforeHook({
      agent: "sisyphus",
      tool: "write",
      sessionID: "sess-1",
      input: { filePath: "src/index.ts" }
    })).resolves.toBeUndefined()
  })

  test("#when prometheus writes to .omo/plans, #then execute.after injects reminder", async () => {
    const event = {
      agent: "prometheus",
      tool: "write",
      status: "completed",
      sessionID: "sess-1",
      input: { filePath: ".omo/plans/test.md" },
      result: { content: "written" }
    }
    await afterHook(event)
    expect(event.result.content).toBe("written" + PROMETHEUS_WORKFLOW_REMINDER)
  })

  test("#when prometheus delegates with task tool, #then injects planning warning", async () => {
    const event = {
      agent: "prometheus",
      tool: "task",
      sessionID: "sess-1",
      input: { prompt: "do this" }
    }
    await beforeHook(event)
    expect(event.input.prompt).toBe(PLANNING_CONSULT_WARNING + "do this")
  })
})
