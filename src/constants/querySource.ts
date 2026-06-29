/**
 * Query-source enum — describes where a tool use / query originated.
 *
 * Originally declared in a missing file — reconstructed from usage sites
 * in `src/Tool.ts`. Values match the upstream enum; if more origins are
 * added later, extend this union.
 */

export type QuerySource =
  | 'agent'
  | 'user'
  | 'system'
  | 'compact'
  | 'tool'
  | 'remote'
  | 'sdk'
  | 'cron'
  | 'teammate'
  | 'unknown'

export const QUERY_SOURCE_VALUES: readonly QuerySource[] = [
  'agent',
  'user',
  'system',
  'compact',
  'tool',
  'remote',
  'sdk',
  'cron',
  'teammate',
  'unknown',
] as const