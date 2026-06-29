/**
 * Hook message builders extracted from `utils/hooks.ts`.
 *
 * Owns:
 * - getSessionEndHookTimeoutMs: env-overridable timeout for SessionEnd.
 * - getPreToolHookBlockingMessage / getStopHookMessage /
 *   getTeammateIdleHookMessage / getTaskCreatedHookMessage /
 *   getTaskCompletedHookMessage / getUserPromptSubmitHookBlockingMessage:
 *   format hook blocking errors for the model.
 */
import type { HookBlockingError } from '../types/hooks.js'

const SESSION_END_HOOK_TIMEOUT_MS_DEFAULT = 1500

export function getSessionEndHookTimeoutMs(): number {
  const raw = process.env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : SESSION_END_HOOK_TIMEOUT_MS_DEFAULT
}

/**
 * Format a blocking error from a PreToolUse hook.
 * @param hookName The name of the hook (e.g., 'PreToolUse:Write', 'PreToolUse:Edit', 'PreToolUse:Bash')
 * @param blockingError The blocking error from the hook
 * @returns Formatted blocking message
 */
export function getPreToolHookBlockingMessage(
  hookName: string,
  blockingError: HookBlockingError,
): string {
  return `${hookName} hook error: ${blockingError.blockingError}`
}

/**
 * Format a blocking error from a Stop hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getStopHookMessage(blockingError: HookBlockingError): string {
  return `Stop hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a TeammateIdle hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getTeammateIdleHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TeammateIdle hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a TaskCreated hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getTaskCreatedHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TaskCreated hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a TaskCompleted hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted message to give feedback to the model
 */
export function getTaskCompletedHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TaskCompleted hook feedback:\n${blockingError.blockingError}`
}

/**
 * Format a blocking error from a UserPromptSubmit hook.
 * @param blockingError The blocking error from the hook
 * @returns Formatted blocking message
 */
export function getUserPromptSubmitHookBlockingMessage(
  blockingError: HookBlockingError,
): string {
  return `UserPromptSubmit operation blocked by hook:\n${blockingError.blockingError}`
}
