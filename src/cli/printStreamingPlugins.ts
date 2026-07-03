/**
 * Print-mode plugin-lifecycle helpers extracted from `cli/printHeadless.ts`.
 *
 * Owns:
 * - installPluginsAndApplyMcpInBackground: download user/managed
 *   settings, install plugins, then diff/apply MCP server changes.
 * - refreshPluginState: clear plugin caches, reload commands/agents/hooks.
 * - applyPluginMcpDiff: re-read all MCP configs and apply diff to SDK +
 *   dynamic MCP state.
 *
 * Public API re-exported from `cli/printHeadless.ts` for backward
 * compatibility. (These helpers are internal — no public re-export of
 * the runtime object or helpers from `print.ts`.)
 */
import { feature } from 'bun:bundle'
import { downloadUserSettings } from '../services/settingsSync/index.js'
import { waitForRemoteManagedSettingsToLoad } from '../services/remoteManagedSettings/index.js'
import { withDiagnosticsTiming } from '../utils/diagLogs.js'
import { logForDebugging, logError } from '../utils/log.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { getIsRemoteMode } from '../bootstrap/state.js'
import { getAllMcpConfigs } from '../utils/plugins/pluginConfig.js'
import { cwd } from '../utils/process.js'
import { getCommands } from '../utils/commands.js'
import { refreshActivePlugins } from '../utils/plugins/refreshPlugins.js'
import { installPluginsForHeadless } from '../utils/plugins/installPlugins.js'
import {
  applyMcpServerChanges as _applyMcpServerChanges,
  updateSdkMcp as _updateSdkMcp,
  type McpRuntime,
} from './printStreamingMcp.js'
import type {
  McpServerConfigForProcessTransport,
} from '../entrypoints/sdk/controlTypes.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import type { Command } from '../commands.js'
import type { AppState } from '../state/AppStateStore.js'

/**
 * Mutable refs captured by the headless query loop. REPL uses AppState
 * directly; headless keeps these local for hot-reload ergonomics.
 */
export interface PluginRuntime extends McpRuntime {
  getSDKConfigs: McpRuntime['getSDKConfigs']
  getCurrentCommands: () => Command[]
  getCurrentAgents: () => AgentDefinition[]
  setCurrentCommands: (commands: Command[]) => void
  setCurrentAgents: (agents: AgentDefinition[]) => void
  getAppState: () => AppState
}

export async function installPluginsAndApplyMcpInBackground(
  runtime: PluginRuntime,
): Promise<void> {
  try {
    // Join point for user settings (fired at runHeadless entry) and managed
    // settings (fired in main.tsx preAction). downloadUserSettings() caches
    // its promise so this awaits the same in-flight request.
    await Promise.all([
      feature('DOWNLOAD_USER_SETTINGS') &&
      (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) || getIsRemoteMode())
        ? withDiagnosticsTiming('headless_user_settings_download', () =>
            downloadUserSettings(),
          )
        : Promise.resolve(),
      withDiagnosticsTiming('headless_managed_settings_wait', () =>
        waitForRemoteManagedSettingsToLoad(),
      ),
    ])

    const pluginsInstalled = await installPluginsForHeadless()

    if (pluginsInstalled) {
      await applyPluginMcpDiff(runtime)
    }
  } catch (error) {
    logError(error)
  }
}

export async function applyPluginMcpDiff(
  runtime: PluginRuntime,
): Promise<void> {
  const { servers: newConfigs } = await getAllMcpConfigs()
  const supportedConfigs: Record<
    string,
    McpServerConfigForProcessTransport
  > = {}
  for (const [name, config] of Object.entries(newConfigs)) {
    const type = config.type
    if (
      type === undefined ||
      type === 'stdio' ||
      type === 'sse' ||
      type === 'http' ||
      type === 'sdk'
    ) {
      supportedConfigs[name] = config
    }
  }
  // Always preserve SDK MCP configs even if not in disk config — they
  // are managed by the SDK and may not have a disk presence.
  for (const [name, config] of Object.entries(runtime.getSDKConfigs())) {
    if (config.type === 'sdk' && !(name in supportedConfigs)) {
      supportedConfigs[name] = config
    }
  }
  const { response, sdkServersChanged } = await _applyMcpServerChanges(
    supportedConfigs,
    runtime,
  )
  if (sdkServersChanged) {
    void _updateSdkMcp(runtime)
  }
  logForDebugging(
    `Headless MCP refresh: added=${response.added.length}, removed=${response.removed.length}`,
  )
}

export async function refreshPluginState(
  runtime: PluginRuntime,
): Promise<void> {
  // refreshActivePlugins handles the full cache sweep (clearAllCaches),
  // reloads all plugin component loaders, writes AppState.plugins +
  // AppState.agentDefinitions, registers hooks, and bumps mcp.pluginReconnectKey.
  const { agentDefinitions: freshAgentDefs } = await refreshActivePlugins(
    runtime.setAppState,
  )

  // Headless-specific: currentCommands/currentAgents are local mutable refs
  // captured by the query loop (REPL uses AppState instead). getCommands is
  // fresh because refreshActivePlugins cleared its cache.
  runtime.setCurrentCommands(await getCommands(cwd()))

  // Preserve SDK-provided agents (--agents CLI flag or SDK initialize
  // control_request) — both inject via parseAgentsFromJson with
  // source='flagSettings'. loadMarkdownFilesForSubdir never assigns this
  // source, so it cleanly discriminates "injected, not disk-loadable".
  //
  // The previous filter used a negative set-diff (!freshAgentTypes.has(a))
  // which also matched plugin agents that were in the poisoned initial
  // currentAgents but correctly excluded from freshAgentDefs after managed
  // settings applied — leaking policy-blocked agents into the init message.
  // See gh-23085: isBridgeEnabled() at Commander-definition time poisoned
  // the settings cache before setEligibility(true) ran.
  const sdkAgents = runtime
    .getCurrentAgents()
    .filter(a => a.source === 'flagSettings')
  runtime.setCurrentAgents([...freshAgentDefs.allAgents, ...sdkAgents])
}
