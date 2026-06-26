/**
 * SDK control-protocol types — CLI ↔ SDK bridge messages.
 *
 * Originally declared in a missing file — reconstructed from usage sites
 * in `src/cli/print.ts`, `src/bridge/replBridgeTransport.ts`, and
 * `src/cli/structuredIO.ts`. Shapes are intentionally broad so the
 * protocol can evolve without breaking typecheck.
 */

/** Message shape written to stdout by the CLI's headless mode. */
export type StdoutMessage = {
  type: string
  subtype?: string
  message?: unknown
  [key: string]: any
}

/** SDK → CLI control request. */
export type SDKControlRequest = {
  type: string
  subtype?: string
  request_id?: string
  [key: string]: any
}

/** CLI → SDK control response. */
export type SDKControlResponse = {
  type: string
  subtype?: string
  request_id?: string
  response?: { [key: string]: any }
  error?: string
  [key: string]: any
}

/** Initial handshake from SDK to CLI. */
export type SDKControlInitializeRequest = {
  type: 'control'
  subtype: 'initialize'
  [key: string]: any
}

export type SDKControlInitializeResponse = {
  type: 'control_response'
  subtype: 'initialize'
  request_id: string
  response: { [key: string]: any }
  commands?: string[]
  fast_mode_state?: string
  [key: string]: any
}

/** Response to mcp_set_servers — see `src/cli/printMcp.ts` for usage. */
export type SDKControlMcpSetServersResponse = {
  added: string[]
  removed: string[]
  errors: Record<string, string>
}

/** Response to reload_plugins — feature-flagged plugin reloader. */
export type SDKControlReloadPluginsResponse = {
  reloaded: string[]
  errors: Record<string, string>
  plugins?: string[]
  commands?: string[]
  [key: string]: any
}

/** Bridge envelope for CLI ↔ host control traffic. */
export type ControlRequestMessage = {
  type: 'control_request'
  message: SDKControlRequest
}

export type ControlResponseMessage = {
  type: 'control_response'
  message: SDKControlResponse
}

/** Re-exported by `entrypoints/agentSdkTypes.ts` for backward compat. */
export type ModelInfo = {
  id: string
  displayName?: string
  [key: string]: any
}

/** MCP config that can be spawned by the CLI (stdin/stdout, SSE, HTTP). */
export type McpServerConfigForProcessTransport = {
  type: string
  name?: string
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  [key: string]: any
}

/** Current state of a single MCP server. */
export type McpServerStatus = {
  name: string
  status: 'connected' | 'failed' | 'pending' | 'disabled'
  config?: McpServerConfigForProcessTransport
  error?: string
  [key: string]: any
}

/** Result of /rewind slash command. */
export type RewindFilesResult = {
  filesChanged?: string[]
  userModifiedFiles?: string[]
  canRewind?: boolean
  insertions?: number
  deletions?: number
  error?: string
  [key: string]: any
}