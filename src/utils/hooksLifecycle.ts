/**
 * Hook lifecycle helpers extracted from `utils/hooks.ts`.
 *
 * Owns:
 * - executeCwdChangedHooks: fire CwdChanged hooks when `cwd` shifts.
 * - executeFileChangedHooks: fire FileChanged hooks when a file
 *   is added/changed/unlinked.
 *
 * Both delegate the actual hook execution to `executeEnvHooks` in
 * utils/hooks.ts (which is the shared environment-hook runner used by
 * other env-events like Notification, SessionStart, etc.).
 */
import {
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  createBaseHookInput,
  executeEnvHooks,
} from './hooks.js'
import type {
  CwdChangedHookInput,
  FileChangedHookInput,
  HookOutsideReplResult,
} from '../types/hooks.js'

export async function executeCwdChangedHooks(
  oldCwd: string,
  newCwd: string,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const hookInput: CwdChangedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'CwdChanged',
    old_cwd: oldCwd,
    new_cwd: newCwd,
  }
  return executeEnvHooks(hookInput, timeoutMs)
}

export async function executeFileChangedHooks(
  filePath: string,
  event: 'change' | 'add' | 'unlink',
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const hookInput: FileChangedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'FileChanged',
    file_path: filePath,
    event,
  }
  return executeEnvHooks(hookInput, timeoutMs)
}
