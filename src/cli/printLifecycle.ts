/**
 * Print-mode lifecycle helpers extracted from `cli/print.ts`.
 *
 * Owns:
 * - LoadInitialMessagesResult type
 * - loadInitialMessages (continue/teleport/resume/fork session loading)
 * - getStructuredIO (input stream → StructuredIO/RemoteIO)
 */
import { feature } from 'bun:bundle'
import type { Message } from '../types/message.js'
import type { AppState } from '../state/AppStateStore.js'
import type { TurnInterruptionState } from '../utils/conversationRecovery.js'
import type { StructuredIO } from './structuredIO.js'
import { RemoteIO } from './remoteIO.js'
import type { SDKUserMessage, SessionExternalMetadata } from '../entrypoints/agentSdkTypes.js'
import { loadConversationForResume } from '../utils/conversationRecovery.js'
import { restoreSessionStateFromLog } from '../utils/sessionRestore.js'
import { restoreSessionMetadata } from '../utils/sessionStorage.js'
import { resetSessionFilePointer, saveMode } from '../utils/sessionStorage.js'
import { processSessionStartHooks } from '../utils/sessionStart.js'
import { switchSession, isSessionPersistenceDisabled } from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import { isPolicyAllowed } from '../services/policyLimits/index.js'
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js'
import { logError } from '../utils/log.js'
import { logEvent } from '../services/analytics/index.js'
import { fromArray } from '../utils/generators.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { getCwd } from '../utils/cwd.js'

type LoadInitialMessagesResult = {
  messages: Message[]
  turnInterruptionState?: TurnInterruptionState
  agentSetting?: string
}

