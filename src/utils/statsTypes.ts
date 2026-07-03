/**
 * Shared types for stats and statsCache.
 *
 * Lives in its own module so that `stats.ts` and `statsCache.ts` can both
 * depend on these type definitions without forming an import cycle.
 * Previously `statsCache.ts` imported these from `stats.ts`, and `stats.ts`
 * imported cache helpers from `statsCache.ts`, which the cycle detector
 * flagged as a bidirectional coupling.
 */

export type DailyActivity = {
  date: string // YYYY-MM-DD format
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export type DailyModelTokens = {
  date: string // YYYY-MM-DD format
  tokensByModel: { [modelName: string]: number } // total tokens (input + output) per model
}

export type SessionStats = {
  sessionId: string
  duration: number // in milliseconds
  messageCount: number
  timestamp: string
}