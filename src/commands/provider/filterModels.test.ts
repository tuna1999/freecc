/**
 * Tests for filterModels — the multi-word substring filter used by
 * ModelSearchPicker. An id matches iff every whitespace-separated token
 * in the query is a case-insensitive substring of the id.
 */
import { describe, it, expect } from 'bun:test'
import { filterModels } from './filterModels.js'

describe('filterModels', () => {
  const MODELS = [
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-8',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-coder-32b',
  ]

  it('returns all models for an empty query', () => {
    expect(filterModels(MODELS, '')).toEqual(MODELS)
    expect(filterModels(MODELS, '   ')).toEqual(MODELS)
  })

  it('filters by a single token, case-insensitive substring', () => {
    expect(filterModels(MODELS, 'sonnet')).toEqual(['anthropic/claude-sonnet-4-6'])
    expect(filterModels(MODELS, 'GPT')).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
    ])
  })

  it('ANDs multiple tokens (every token must match)', () => {
    // "sonnet 4" matches only the model containing both "sonnet" and "4"
    expect(filterModels(MODELS, 'sonnet 4')).toEqual(['anthropic/claude-sonnet-4-6'])
    // "openai mini" narrows to one
    expect(filterModels(MODELS, 'openai mini')).toEqual(['openai/gpt-4o-mini'])
  })

  it('returns an empty array when no id matches all tokens', () => {
    expect(filterModels(MODELS, 'sonnet gemini')).toEqual([])
    expect(filterModels(MODELS, 'zzz')).toEqual([])
  })

  it('preserves input order (no re-sorting)', () => {
    const order = ['c-model', 'a-model', 'b-model']
    expect(filterModels(order, 'model')).toEqual(order)
  })

  it('handles tokens with no id containing them among a mixed set', () => {
    expect(filterModels(MODELS, 'deepseek coder')).toEqual([])
    // 'coder' only exists in qwen, 'deepseek' only in deepseek — AND excludes both
    expect(filterModels(MODELS, 'qwen coder')).toEqual(['qwen/qwen-2.5-coder-32b'])
  })
})
