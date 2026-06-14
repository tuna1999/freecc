/**
 * Tests for planProviderSwitch — the pure decision-tree helper that
 * computeProviderSwitch + applyProviderSwitch are built on.
 *
 * Every assertion here is on the returned plan object. The plan describes
 * the desired end state; the side effects (writing to disk, mutating
 * process.env, calling bootstrap hooks) are exercised by integration
 * tests, not here.
 */

import { describe, it, expect } from 'bun:test'
import { planProviderSwitch, applyEnvVarPlan } from './planProviderSwitch.js'

const OPTIONS = [
  { value: 'firstParty' as const, envVar: '' },
  { value: 'bedrock' as const, envVar: 'CLAUDE_CODE_USE_BEDROCK' },
  { value: 'vertex' as const, envVar: 'CLAUDE_CODE_USE_VERTEX' },
  { value: 'foundry' as const, envVar: 'CLAUDE_CODE_USE_FOUNDRY' },
  { value: 'openai' as const, envVar: 'CLAUDE_CODE_USE_OPENAI' },
  { value: 'openrouter' as const, envVar: 'CLAUDE_CODE_USE_OPENROUTER' },
  { value: 'anthropicCompat' as const, envVar: 'CLAUDE_CODE_USE_ANTHROPIC_COMPAT' },
]

describe('planProviderSwitch', () => {
  it('merges current config with configFields and apiProvider', () => {
    const plan = planProviderSwitch({
      provider: 'openai',
      configFields: { openaiApiKey: 'sk-test', openaiBaseUrl: 'http://localhost:11434' },
      currentConfig: { existing: 'value' },
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.config.existing).toBe('value')
    expect(plan.config.openaiApiKey).toBe('sk-test')
    expect(plan.config.openaiBaseUrl).toBe('http://localhost:11434')
    expect(plan.config.apiProvider).toBe('openai')
  })

  it('apiProvider is always set in the output config even when configFields is empty', () => {
    const plan = planProviderSwitch({
      provider: 'bedrock',
      currentConfig: {},
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.config.apiProvider).toBe('bedrock')
  })

  it('configFields undefined is treated as empty', () => {
    const plan = planProviderSwitch({
      provider: 'openai',
      currentConfig: { existing: 'value' },
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.config).toEqual({ existing: 'value', apiProvider: 'openai' })
  })

  it('the env var plan deletes every non-active provider env var', () => {
    const plan = planProviderSwitch({
      provider: 'openai',
      currentConfig: {},
      currentEnv: {
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_VERTEX: '1',
        CLAUDE_CODE_USE_OPENROUTER: '1',
      },
      options: OPTIONS,
    })

    // Every non-active provider env var should appear in the plan with
    // value undefined (meaning "delete me"), regardless of whether it
    // was previously set.
    expect(plan.envVars.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(plan.envVars.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
    expect(plan.envVars.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined()
    expect(plan.envVars.CLAUDE_CODE_USE_OPENROUTER).toBeUndefined()
    expect(plan.envVars.CLAUDE_CODE_USE_ANTHROPIC_COMPAT).toBeUndefined()
  })

  it('the env var plan sets the active provider env var to "1"', () => {
    const plan = planProviderSwitch({
      provider: 'vertex',
      currentConfig: {},
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.envVars.CLAUDE_CODE_USE_VERTEX).toBe('1')
  })

  it('a provider without an envVar (e.g. firstParty) does not set any', () => {
    const plan = planProviderSwitch({
      provider: 'firstParty',
      currentConfig: {},
      currentEnv: {},
      options: OPTIONS,
    })

    // firstParty has envVar: '' so no env var is set, but the delete plan
    // for the other providers still runs.
    expect(plan.envVars.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(plan.envVars.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
    // No env var for firstParty should be set to '1'
    const setVars = Object.entries(plan.envVars).filter(([, v]) => v !== undefined)
    expect(setVars).toEqual([])
  })

  it('modelId undefined produces modelOverride undefined and nextMainLoopModel null', () => {
    const plan = planProviderSwitch({
      provider: 'bedrock',
      currentConfig: {},
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.modelOverride).toBeUndefined()
    expect(plan.nextMainLoopModel).toBeNull()
  })

  it('modelId provided propagates to modelOverride and nextMainLoopModel', () => {
    const plan = planProviderSwitch({
      provider: 'openai',
      modelId: 'gpt-4o',
      currentConfig: {},
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.modelOverride).toBe('gpt-4o')
    expect(plan.nextMainLoopModel).toBe('gpt-4o')
  })

  it('empty-string modelId is treated as undefined (cleared)', () => {
    const plan = planProviderSwitch({
      provider: 'openai',
      modelId: '',
      currentConfig: {},
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.modelOverride).toBeUndefined()
    expect(plan.nextMainLoopModel).toBeNull()
  })

  it('configFields override currentConfig on conflict', () => {
    const plan = planProviderSwitch({
      provider: 'openai',
      configFields: { openaiApiKey: 'new-key' },
      currentConfig: { openaiApiKey: 'old-key' },
      currentEnv: {},
      options: OPTIONS,
    })

    expect(plan.config.openaiApiKey).toBe('new-key')
  })

  it('does not mutate currentConfig or currentEnv inputs', () => {
    const currentConfig = { existing: 'value' }
    const currentEnv = { CLAUDE_CODE_USE_BEDROCK: '1' }
    const snapshot = { ...currentConfig }
    const envSnapshot = { ...currentEnv }

    planProviderSwitch({
      provider: 'openai',
      configFields: { openaiApiKey: 'sk-test' },
      currentConfig,
      currentEnv,
      options: OPTIONS,
    })

    expect(currentConfig).toEqual(snapshot)
    expect(currentEnv).toEqual(envSnapshot)
  })
})

describe('applyEnvVarPlan', () => {
  it('deletes keys whose value is undefined', () => {
    const env: NodeJS.ProcessEnv = { KEEP: 'me', DROP: 'me' }
    applyEnvVarPlan(env, { KEEP: 'still-me', DROP: undefined })
    expect(env.KEEP).toBe('still-me')
    expect('DROP' in env).toBe(false)
  })

  it('sets new keys', () => {
    const env: NodeJS.ProcessEnv = {}
    applyEnvVarPlan(env, { NEW: 'value' })
    expect(env.NEW).toBe('value')
  })

  it('overwrites existing keys', () => {
    const env: NodeJS.ProcessEnv = { X: 'old' }
    applyEnvVarPlan(env, { X: 'new' })
    expect(env.X).toBe('new')
  })

  it('end-to-end: provider switch env sweep + set', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_OPENAI: '1',
      OTHER_VAR: 'preserve',
    }

    const plan = planProviderSwitch({
      provider: 'vertex',
      currentConfig: {},
      currentEnv: env,
      options: OPTIONS,
    })

    applyEnvVarPlan(env, plan.envVars)

    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_VERTEX).toBe('1')
    expect(env.OTHER_VAR).toBe('preserve')
  })
})
