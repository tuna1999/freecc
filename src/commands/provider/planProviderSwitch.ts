/**
 * Pure planner for the applyProviderSwitch flow.
 *
 * Takes the inputs (current config, current env, provider, optional
 * model/config fields) and returns a "plan" object describing the
 * desired end state. The caller then applies the plan — writing
 * config, mutating process.env, calling bootstrap settings hooks.
 *
 * Why: separating the plan from the application means we can unit-test
 * the entire decision tree (which env vars get cleared, which model
 * override is set, which config fields are merged) without mocking
 * saveGlobalConfig, setMainLoopModelOverride, etc. The shape of the
 * plan is also easier to log or display for debugging.
 */

import type { APIProvider } from '../../utils/model/providers.js'

export type ProviderEnvVarEntry = {
  value: APIProvider
  envVar: string
}

export type ApplyProviderSwitchPlan = {
  /** The full next config object (current + per-provider fields + apiProvider). */
  config: Record<string, unknown>
  /**
   * The desired state of every provider env var. Keys are env var names,
   * values are the new value or undefined to delete. The caller should
   * apply this to process.env in one pass.
   */
  envVars: Record<string, string | undefined>
  /** The new bootstrap model override (passed to setMainLoopModelOverride). */
  modelOverride: string | undefined
  /** The new in-memory AppState.mainLoopModel. */
  nextMainLoopModel: string | null
}

export type PlanProviderSwitchInput = {
  provider: APIProvider
  configFields?: Record<string, unknown>
  modelId?: string
  currentConfig: Record<string, unknown>
  currentEnv: Readonly<Record<string, string | undefined>>
  options: ReadonlyArray<ProviderEnvVarEntry>
}

export function planProviderSwitch(input: PlanProviderSwitchInput): ApplyProviderSwitchPlan {
  // 1. Build next config (current + per-provider fields + apiProvider)
  const config = {
    ...input.currentConfig,
    ...(input.configFields ?? {}),
    apiProvider: input.provider,
  }

  // 2. Decide env var state in a single pass:
  //    - every provider env var is deleted (set to undefined)
  //    - the active provider's env var is set to '1'
  const envVars: Record<string, string | undefined> = {}
  for (const opt of input.options) {
    if (opt.envVar) envVars[opt.envVar] = undefined
  }
  const active = input.options.find(o => o.value === input.provider)
  if (active?.envVar) {
    envVars[active.envVar] = '1'
  }

  // 3. Compute model sync. An empty-string modelId is treated as
  // 'cleared' (matches the old applyProviderSwitch behaviour where
  // `modelId || undefined` was used). This means callers cannot
  // accidentally pass a blank value and get it round-tripped as a
  // real model name.
  const modelOverride = input.modelId?.trim() ? input.modelId : undefined
  const nextMainLoopModel = input.modelId?.trim() ? input.modelId : null

  return {
    config,
    envVars,
    modelOverride,
    nextMainLoopModel,
  }
}

/**
 * Apply a plan to process.env, mutating in place. Pure env-side effect;
 * not part of the planner because process.env is a process singleton
 * that we don't want to thread through the pure function signature.
 */
export function applyEnvVarPlan(
  env: NodeJS.ProcessEnv,
  plan: ApplyProviderSwitchPlan['envVars'],
): void {
  for (const [key, value] of Object.entries(plan)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
}
