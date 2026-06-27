// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle'
import { readFile, stat } from 'fs/promises'
import { dirname } from 'path'
import {
  downloadUserSettings,
  redownloadUserSettings,
} from 'src/services/settingsSync/index.js'
import { waitForRemoteManagedSettingsToLoad } from 'src/services/remoteManagedSettings/index.js'
import { StructuredIO } from 'src/cli/structuredIO.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import {
  type Command,
  formatDescriptionWithSource,
  getCommandName,
} from 'src/commands.js'
import { createStreamlinedTransformer } from 'src/utils/streamlinedTransform.js'
import { installStreamJsonStdoutGuard } from 'src/utils/streamJsonStdoutGuard.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import { assembleToolPool, filterToolsByDenyRules } from 'src/tools.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { uniq } from 'src/utils/array.js'
import { mergeAndFilterTools } from 'src/utils/toolPool.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  logForDiagnosticsNoPII,
  withDiagnosticsTiming,
} from 'src/utils/diagLogs.js'
import { toolMatchesName, type Tool, type Tools } from 'src/Tool.js'
import {
  type AgentDefinition,
  isBuiltInAgent,
  parseAgentsFromJson,
} from 'src/tools/AgentTool/loadAgentsDir.js'
import type { Message, NormalizedUserMessage } from 'src/types/message.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import {
  dequeue,
  dequeueAllMatching,
  enqueue,
  hasCommandsInQueue,
  peek,
  subscribeToCommandQueue,
  getCommandsByMaxPriority,
} from 'src/utils/messageQueueManager.js'
import { notifyCommandLifecycle } from 'src/utils/commandLifecycle.js'
import {
  getSessionState,
  notifySessionStateChanged,
  notifySessionMetadataChanged,
  setPermissionModeChangedListener,
  type RequiresActionDetails,
  type SessionExternalMetadata,
} from 'src/utils/sessionState.js'
import { externalMetadataToAppState } from 'src/state/onChangeAppState.js'
import { getInMemoryErrors, logError, logMCPDebug } from 'src/utils/log.js'
import {
  writeToStdout,
  registerProcessOutputErrorHandlers,
} from 'src/utils/process.js'
import type { Stream } from 'src/utils/stream.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import {
  loadConversationForResume,
  type TurnInterruptionState,
} from 'src/utils/conversationRecovery.js'
import type {
  MCPServerConnection,
  McpSdkServerConfig,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import {
  type DynamicMcpState,
  handleMcpSetServers as _handleMcpSetServers,
} from './printMcp.js'
import {
  handleOrphanedPermissionResponse as _handleOrphanedPermissionResponse,
} from './printPermission.js'
import {
  trackReceivedMessageUuid as _trackReceivedMessageUuid,
  type PromptValue as _PromptValue,
  toBlocks as _toBlocks,
  joinPromptValues as _joinPromptValues,
  canBatchWith as _canBatchWith,
  removeInterruptedMessage as _removeInterruptedMessage,
} from './printHelpers.js'
import {
  ChannelMessageNotificationSchema,
  gateChannelServer,
  wrapChannelMessage,
  findChannelEntry,
} from 'src/services/mcp/channelNotification.js'
import {
  isChannelAllowlisted,
  isChannelsEnabled,
} from 'src/services/mcp/channelAllowlist.js'
import { parsePluginIdentifier } from 'src/utils/plugins/pluginIdentifier.js'
import { validateUuid } from 'src/utils/uuid.js'
import { fromArray } from 'src/utils/generators.js'
import { ask } from 'src/QueryEngine.js'
import type { PermissionPromptTool } from 'src/utils/queryHelpers.js'
import {
  createFileStateCacheWithSizeLimit,
  mergeFileStateCaches,
  READ_FILE_STATE_CACHE_SIZE,
} from 'src/utils/fileStateCache.js'
import { expandPath } from 'src/utils/path.js'
import { extractReadFilesFromMessages } from 'src/utils/queryHelpers.js'
import { registerHookEventHandler } from 'src/utils/hooks/hookEvents.js'
import { executeFilePersistence } from 'src/utils/filePersistence/filePersistence.js'
import { finalizePendingAsyncHooks } from 'src/utils/hooks/AsyncHookRegistry.js'
import {
  gracefulShutdown,
  gracefulShutdownSync,
  isShuttingDown,
} from 'src/utils/gracefulShutdown.js'
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import { createIdleTimeoutManager } from 'src/utils/idleTimeout.js'
import type {
  SDKStatus,
  ModelInfo,
  SDKMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  PermissionResult,
  McpServerConfigForProcessTransport,
  McpServerStatus,
  RewindFilesResult,
} from 'src/entrypoints/agentSdkTypes.js'
import type {
  StdoutMessage,
  SDKControlInitializeRequest,
  SDKControlInitializeResponse,
  SDKControlRequest,
  SDKControlResponse,
  SDKControlMcpSetServersResponse,
  SDKControlReloadPluginsResponse,
} from 'src/entrypoints/sdk/controlTypes.js'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionMode as InternalPermissionMode } from 'src/types/permissions.js'
import { cwd } from 'process'
import { getCwd } from 'src/utils/cwd.js'
import omit from 'lodash-es/omit.js'
import reject from 'lodash-es/reject.js'
import { isPolicyAllowed } from 'src/services/policyLimits/index.js'
import type { ReplBridgeHandle } from 'src/bridge/replBridge.js'
import { getRemoteSessionUrl } from 'src/constants/product.js'
import { buildBridgeConnectUrl } from 'src/bridge/bridgeStatusUtil.js'
import { extractInboundMessageFields } from 'src/bridge/inboundMessages.js'
import { resolveAndPrepend } from 'src/bridge/inboundAttachments.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import { safeParseJSON } from 'src/utils/json.js'
import {
  outputSchema as permissionToolOutputSchema,
  permissionPromptToolResultToPermissionDecision,
} from 'src/utils/permissions/PermissionPromptToolResultSchema.js'
import { createAbortController } from 'src/utils/abortController.js'
import { createCombinedAbortSignal } from 'src/utils/combinedAbortSignal.js'
import { generateSessionTitle } from 'src/utils/sessionTitle.js'
import { buildSideQuestionFallbackParams } from 'src/utils/queryContext.js'
import { runSideQuestion } from 'src/utils/sideQuestion.js'
import {
  processSessionStartHooks,
  processSetupHooks,
  takeInitialUserMessage,
} from 'src/utils/sessionStart.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getAllOutputStyles,
} from 'src/constants/outputStyles.js'
import { TEAMMATE_MESSAGE_TAG, TICK_TAG } from 'src/constants/xml.js'
import {
  getSettings_DEPRECATED,
  getSettingsWithSources,
} from 'src/utils/settings/settings.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import { applySettingsChange } from 'src/utils/settings/applySettingsChange.js'
import {
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
  getFastModeState,
} from 'src/utils/fastMode.js'
import {
  isAutoModeGateEnabled,
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isBypassPermissionsModeDisabled,
  transitionPermissionMode,
} from 'src/utils/permissions/permissionSetup.js'
import {
  tryGenerateSuggestion,
  logSuggestionOutcome,
  logSuggestionSuppressed,
  type PromptVariant,
} from 'src/services/PromptSuggestion/promptSuggestion.js'
import { getLastCacheSafeParams } from 'src/utils/forkedAgent.js'
import { getAccountInformation } from 'src/utils/auth.js'
import { OAuthService } from 'src/services/oauth/index.js'
import { installOAuthTokens } from 'src/cli/handlers/auth.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import type { HookCallbackMatcher } from 'src/types/hooks.js'
import { AwsAuthStatusManager } from 'src/utils/awsAuthStatusManager.js'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import {
  registerHookCallbacks,
  setInitJsonSchema,
  getInitJsonSchema,
  setSdkAgentProgressSummariesEnabled,
} from 'src/bootstrap/state.js'
import { createSyntheticOutputTool } from 'src/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { parseSessionIdentifier } from 'src/utils/sessionUrl.js'
import {
  hydrateRemoteSession,
  hydrateFromCCRv2InternalEvents,
  resetSessionFilePointer,
  doesMessageExistInSession,
  findUnresolvedToolUse,
  recordAttributionSnapshot,
  saveAgentSetting,
  saveMode,
  saveAiGeneratedTitle,
  restoreSessionMetadata,
} from 'src/utils/sessionStorage.js'
import { incrementPromptCount } from 'src/utils/commitAttribution.js'
import {
  setupSdkMcpClients,
  connectToServer,
  clearServerCache,
  fetchToolsForClient,
  areMcpConfigsEqual,
  reconnectMcpServerImpl,
} from 'src/services/mcp/client.js'
import {
  filterMcpServersByPolicy,
  getMcpConfigByName,
  isMcpServerDisabled,
  setMcpServerEnabled,
} from 'src/services/mcp/config.js'
import {
  performMCPOAuthFlow,
  revokeServerTokens,
} from 'src/services/mcp/auth.js'
import {
  runElicitationHooks,
  runElicitationResultHooks,
} from 'src/services/mcp/elicitationHandler.js'
import { executeNotificationHooks } from 'src/utils/hooks.js'
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getMcpPrefix } from 'src/services/mcp/mcpStringUtils.js'
import {
  commandBelongsToServer,
  filterToolsByServer,
} from 'src/services/mcp/utils.js'
import { setupVscodeSdkMcp } from 'src/services/mcp/vscodeSdkMcp.js'
import { getAllMcpConfigs } from 'src/services/mcp/config.js'
import {
  isQualifiedForGrove,
  checkGroveForNonInteractive,
} from 'src/services/api/grove.js'
import {
  toInternalMessages,
  toSDKRateLimitInfo,
} from 'src/utils/messages/mappers.js'
import { createModelSwitchBreadcrumbs } from 'src/utils/messages.js'
import { collectContextData } from 'src/commands/context/context-noninteractive.js'
import { LOCAL_COMMAND_STDOUT_TAG } from 'src/constants/xml.js'
import {
  statusListeners,
  type ClaudeAILimits,
} from 'src/services/claudeAiLimits.js'
import {
  getDefaultMainLoopModel,
  getMainLoopModel,
  modelDisplayString,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import { getModelOptions } from 'src/utils/model/modelOptions.js'
import {
  modelSupportsEffort,
  modelSupportsMaxEffort,
  EFFORT_LEVELS,
  resolveAppliedEffort,
} from 'src/utils/effort.js'
import { modelSupportsAdaptiveThinking } from 'src/utils/thinking.js'
import { modelSupportsAutoMode } from 'src/utils/betas.js'
import { ensureModelStringsInitialized } from 'src/utils/model/modelStrings.js'
import {
  getSessionId,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  switchSession,
  isSessionPersistenceDisabled,
  getIsRemoteMode,
  getFlagSettingsInline,
  setFlagSettingsInline,
  getMainThreadAgentType,
  getAllowedChannels,
  setAllowedChannels,
  type ChannelEntry,
} from 'src/bootstrap/state.js'
import { runWithWorkload, WORKLOAD_CRON } from 'src/utils/workloadContext.js'
import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { AppState } from 'src/state/AppStateStore.js'
import {
  fileHistoryRewind,
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
} from 'src/utils/fileHistory.js'
import {
  restoreAgentFromSession,
  restoreSessionStateFromLog,
} from 'src/utils/sessionRestore.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import {
  headlessProfilerStartTurn,
  headlessProfilerCheckpoint,
  logHeadlessProfilerTurn,
} from 'src/utils/headlessProfiler.js'
import {
  startQueryProfile,
  logQueryProfileReport,
} from 'src/utils/queryProfiler.js'
import { asSessionId } from 'src/types/ids.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { skillChangeDetector } from '../utils/skills/skillChangeDetector.js'
import { getCommands, clearCommandsCache } from '../commands.js'
import {
  isBareMode,
  isEnvTruthy,
  isEnvDefinedFalsy,
} from '../utils/envUtils.js'
import { installPluginsForHeadless } from '../utils/plugins/headlessPluginInstall.js'
import { refreshActivePlugins } from '../utils/plugins/refresh.js'
import { loadAllPluginsCacheOnly } from '../utils/plugins/pluginLoader.js'
import {
  isTeamLead,
  hasActiveInProcessTeammates,
  hasWorkingInProcessTeammates,
  waitForTeammatesToBecomeIdle,
} from '../utils/teammate.js'
import {
  readUnreadMessages,
  markMessagesAsRead,
  isShutdownApproved,
} from '../utils/teammateMailbox.js'
import { removeTeammateFromTeamFile } from '../utils/swarm/teamHelpers.js'
import { unassignTeammateTasks } from '../utils/tasks.js'
import { getRunningTasks } from '../utils/task/framework.js'
import { isBackgroundTask } from '../tasks/types.js'
import { stopTask } from '../tasks/stopTask.js'
import { drainSdkEvents } from '../utils/sdkEventQueue.js'
import { initializeGrowthBook } from '../services/analytics/growthbook.js'
import { errorMessage, toError } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import { isExtractModeActive } from '../memdir/paths.js'

