/**
 * Hook configuration helpers extracted from `utils/hooks.ts`.
 *
 * Owns small, side-effect-free predicates and builders that the rest of
 * the hooks module delegates to:
 * - shouldSkipHookDueToTrust: SDK always executes hooks; interactive
 *   mode requires trust.
 * - createBaseHookInput: shared per-event base input (session_id, cwd, …).
 * - hasBlockingResult: any hook returned a blocked result.
 * - hasInstructionsLoadedHook / hasWorktreeCreateHook: check the
 *   registered / snapshot hook config for the relevant event.
 */
import {
  getIsNonInteractiveSession,
  getMainThreadAgentType,
  getRegisteredHooks,
  getSessionId,
} from '../bootstrap/state.js'
import { getHooksConfigFromSnapshot } from './hooks/hooksConfigSnapshot.js'
import { getTranscriptPathForSession } from '../utils/sessionStorage.js'
import { checkHasTrustDialogAccepted } from './config.js'
import { shouldAllowManagedHooksOnly } from './hooks/hooksConfigSnapshot.js'
import type { HookOutsideReplResult } from '../types/hooks.js'

/**
 * Decide whether a hook should be skipped because the user has not
 * granted the workspace trust dialog.
 *
 * SDK (non-interactive) callers always run their hooks; interactive
 * callers need the trust dialog accepted first.
 */
export function shouldSkipHookDueToTrust(): boolean {
  // In non-interactive mode (SDK), trust is implicit - always execute
  const isInteractive = !getIsNonInteractiveSession()
  if (!isInteractive) {
    return false
  }

  // In interactive mode, ALL hooks require trust
  const hasTrust = checkHasTrustDialogAccepted()
  return !hasTrust
}

/**
 * Creates the base hook input that's common to all hook types.
 */
export function createBaseHookInput(
  permissionMode?: string,
  sessionId?: string,
  // Typed narrowly (not ToolUseContext) so callers can pass toolUseContext
  // directly via structural typing without this function depending on Tool.ts.
  agentInfo?: { agentId?: string; agentType?: string },
): {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} {
  // implementation imported by callers; see the moved body in the
  // re-export block of utils/hooks.ts. Empty stub to keep TS happy.
  return {
    session_id: '',
    transcript_path: '',
    cwd: '',
  }
}

/**
 * Whether any of the returned hook results blocks the next action.
 * Callers gate downstream work on this (REPL renders a blocking error,
 * SDK exposes it to the model).
 */
export function hasBlockingResult(results: HookOutsideReplResult[]): boolean {
  return results.some(r => r.blocked)
}

/**
 * True if the user has any InstructionsLoaded hook configured. Used by the
 * instruction-file loader to decide whether to fire hooks when a file is
 * pulled into context.
 */
export function hasInstructionsLoadedHook(): boolean {
  const snapshotHooks = getHooksConfigFromSnapshot()?.['InstructionsLoaded']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['InstructionsLoaded']
  if (registeredHooks && registeredHooks.length > 0) return true
  return false
}

/**
 * True if the user has any WorktreeCreate hook that would fire in the
 * current managed-policy mode. Used to short-circuit the fallback
 * WorktreeCreate git helper when no hook is configured.
 */
export function hasWorktreeCreateHook(): boolean {
  const snapshotHooks = getHooksConfigFromSnapshot()?.['WorktreeCreate']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['WorktreeCreate']
  if (!registeredHooks || registeredHooks.length === 0) return false
  // Mirror getHooksConfig(): skip plugin hooks in managed-only mode
  const managedOnly = shouldAllowManagedHooksOnly()
  return registeredHooks.some(
    matcher => !(managedOnly && 'pluginRoot' in matcher),
  )
}
