/**
 * Multi-word substring filter for model id lists.
 *
 * Splits the query on whitespace into tokens; an id matches iff EVERY token
 * is a case-insensitive substring of the id. Empty/whitespace query returns
 * all ids unchanged. The returned list preserves input order (the caller's
 * list is already sorted alphabetically by fetchModelsFromBaseUrl).
 *
 * Extracted as a pure function so the filter is unit-testable in isolation
 * (no React/Ink) — same rationale as planProviderSwitch.
 */
export function filterModels(models: readonly string[], query: string): string[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return [...models]
  return models.filter(id => {
    const lower = id.toLowerCase()
    return tokens.every(tok => lower.includes(tok))
  })
}