// Dead code elimination: conditional imports
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js'))
  : null
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../proactive/index.js') as typeof import('../proactive/index.js'))
    : null
const cronSchedulerModule = feature('AGENT_TRIGGERS')
  ? (require('../utils/cronScheduler.js') as typeof import('../utils/cronScheduler.js'))
  : null
const cronJitterConfigModule = feature('AGENT_TRIGGERS')
  ? (require('../utils/cronJitterConfig.js') as typeof import('../utils/cronJitterConfig.js'))
  : null
const cronGate = feature('AGENT_TRIGGERS')
  ? (require('../tools/ScheduleCronTool/prompt.js') as typeof import('../tools/ScheduleCronTool/prompt.js'))
  : null
const extractMemoriesModule = feature('EXTRACT_MEMORIES')
  ? (require('../services/extractMemories/extractMemories.js') as typeof import('../services/extractMemories/extractMemories.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const SHUTDOWN_TEAM_PROMPT = `<system-reminder>
You are running in non-interactive mode and cannot return a response to the user until your team is shut down.

You MUST shut down your team before preparing your final response:
1. Use requestShutdown to ask each team member to shut down gracefully
2. Wait for shutdown approvals
3. Use the cleanup operation to clean up the team
4. Only then provide your final response to the user

The user cannot receive your response until the team is completely shut down.
</system-reminder>

Shut down your team and prepare your final response for the user.`
/**
 * MCP server handling is extracted to `./printMcp.ts` to reduce this file's
 * size. Re-exported below for backward compatibility.
 */
export { handleMcpSetServers, reconcileMcpServers } from './printMcp.js'
export type {
  DynamicMcpState,
  SdkMcpState,
  McpSetServersResult,
} from './printMcp.js'

/**
 * Session loading and structured I/O helpers extracted to
 * `./printLifecycle.ts`. Re-exported below for backward compatibility.
 */
export type { LoadInitialMessagesResult } from './printLifecycle.js'
export { getStructuredIO } from './printLifecycle.js'

/**
 * Permission helpers extracted to `./printPermission.ts`. Re-exported
 * below for backward compatibility.
 */
export {
  createCanUseToolWithPermissionPrompt,
  getCanUseToolFn,
  handleOrphanedPermissionResponse,
} from './printPermission.js'

/**
 * Print-mode utility helpers extracted to `./printHelpers.ts`.
 * Re-exported below for backward compatibility.
 */
export { joinPromptValues, canBatchWith, removeInterruptedMessage } from './printHelpers.js'
export type { PromptValue } from './printHelpers.js'

/**
 * SDK control handlers extracted to `./printHandlers.ts`. Re-exported
 * below for backward compatibility.
 */
export {
  handleInitializeRequest,
  handleRewindFiles,
  handleSetPermissionMode,
  handleChannelEnable,
  reregisterChannelHandlerAfterReconnect,
  emitLoadError,
} from './printHandlers.js'

/**
 * Headless mode entry points extracted to `./printHeadless.ts`.
 * Re-exported below for backward compatibility.
 */
export { runHeadless, runHeadlessStreaming } from './printHeadless.js'

