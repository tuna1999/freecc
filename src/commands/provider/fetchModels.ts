/**
 * Shared helper for fetching a model list from an OpenAI- or Anthropic-style
 * /v1/models endpoint with path-fallback and response-shape fallback.
 *
 * Tries each path in order; for each path, tolerates three common response
 * shapes (OpenAI `{ data: [...] }`, Ollama `{ models: [...] }`, direct array).
 * Stops at the first path that returns a non-empty model list.
 *
 * Why: the four setup components (OpenAI, OpenAI-compat, OpenRouter,
 * Anthropic-compat) each had near-identical 30-50 line fetch loops that
 * drifted in subtle ways. Centralising here also makes the algorithm
 * unit-testable in isolation (P6).
 */

export type AuthStyle = 'bearer' | 'x-api-key'

export type FetchModelsOptions = {
  baseUrl: string
  apiKey?: string
  /** Ordered list of paths to try, e.g. ['/v1/models', '/models'] */
  paths: string[]
  /**
   * How to authenticate. 'bearer' sends `Authorization: Bearer <key>`.
   * 'x-api-key' sends both `x-api-key: <key>` and `Authorization: Bearer <key>`
   * for providers that look at either (most Anthropic-compat gateways do).
   */
  authStyle: AuthStyle
  onSuccess: (sortedModels: string[]) => void
  onError: (lastError: string) => void
}

function buildHeaders(apiKey: string | undefined, authStyle: AuthStyle): Record<string, string> {
  if (!apiKey) return {}
  if (authStyle === 'x-api-key') {
    return {
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    }
  }
  return { Authorization: `Bearer ${apiKey}` }
}

/**
 * Extract model ids from the three common response shapes, returning the
 * first non-empty list. Each entry is coerced to a string id (the model
 * object's `id` field, with `name` as fallback for Ollama-style responses).
 */
function extractModelIds(data: unknown): string[] {
  const d = data as Record<string, unknown> | undefined
  const coerce = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? (arr as Array<Record<string, unknown>>)
          .map(m => String(m?.id ?? m?.name ?? ''))
          .filter(id => id.length > 0)
      : []

  // 1. OpenAI / Anthropic style: { data: [{id, ...}] }
  const fromData = coerce(d?.data)
  if (fromData.length > 0) return fromData

  // 2. Ollama style: { models: [{name, ...}] }
  const fromModels = coerce(d?.models)
  if (fromModels.length > 0) return fromModels

  // 3. Direct array: [{id, ...}]
  if (Array.isArray(data)) {
    return coerce(data)
  }

  return []
}

export async function fetchModelsFromBaseUrl(opts: FetchModelsOptions): Promise<void> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const headers = buildHeaders(opts.apiKey, opts.authStyle)
  let lastError = ''

  for (const path of opts.paths) {
    const url = `${base}${path}`
    try {
      const res = await globalThis.fetch(url, { headers })
      if (!res.ok) {
        lastError = `${path} → HTTP ${res.status}`
        continue
      }
      const data: unknown = await res.json()
      const ids = extractModelIds(data)
      if (ids.length > 0) {
        opts.onSuccess([...ids].sort((a, b) => a.localeCompare(b)))
        return
      }
      lastError = `${path} → no models in response`
    } catch (err) {
      lastError = `${path} → ${(err as Error).message}`
    }
  }

  opts.onError(lastError)
}
