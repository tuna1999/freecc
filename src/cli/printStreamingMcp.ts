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
/* eslint-disable @typescript-eslint/no-require-imports */
export function registerElicitationHandlers(
  clients: MCPServerConnection[],
  elicitationRegistered: Set<string>,
): void {
    for (const connection of clients) {
      if (
        connection.type !== 'connected' ||
        elicitationRegistered.has(connection.name)
      ) {
        continue
      }
      // Skip SDK MCP servers — elicitation flows through SdkControlClientTransport
      if (connection.config.type === 'sdk') {
        continue
      }
      const serverName = connection.name

      // Wrapped in try/catch because setRequestHandler throws if the client wasn't
      // created with elicitation capability declared (e.g., SDK-created clients).
      try {
        connection.client.setRequestHandler(
          ElicitRequestSchema,
          async (request, extra) => {
            logMCPDebug(
              serverName,
              `Elicitation request received in print mode: ${jsonStringify(request)}`,
            )

            const mode = request.params.mode === 'url' ? 'url' : 'form'

            logEvent('tengu_mcp_elicitation_shown', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })

            // Run elicitation hooks first — they can provide a response programmatically
            const hookResponse = await runElicitationHooks(
              serverName,
              request.params,
              extra.signal,
            )
            if (hookResponse) {
              logMCPDebug(
                serverName,
                `Elicitation resolved by hook: ${jsonStringify(hookResponse)}`,
              )
              logEvent('tengu_mcp_elicitation_response', {
                mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                action:
                  hookResponse.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              return hookResponse
            }

            // Delegate to SDK consumer via control protocol
            const url =
              'url' in request.params
                ? (request.params.url as string)
                : undefined
            const requestedSchema =
              'requestedSchema' in request.params
                ? (request.params.requestedSchema as
                    | Record<string, unknown>
                    | undefined)
                : undefined

            const elicitationId =
              'elicitationId' in request.params
                ? (request.params.elicitationId as string | undefined)
                : undefined

            const rawResult = await structuredIO.handleElicitation(
              serverName,
              request.params.message,
              requestedSchema,
              extra.signal,
              mode,
              url,
              elicitationId,
            )

            const result = await runElicitationResultHooks(
              serverName,
              rawResult,
              extra.signal,
              mode,
              elicitationId,
            )

            logEvent('tengu_mcp_elicitation_response', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              action:
                result.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            return result
          },
        )

        // Surface completion notifications to SDK consumers (URL mode)
        connection.client.setNotificationHandler(
          ElicitationCompleteNotificationSchema,
          notification => {
            const { elicitationId } = notification.params
            logMCPDebug(
              serverName,
              `Elicitation completion notification: ${elicitationId}`,
            )
            void executeNotificationHooks({
              message: `MCP server "${serverName}" confirmed elicitation ${elicitationId} complete`,
              notificationType: 'elicitation_complete',
            })
            output.enqueue({
              type: 'system',
              subtype: 'elicitation_complete',
              mcp_server_name: serverName,
              elicitation_id: elicitationId,
              uuid: randomUUID(),
              session_id: getSessionId(),
            })
          },
        )

        elicitationRegistered.add(serverName)
      } catch {
        // setRequestHandler throws if the client wasn't created with
        // elicitation capability — skip silently
      }
    }
  }


/**
 * Bundle of closure state shared between updateSdkMcp and
 * applyMcpServerChanges. Both functions read or mutate the same
 * SDK/dynamic MCP fields plus AppState, so passing them in one
 * object keeps the call sites readable.
 */
export interface McpRuntime {
  getSDKConfigs: () => Record<string, McpSdkServerConfig>
  getDynamicState: () => DynamicMcpState
  getSdkClients: () => MCPServerConnection[]
  getSdkTools: () => Tools
  setAppState: (f: (prev: AppState) => AppState) => void
  /** Mutators — the runtime owns the actual let bindings. */
  setSdkClients: (clients: MCPServerConnection[]) => void
  setSdkTools: (tools: Tools) => void
  setDynamicState: (state: DynamicMcpState) => void
}

export async function updateSdkMcp(runtime: McpRuntime): Promise<void> {
  // Re-read live state each call so the function reflects changes
  // made by applyMcpServerChanges between invocations.
  const sdkMcpConfigs = runtime.getSDKConfigs()
  const sdkClients = runtime.getSdkClients()
  const sdkTools = runtime.getSdkTools()
  const dynamicMcpState = runtime.getDynamicState()

  // Check if SDK MCP servers need to be updated (new servers added or removed)
  const currentServerNames = new Set(Object.keys(sdkMcpConfigs))
  const connectedServerNames = new Set(sdkClients.map(c => c.name))

  // Check if there are any differences (additions or removals)
  const hasNewServers = Array.from(currentServerNames).some(
    name => !connectedServerNames.has(name),
  )
  const hasRemovedServers = Array.from(connectedServerNames).some(
    name => !currentServerNames.has(name),
  )
  // Check if any SDK clients are pending and need to be upgraded
  const hasPendingSdkClients = sdkClients.some(c => c.type === 'pending')
  // Check if any SDK clients failed their handshake and need to be retried.
  const hasFailedSdkClients = sdkClients.some(c => c.type === 'failed')

  if (
    !hasNewServers &&
    !hasRemovedServers &&
    !hasPendingSdkClients &&
    !hasFailedSdkClients
  ) {
    return
  }

  // Build the set of all SDK server names (current + new) for tool filtering.
  // Used when removing stale tool entries from appState.
  const allSdkNames = new Set([
    ...currentServerNames,
    ...connectedServerNames,
  ])

  // Compute the previous SDK client names BEFORE setupSdkMcpClients runs,
  // so we know which clients to clean up if their configs disappear.
  const previousSdkClients = sdkClients
  const previousSdkClientNames = new Set(previousSdkClients.map(c => c.name))

  try {
    // Re-initialize all SDK MCP servers with current config
    const sdkSetup = await setupSdkMcpClients(
      sdkMcpConfigs,
      (serverName, message) => structuredIO.sendMcpMessage(serverName, message),
    )
    runtime.setSdkClients(sdkSetup.clients)
    runtime.setSdkTools(sdkSetup.tools)

    // Store SDK MCP tools in appState so subagents can access them via
    // assembleToolPool. Only tools are stored here — SDK clients are already
    // tracked via sdkMcpConfigs closure.
    runtime.setAppState(prev => {
      // Tools that were registered in a previous SDK MCP setup but are no
      // longer in the current config need to be removed from appState.
      const toolsToRemove = new Set<string>()
      for (const prevName of previousSdkClientNames) {
        if (!allSdkNames.has(prevName)) {
          // Mark all tools that were registered under this server prefix.
          const prefix = getMcpPrefix(prevName)
          for (const tool of prev.mcp.tools) {
            if (tool.name.startsWith(prefix)) {
              toolsToRemove.add(tool.name)
            }
          }
        }
      }

      // Keep all non-SDK tools plus the freshly-built SDK tools.
      const filtered = prev.mcp.tools.filter(t => !toolsToRemove.has(t.name))

      return {
        ...prev,
        mcp: {
          ...prev.mcp,
          tools: [...filtered, ...sdkSetup.tools],
        },
      }
    })

    // Tear down the per-client resources for any clients that were
    // dropped (server removed) OR whose config changed (config update).
    // We can't easily tell the two apart from the previous snapshot
    // alone, so we close any client whose name is no longer present.
    for (const client of previousSdkClients) {
      if (!allSdkNames.has(client.name) && client.type === 'connected') {
        await client.cleanup()
      }
    }
  } catch (e) {
    logError(e)
  }
}

/**
 * Serialize calls to applyMcpServerChanges so concurrent callers
 * (background plugin install and mcp_set_servers control messages)
 * don't race on the same SDK MCP state.
 *
 * The promise chain lives at module scope here so it persists across
 * calls but doesn't leak to printHeadless's closure.
 */
let mcpChangesPromise: Promise<{
  response: SDKControlMcpSetServersResponse
  sdkServersChanged: boolean
}> = Promise.resolve({
  response: { added: [], removed: [], errors: {} },
  sdkServersChanged: false,
})

export async function applyMcpServerChanges(
  servers: Record<string, McpServerConfigForProcessTransport>,
  runtime: McpRuntime,
): Promise<{
  response: SDKControlMcpSetServersResponse
  sdkServersChanged: boolean
}> {
  const doWork = async (): Promise<{
    response: SDKControlMcpSetServersResponse
    sdkServersChanged: boolean
  }> => {
    const sdkMcpConfigs = runtime.getSDKConfigs()
    const sdkClients = runtime.getSdkClients()
    const dynamicMcpState = runtime.getDynamicState()

    const oldSdkClientNames = new Set(sdkClients.map(c => c.name))

    const result = await __handleMcpSetServers(
      servers,
      { configs: sdkMcpConfigs, clients: sdkClients, tools: runtime.getSdkTools() },
      dynamicMcpState,
      runtime.setAppState,
    )

    // Update SDK state (need to mutate sdkMcpConfigs since it's shared)
    for (const key of Object.keys(sdkMcpConfigs)) {
      delete sdkMcpConfigs[key]
    }
    Object.assign(sdkMcpConfigs, result.newSdkState.configs)
    runtime.setSdkClients(result.newSdkState.clients)
    runtime.setSdkTools(result.newSdkState.tools)
    runtime.setDynamicState(result.newDynamicState)

    // Keep appState.mcp.tools in sync so subagents can see SDK MCP tools.
    // Use both old and new SDK client names to remove stale tools.
    if (result.sdkServersChanged) {
      const newSdkClientNames = new Set(result.newSdkState.clients.map(c => c.name))
      const allSdkNames = uniq([...oldSdkClientNames, ...newSdkClientNames])
      runtime.setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          tools: [
            ...prev.mcp.tools.filter(
              t =>
                !allSdkNames.some(name =>
                  t.name.startsWith(getMcpPrefix(name)),
                ),
            ),
            ...result.newSdkState.tools,
          ],
        },
      }))
    }

    return {
      response: result.response,
      sdkServersChanged: result.sdkServersChanged,
    }
  }

  mcpChangesPromise = mcpChangesPromise.then(doWork, doWork)
  return mcpChangesPromise
}