async function loadInitialMessages(
  setAppState: (f: (prev: AppState) => AppState) => void,
  options: {
    continue: boolean | undefined
    teleport: string | true | null | undefined
    resume: string | boolean | undefined
    resumeSessionAt: string | undefined
    forkSession: boolean | undefined
    outputFormat: string | undefined
    sessionStartHooksPromise?: ReturnType<typeof processSessionStartHooks>
    restoredWorkerState: Promise<SessionExternalMetadata | null>
  },
): Promise<LoadInitialMessagesResult> {
  const persistSession = !isSessionPersistenceDisabled()
  // Handle continue in print mode
  if (options.continue) {
    try {
      logEvent('tengu_continue_print', {})

      const result = await loadConversationForResume(
        undefined /* sessionId */,
        undefined /* file path */,
      )
      if (result) {
        // Match coordinator mode to the resumed session's mode
        if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
          const warning = coordinatorModeModule.matchSessionMode(result.mode)
          if (warning) {
            process.stderr.write(warning + '\n')
            // Refresh agent definitions to reflect the mode switch
            const {
              getAgentDefinitionsWithOverrides,
              getActiveAgentsFromList,
            } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require('../tools/AgentTool/loadAgentsDir.js') as typeof import('../tools/AgentTool/loadAgentsDir.js')
            getAgentDefinitionsWithOverrides.cache.clear?.()
            const freshAgentDefs = await getAgentDefinitionsWithOverrides(
              getCwd(),
            )

            setAppState(prev => ({
              ...prev,
              agentDefinitions: {
                ...freshAgentDefs,
                allAgents: freshAgentDefs.allAgents,
                activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
              },
            }))
          }
        }

        // Reuse the resumed session's ID
        if (!options.forkSession) {
          if (result.sessionId) {
            switchSession(
              asSessionId(result.sessionId),
              result.fullPath ? dirname(result.fullPath) : null,
            )
            if (persistSession) {
              await resetSessionFilePointer()
            }
          }
        }
        restoreSessionStateFromLog(result, setAppState)

        // Restore session metadata so it's re-appended on exit via reAppendSessionMetadata
        restoreSessionMetadata(
          options.forkSession
            ? { ...result, worktreeSession: undefined }
            : result,
        )

        // Write mode entry for the resumed session
        if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
          saveMode(
            coordinatorModeModule.isCoordinatorMode()
              ? 'coordinator'
              : 'normal',
          )
        }

        return {
          messages: result.messages,
          turnInterruptionState: result.turnInterruptionState,
          agentSetting: result.agentSetting,
        }
      }
    } catch (error) {
      logError(error)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  // Handle teleport in print mode
  if (options.teleport) {
    try {
      if (!isPolicyAllowed('allow_remote_sessions')) {
        throw new Error(
          "Remote sessions are disabled by your organization's policy.",
        )
      }

      logEvent('tengu_teleport_print', {})

      if (typeof options.teleport !== 'string') {
        throw new Error('No session ID provided for teleport')
      }

      const {
        checkOutTeleportedSessionBranch,
        processMessagesForTeleportResume,
        teleportResumeCodeSession,
        validateGitState,
      } = await import('src/utils/teleport.js')
      await validateGitState()
      const teleportResult = await teleportResumeCodeSession(options.teleport)
      const { branchError } = await checkOutTeleportedSessionBranch(
        teleportResult.branch,
      )
      return {
        messages: processMessagesForTeleportResume(
          teleportResult.log,
          branchError,
        ),
      }
    } catch (error) {
      logError(error)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  // Handle resume in print mode (accepts session ID or URL)
  // URLs are [ANT-ONLY]
  if (options.resume) {
    try {
      logEvent('tengu_resume_print', {})

      // In print mode - we require a valid session ID, JSONL file or URL
      const parsedSessionId = parseSessionIdentifier(
        typeof options.resume === 'string' ? options.resume : '',
      )
      if (!parsedSessionId) {
        let errorMessage =
          'Error: --resume requires a valid session ID when used with --print. Usage: claude -p --resume <session-id>'
        if (typeof options.resume === 'string') {
          errorMessage += `. Session IDs must be in UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000). Provided value "${options.resume}" is not a valid UUID`
        }
        emitLoadError(errorMessage, options.outputFormat)
        gracefulShutdownSync(1)
        return { messages: [] }
      }

      // Hydrate local transcript from remote before loading
      if (isEnvTruthy(process.env.CLAUDE_CODE_USE_CCR_V2)) {
        // Await restore alongside hydration so SSE catchup lands on
        // restored state, not a fresh default.
        const [, metadata] = await Promise.all([
          hydrateFromCCRv2InternalEvents(parsedSessionId.sessionId),
          options.restoredWorkerState,
        ])
        if (metadata) {
          setAppState(externalMetadataToAppState(metadata))
          if (typeof metadata.model === 'string') {
            setMainLoopModelOverride(metadata.model)
          }
        }
      } else if (
        parsedSessionId.isUrl &&
        parsedSessionId.ingressUrl &&
        isEnvTruthy(process.env.ENABLE_SESSION_PERSISTENCE)
      ) {
        // v1: fetch session logs from Session Ingress
        await hydrateRemoteSession(
          parsedSessionId.sessionId,
          parsedSessionId.ingressUrl,
        )
      }

      // Load the conversation with the specified session ID
      const result = await loadConversationForResume(
        parsedSessionId.sessionId,
        parsedSessionId.jsonlFile || undefined,
      )

      // hydrateFromCCRv2InternalEvents writes an empty transcript file for
      // fresh sessions (writeFile(sessionFile, '') with zero events), so
      // loadConversationForResume returns {messages: []} not null. Treat
      // empty the same as null so SessionStart still fires.
      if (!result || result.messages.length === 0) {
        // For URL-based or CCR v2 resume, start with empty session (it was hydrated but empty)
        if (
          parsedSessionId.isUrl ||
          isEnvTruthy(process.env.CLAUDE_CODE_USE_CCR_V2)
        ) {
          // Execute SessionStart hooks for startup since we're starting a new session
          return {
            messages: await (options.sessionStartHooksPromise ??
              processSessionStartHooks('startup')),
          }
        } else {
          emitLoadError(
            `No conversation found with session ID: ${parsedSessionId.sessionId}`,
            options.outputFormat,
          )
          gracefulShutdownSync(1)
          return { messages: [] }
        }
      }

      // Handle resumeSessionAt feature
      if (options.resumeSessionAt) {
        const index = result.messages.findIndex(
          m => m.uuid === options.resumeSessionAt,
        )
        if (index < 0) {
          emitLoadError(
            `No message found with message.uuid of: ${options.resumeSessionAt}`,
            options.outputFormat,
          )
          gracefulShutdownSync(1)
          return { messages: [] }
        }

        result.messages = index >= 0 ? result.messages.slice(0, index + 1) : []
      }

      // Match coordinator mode to the resumed session's mode
      if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
        const warning = coordinatorModeModule.matchSessionMode(result.mode)
        if (warning) {
          process.stderr.write(warning + '\n')
          // Refresh agent definitions to reflect the mode switch
          const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../tools/AgentTool/loadAgentsDir.js') as typeof import('../tools/AgentTool/loadAgentsDir.js')
          getAgentDefinitionsWithOverrides.cache.clear?.()
          const freshAgentDefs = await getAgentDefinitionsWithOverrides(
            getCwd(),
          )

          setAppState(prev => ({
            ...prev,
            agentDefinitions: {
              ...freshAgentDefs,
              allAgents: freshAgentDefs.allAgents,
              activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
            },
          }))
        }
      }

      // Reuse the resumed session's ID
      if (!options.forkSession && result.sessionId) {
        switchSession(
          asSessionId(result.sessionId),
          result.fullPath ? dirname(result.fullPath) : null,
        )
        if (persistSession) {
          await resetSessionFilePointer()
        }
      }
      restoreSessionStateFromLog(result, setAppState)

      // Restore session metadata so it's re-appended on exit via reAppendSessionMetadata
      restoreSessionMetadata(
        options.forkSession
          ? { ...result, worktreeSession: undefined }
          : result,
      )

      // Write mode entry for the resumed session
      if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
        saveMode(
          coordinatorModeModule.isCoordinatorMode() ? 'coordinator' : 'normal',
        )
      }

      return {
        messages: result.messages,
        turnInterruptionState: result.turnInterruptionState,
        agentSetting: result.agentSetting,
      }
    } catch (error) {
      logError(error)
      const errorMessage =
        error instanceof Error
          ? `Failed to resume session: ${error.message}`
          : 'Failed to resume session with --print mode'
      emitLoadError(errorMessage, options.outputFormat)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  // Join the SessionStart hooks promise kicked in main.tsx (or run fresh if
  // it wasn't kicked — e.g. --continue with no prior session falls through
  // here with sessionStartHooksPromise undefined because main.tsx guards on continue)
  return {
    messages: await (options.sessionStartHooksPromise ??
      processSessionStartHooks('startup')),
  }
}

function getStructuredIO(
  inputPrompt: string | AsyncIterable<string>,
  options: {
    sdkUrl: string | undefined
    replayUserMessages?: boolean
  },
): StructuredIO {
  let inputStream: AsyncIterable<string>
  if (typeof inputPrompt === 'string') {
    if (inputPrompt.trim() !== '') {
      // Normalize to a streaming input.
      inputStream = fromArray([
        jsonStringify({
          type: 'user',
          session_id: '',
          message: {
            role: 'user',
            content: inputPrompt,
          },
          parent_tool_use_id: null,
        } satisfies SDKUserMessage),
      ])
    } else {
      // Empty string - create empty stream
      inputStream = fromArray([])
    }
  } else {
    inputStream = inputPrompt
  }

  // Use RemoteIO if sdkUrl is provided, otherwise use regular StructuredIO
  return options.sdkUrl
    ? new RemoteIO(options.sdkUrl, inputStream, options.replayUserMessages)
    : new StructuredIO(inputStream, options.replayUserMessages)
}
