/**
 * Proactive mode helpers (feature-flagged via `PROACTIVE` / `KAIROS`).
 *
 * Originally declared in a missing file — reconstructed as a stub so that
 * `src/cli/print.ts` can dynamically require it when the feature flags
 * are enabled. The real implementation lives elsewhere in the upstream
 * tree; this stub provides just enough surface for the conditional
 * `require()` in print.ts to typecheck.
 */

export function isProactiveActive(): boolean {
  return false
}

export function proactiveTick(): Promise<{ continueRun: boolean }> {
  return Promise.resolve({ continueRun: false })
}

export function getProactiveConfig(): unknown {
  return null
}

export function isProactivePaused(): boolean {
  return false
}

export function activateProactive(_opts?: unknown): Promise<void> {
  return Promise.resolve()
}

export function deactivateProactive(): Promise<void> {
  return Promise.resolve()
}

export const PROACTIVE_API_VERSION = '0.0.0-stub'