/**
 * Streaming-mode MCP helpers extracted from `cli/printHeadless.ts`.
 *
 * Owns:
 * - buildMcpServerStatuses: convert live MCP client state into the
 *   SDK's `McpServerStatus[]` shape for control responses.
 * - applyMcpServerChanges: serialize mcp_set_servers control requests so
 *   the SDK and CLI can race on the same set of MCP servers.
 */
import uniqBy from 'lodash-es/uniqBy.js'
import { feature } from 'bun:bundle'
import { uniq } from '../utils/array.js'
import { isChannelsEnabled, isChannelAllowlisted } from '../services/mcp/channelAllowlist.js'
import { filterToolsByServer } from '../services/mcp/utils.js'
import { getMcpPrefix } from '../services/mcp/mcpStringUtils.js'
import { handleMcpSetServers as _handleMcpSetServers } from './printMcp.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Tools } from '../Tool.js'
import type {
  McpServerConfigForProcessTransport,
  McpServerStatus,
  McpSdkServerConfig,
  SDKControlMcpSetServersResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { DynamicMcpState, SdkMcpState } from './printMcp.js'

  // Build McpServerStatus[] for control responses. Shared by mcp_status and
  // reload_plugins handlers.
  export function buildMcpServerStatuses(
    getAppState: () => AppState,
    dynamicMcpState: DynamicMcpState,
    sdkClients: MCPServerConnection[],
  ): McpServerStatus[] {
    const currentAppState = getAppState()
    const currentMcpClients = currentAppState.mcp.clients
    const allMcpTools = uniqBy(
      [...currentAppState.mcp.tools, ...dynamicMcpState.tools],
      'name',
    )
    const existingNames = new Set([
      ...currentMcpClients.map(c => c.name),
      ...sdkClients.map(c => c.name),
    ])
    return [
      ...currentMcpClients,
      ...sdkClients,
      ...dynamicMcpState.clients.filter(c => !existingNames.has(c.name)),
    ].map(connection => {
      let config
      if (
        connection.config.type === 'sse' ||
        connection.config.type === 'http'
      ) {
        config = {
          type: connection.config.type,
          url: connection.config.url,
          headers: connection.config.headers,
          oauth: connection.config.oauth,
        }
      } else if (connection.config.type === 'claudeai-proxy') {
        config = {
          type: 'claudeai-proxy' as const,
          url: connection.config.url,
          id: connection.config.id,
        }
      } else if (
        connection.config.type === 'stdio' ||
        connection.config.type === undefined
      ) {
        config = {
          type: 'stdio' as const,
          command: connection.config.command,
          args: connection.config.args,
        }
      }
      const serverTools =
        connection.type === 'connected'
          ? filterToolsByServer(allMcpTools, connection.name).map(tool => ({
              name: tool.mcpInfo?.toolName ?? tool.name,
              annotations: {
                readOnly: tool.isReadOnly({}) || undefined,
                destructive: tool.isDestructive?.({}) || undefined,
                openWorld: tool.isOpenWorld?.({}) || undefined,
              },
            }))
          : undefined
      // Capabilities passthrough with allowlist pre-filter. The IDE reads
      // experimental['claude/channel'] to decide whether to show the
      // Enable-channel prompt — only echo it if channel_enable would
      // actually pass the allowlist. Not a security boundary (the
      // handler re-runs the full gate); just avoids dead buttons.
      let capabilities: { experimental?: Record<string, unknown> } | undefined
      if (
        (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
        connection.type === 'connected' &&
        connection.capabilities.experimental
      ) {
        const exp = { ...connection.capabilities.experimental }
        if (
          exp['claude/channel'] &&
          (!isChannelsEnabled() ||
            !isChannelAllowlisted(connection.config.pluginSource))
        ) {
          delete exp['claude/channel']
        }
        if (Object.keys(exp).length > 0) {
          capabilities = { experimental: exp }
        }
      }
      return {
        name: connection.name,
        status: connection.type,
        serverInfo:
          connection.type === 'connected' ? connection.serverInfo : undefined,
        error: connection.type === 'failed' ? connection.error : undefined,
        config,
        scope: connection.config.scope,
        tools: serverTools,
        capabilities,
      }
    })
  }
