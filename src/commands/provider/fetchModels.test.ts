/**
 * Tests for fetchModelsFromBaseUrl — the shared /v1/models / /models
 * fetcher used by all four setup components.
 *
 * Mocks globalThis.fetch to return canned responses. Verifies:
 *  - the path-fallback chain (e.g. /v1/models then /models)
 *  - the response-shape fallback ({data}, {models}, direct array)
 *  - the auth header construction (bearer vs x-api-key)
 *  - onError receives the last error after all paths fail
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { fetchModelsFromBaseUrl } from './fetchModels.js'

type FetchCall = { url: string; init: RequestInit }

let calls: FetchCall[] = []
let responses: Array<{ status: number; body: unknown }> = []
let responseIdx = 0

function mockFetchOnce(): typeof globalThis.fetch {
  return mock(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, init: init ?? {} })
    const r = responses[responseIdx++] ?? { status: 500, body: {} }
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as unknown as typeof globalThis.fetch
}

describe('fetchModelsFromBaseUrl', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    calls = []
    responses = []
    responseIdx = 0
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('parses the OpenAI-style { data: [...] } response', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: { data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5' }] } })

    const onSuccess = mock(() => {})
    const onError = mock(() => {})

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      paths: ['/models'],
      authStyle: 'bearer',
      onSuccess,
      onError,
    })

    expect(onSuccess).toHaveBeenCalledTimes(1)
    const sorted = (onSuccess.mock.calls[0] as unknown as [string[]])[0]
    expect(sorted).toEqual(['gpt-3.5', 'gpt-4o']) // alphabetically sorted
    expect(onError).not.toHaveBeenCalled()
  })

  it('parses the Ollama-style { models: [...] } response with name field', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: { models: [{ name: 'llama3' }, { name: 'qwen2' }] } })

    const onSuccess = mock(() => {})
    const onError = mock(() => {})

    await fetchModelsFromBaseUrl({
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      paths: ['/v1/models', '/models'],
      authStyle: 'bearer',
      onSuccess,
      onError,
    })

    expect(onSuccess).toHaveBeenCalledTimes(1)
    const sorted = (onSuccess.mock.calls[0] as unknown as [string[]])[0]
    expect(sorted).toEqual(['llama3', 'qwen2'])
  })

  it('parses a direct array response', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: [{ id: 'custom-1' }] })

    const onSuccess = mock(() => {})

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com',
      paths: ['/models'],
      authStyle: 'bearer',
      onSuccess,
      onError: mock(() => {}),
    })

    const sorted = (onSuccess.mock.calls[0] as unknown as [string[]])[0]
    expect(sorted).toEqual(['custom-1'])
  })

  it('falls back to the second path when the first returns 404', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 404, body: {} })
    responses.push({ status: 200, body: { data: [{ id: 'from-second-path' }] } })

    const onSuccess = mock(() => {})
    const onError = mock(() => {})

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com',
      paths: ['/v1/models', '/models'],
      authStyle: 'bearer',
      onSuccess,
      onError,
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://api.example.com/v1/models')
    expect(calls[1].url).toBe('https://api.example.com/models')
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError with the last error after all paths fail', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 500, body: {} })
    responses.push({ status: 404, body: {} })

    const onError = mock(() => {})

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com',
      paths: ['/v1/models', '/models'],
      authStyle: 'bearer',
      onSuccess: mock(() => {}),
      onError,
    })

    expect(onError).toHaveBeenCalledTimes(1)
    const err = (onError.mock.calls[0] as unknown as [string])[0]
    expect(err).toContain('/models')
    expect(err).toContain('HTTP 404')
  })

  it('sends Authorization: Bearer header for authStyle=bearer', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: { data: [{ id: 'x' }] } })

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      paths: ['/models'],
      authStyle: 'bearer',
      onSuccess: mock(() => {}),
      onError: mock(() => {}),
    })

    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('sends x-api-key AND Authorization for authStyle=x-api-key', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: { data: [{ id: 'x' }] } })

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-ant-test',
      paths: ['/models'],
      authStyle: 'x-api-key',
      onSuccess: mock(() => {}),
      onError: mock(() => {}),
    })

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers.Authorization).toBe('Bearer sk-ant-test')
  })

  it('omits auth headers when apiKey is empty', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: { data: [{ id: 'x' }] } })

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com',
      apiKey: '',
      paths: ['/models'],
      authStyle: 'bearer',
      onSuccess: mock(() => {}),
      onError: mock(() => {}),
    })

    expect(calls[0].init.headers).toEqual({})
  })

  it('strips trailing slashes from baseUrl', async () => {
    globalThis.fetch = mockFetchOnce()
    responses.push({ status: 200, body: { data: [{ id: 'x' }] } })

    await fetchModelsFromBaseUrl({
      baseUrl: 'https://api.example.com/v1///',
      apiKey: 'sk-test',
      paths: ['/models'],
      authStyle: 'bearer',
      onSuccess: mock(() => {}),
      onError: mock(() => {}),
    })

    expect(calls[0].url).toBe('https://api.example.com/v1/models')
  })
})
