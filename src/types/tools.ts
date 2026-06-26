/**
 * Tool type definitions (helpers, framework-level types).
 *
 * Originally declared in a missing file — reconstructed from usage sites
 * in `src/Tool.ts` and tool registration code. Shapes are intentionally
 * broad to keep typecheck working.
 */

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<{ type: string; [key: string]: any }>
  is_error?: boolean
}

export type PermissionDenial = {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export type ToolProgressData = {
  toolUseID: string
  elapsedMs?: number
  message?: string
  [key: string]: any
}

/** Annotation metadata attached to tool definitions. */
export type ToolAnnotations = {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  openWorldHint?: boolean
  [key: string]: any
}