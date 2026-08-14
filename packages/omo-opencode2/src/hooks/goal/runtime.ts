import type { GoalController } from "./controller"
import { buildContinuationPrompt } from "./prompt"
import type { GoalTrace } from "./types"

const DEFAULT_POST_DISPATCH_HOLD_MS = 2_000

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
  readonly trace?: GoalTrace
  readonly postDispatchHoldMs?: number
}

export type GoalRuntime = ReturnType<typeof createGoalRuntime>

type Reservation = {
  readonly token: symbol
  readonly expiresAt?: number
}

export function createGoalRuntime(dependencies: GoalRuntimeDependencies) {
  const {
    controller,
    dispatchContinuation,
    postDispatchHoldMs = DEFAULT_POST_DISPATCH_HOLD_MS,
    sessionExists,
    settle,
    trace,
  } = dependencies
  const activity = new Map<string, "busy" | "idle">()
  const reservations = new Map<string, Reservation>()
  let disposed = false

  function activeReservation(sessionID: string): Reservation | undefined {
    const reservation = reservations.get(sessionID)
    if (reservation?.expiresAt !== undefined && reservation.expiresAt <= Date.now()) {
      reservations.delete(sessionID)
      return undefined
    }
    return reservation
  }

  async function continueGoal(sessionID: string): Promise<void> {
    if (disposed || activeReservation(sessionID) !== undefined) return
    const goal = controller.getGoal(sessionID)
    if (goal === null || goal.status !== "active") return

    const reservation: Reservation = { token: Symbol(sessionID) }
    reservations.set(sessionID, reservation)
    let dispatchAttempted = false
    try {
      await settle()
      if (disposed || activity.get(sessionID) !== "idle") return
      if (!await sessionExists(sessionID)) return
      if (disposed || activity.get(sessionID) !== "idle") return
      const currentGoal = controller.getGoal(sessionID)
      if (currentGoal === null || currentGoal.status !== "active") return

      dispatchAttempted = true
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
    } finally {
      if (reservations.get(sessionID)?.token === reservation.token) {
        if (dispatchAttempted && postDispatchHoldMs > 0) {
          reservations.set(sessionID, {
            ...reservation,
            expiresAt: Date.now() + postDispatchHoldMs,
          })
        } else {
          reservations.delete(sessionID)
        }
      }
    }
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
          reservations.delete(sessionID)
          controller.clearGoal(sessionID)
          return
        default:
          return
      }
    },

    hasReservation(sessionID: string): boolean {
      return activeReservation(sessionID) !== undefined
    },

    dispose(): void {
      disposed = true
      activity.clear()
      reservations.clear()
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
