import type { SessionDispatchGate } from "../../orchestration/session-dispatch-gate"
import type { GoalController } from "./controller"
import { buildContinuationPrompt } from "./prompt"
import type { GoalTrace } from "./types"

export type GoalEvent = {
  readonly type: string
  readonly id?: string
  readonly data?: unknown
}

export type GoalRuntimeDependencies = {
  readonly controller: GoalController
  readonly sessionExists: (sessionID: string) => Promise<boolean>
  readonly dispatchContinuation: (sessionID: string, prompt: string) => Promise<void>
  readonly settle: () => Promise<void>
  // Required, not defaulted: a per-feature default instance would give each
  // idle-injecting feature its own lock, which is the double injection the
  // gate exists to prevent. The owner of the plugin creates one and shares it.
  readonly gate: SessionDispatchGate
  readonly trace?: GoalTrace
}

export type GoalRuntime = ReturnType<typeof createGoalRuntime>

export function createGoalRuntime(dependencies: GoalRuntimeDependencies) {
  const { controller, dispatchContinuation, gate, sessionExists, settle, trace } = dependencies
  const activity = new Map<string, "busy" | "idle">()
  let disposed = false

  async function continueGoal(sessionID: string): Promise<void> {
    if (disposed) return
    const goal = controller.getGoal(sessionID)
    if (goal === null || goal.status !== "active") return

    // Errors are caught inside the body so the gate sees a normal return and
    // still releases; a rejection here would escape into the event pump.
    await gate.run(sessionID, async (markDispatched) => {
      try {
        await settle()
        if (disposed || activity.get(sessionID) !== "idle") return
        if (!await sessionExists(sessionID)) return
        if (disposed || activity.get(sessionID) !== "idle") return
        const currentGoal = controller.getGoal(sessionID)
        if (currentGoal === null || currentGoal.status !== "active") return

        markDispatched()
        await dispatchContinuation(sessionID, buildContinuationPrompt(currentGoal))
        trace?.("omo.goal.continuation-injected", {
          sessionID,
          goalID: currentGoal.id,
          objectiveUpdatedAt: currentGoal.updatedAt,
        })
      } catch (error) {
        trace?.("omo.goal.continuation-failed", {
          sessionID,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  return {
    async handleEvent(event: GoalEvent): Promise<void> {
      if (disposed) return
      const sessionID = sessionIDFromEvent(event)
      if (sessionID === undefined) return

      switch (event.type) {
        case "session.input.admitted":
        case "session.execution.started":
          activity.set(sessionID, "busy")
          return
        case "session.idle":
        case "session.execution.succeeded":
          activity.set(sessionID, "idle")
          await continueGoal(sessionID)
          return
        case "session.execution.failed":
        case "session.execution.interrupted":
          activity.set(sessionID, "idle")
          return
        case "session.deleted":
          activity.delete(sessionID)
          gate.release(sessionID)
          controller.clearGoal(sessionID)
          return
        default:
          return
      }
    },

    hasReservation(sessionID: string): boolean {
      return gate.isReserved(sessionID)
    },

    // The gate is shared, so disposing this feature must not clear it. Doing so
    // would free reservations another feature is holding.
    dispose(): void {
      disposed = true
      activity.clear()
    },
  }
}

function sessionIDFromEvent(event: GoalEvent): string | undefined {
  if (typeof event.data === "object" && event.data !== null && "sessionID" in event.data) {
    const sessionID = event.data.sessionID
    if (typeof sessionID === "string") return sessionID
  }
  return event.type === "session.deleted" && typeof event.id === "string" ? event.id : undefined
}
