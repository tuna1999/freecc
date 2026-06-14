/**
 * State machine hook for the four provider setup components.
 *
 * Each setup component (OpenAI, OpenAI-compat, OpenRouter, Anthropic-compat)
 * shared the same step state machine:
 *   api-key → base-url (optional) → loading → model-select → model (manual fallback)
 *
 * plus the same set of inputs (apiKey, baseUrl, models[], error, manualModel)
 * and the same Escape handler that pops back to the previous step.
 *
 * The hook centralises state, escape handling, and a few common transitions
 * (start loading, surface error, finish with chosen model). Per-provider
 * behaviour (which fields to save, which base URL to default to) is supplied
 * via callbacks so the hook stays domain-agnostic.
 */

import * as React from 'react'

export type SetupStep = 'api-key' | 'base-url' | 'loading' | 'model-select' | 'model'

export type UseProviderSetupWizardOptions = {
  /**
   * Which step to start on. 'api-key' if api key is the first thing the
   * user is asked for (OpenAI direct, OpenRouter); 'base-url' if a custom
   * endpoint is required first (OpenAI-compat, Anthropic-compat).
   */
  initialStep: SetupStep
  /** Pre-fill values loaded from global config. */
  initialApiKey?: string
  initialBaseUrl?: string
  /**
   * Pre-fill for the manual-model fallback TextInput. Anthropic-compat uses
   * cfg.anthropicCompatModel here so a previously-saved model is shown on
   * the fallback step.
   */
  initialManualModel?: string
}

export type ProviderSetupWizard = {
  step: SetupStep
  setStep: React.Dispatch<React.SetStateAction<SetupStep>>

  apiKey: string
  setApiKey: (v: string) => void
  apiKeyCursor: number
  setApiKeyCursor: (n: number) => void

  baseUrl: string
  setBaseUrl: (v: string) => void
  baseUrlCursor: number
  setBaseUrlCursor: (n: number) => void

  models: Array<{ id: string }>
  setModels: React.Dispatch<React.SetStateAction<Array<{ id: string }>>>

  fetchError: string
  setFetchError: (v: string) => void

  manualModel: string
  setManualModel: (v: string) => void
  modelCursor: number
  setModelCursor: (n: number) => void

  /**
   * Escape handler that pops back to the previous step. Caller wires this
   * to useInput — for the 'menu' / 'loading' steps no input is allowed.
   */
  onEscape: () => void

  /** Set state to 'loading' before kicking off the fetch. */
  beginFetch: () => void

  /** Called when fetch returns models (transition to model-select). */
  applyFetchedModels: (sortedIds: string[]) => void

  /** Called when fetch exhausts all paths (transition to manual model entry). */
  applyFetchError: (lastError: string) => void
}

const STEP_BACK_ORDER: SetupStep[] = ['api-key', 'base-url', 'model-select', 'model']

export function useProviderSetupWizard(
  options: UseProviderSetupWizardOptions,
): ProviderSetupWizard {
  const {
    initialStep,
    initialApiKey = '',
    initialBaseUrl = '',
    initialManualModel = '',
  } = options

  const [step, setStep] = React.useState<SetupStep>(initialStep)
  const [apiKey, setApiKey] = React.useState(initialApiKey)
  const [baseUrl, setBaseUrl] = React.useState(initialBaseUrl)
  const [apiKeyCursor, setApiKeyCursor] = React.useState(initialApiKey.length)
  const [baseUrlCursor, setBaseUrlCursor] = React.useState(initialBaseUrl.length)
  const [models, setModels] = React.useState<Array<{ id: string }>>([])
  const [fetchError, setFetchError] = React.useState('')
  const [manualModel, setManualModel] = React.useState(initialManualModel)
  const [modelCursor, setModelCursor] = React.useState(initialManualModel.length)

  const onEscape = React.useCallback(() => {
    setStep((prev: SetupStep) => {
      // 'loading' is not a navigable step — caller usually disables input
      // in this state. If somehow escape fires, stay put.
      if (prev === 'loading') return prev
      const idx = STEP_BACK_ORDER.indexOf(prev)
      // 'base-url' (the first step for compat flows) has no previous step
      // — the caller handles this by treating it as onBack.
      if (idx <= 0) return prev
      return STEP_BACK_ORDER[idx - 1]
    })
  }, [])

  const beginFetch = React.useCallback(() => setStep('loading'), [])

  const applyFetchedModels = React.useCallback((sortedIds: string[]) => {
    setModels(sortedIds.map(id => ({ id })))
    setStep('model-select')
  }, [])

  const applyFetchError = React.useCallback((lastError: string) => {
    setFetchError(lastError)
    setStep('model')
  }, [])

  return {
    step, setStep,
    apiKey, setApiKey, apiKeyCursor, setApiKeyCursor,
    baseUrl, setBaseUrl, baseUrlCursor, setBaseUrlCursor,
    models, setModels,
    fetchError, setFetchError,
    manualModel, setManualModel, modelCursor, setModelCursor,
    onEscape, beginFetch, applyFetchedModels, applyFetchError,
  }
}
