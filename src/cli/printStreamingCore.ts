/**
 * Streaming-mode core helpers extracted from `cli/printHeadless.ts`.
 *
 * Owns streaming-loop helpers that don't fit cleanly into printStreamingMcp
 * or printStreamingPlugins. Currently:
 * - forwardMessagesToBridge: forward new user/assistant messages to the
 *   bridge transport (if any).
 * - injectModelSwitchBreadcrumbs: insert synthetic user messages when
 *   the main-loop model switches mid-session.
 */
import { randomUUID } from 'crypto'
import { createModelSwitchBreadcrumbs } from '../utils/model/modelSwitch.js'
import { modelDisplayString } from '../utils/model/modelDisplay.js'
import { LOCAL_COMMAND_STDOUT_TAG } from '../constants/xml.js'
import { getSessionId } from '../bootstrap/state.js'
import type { Message } from '../types/message.js'
import type { ReplBridgeHandle } from '../bridge/replBridge.js'
import type { Stream } from '../utils/stream.js'
import type { StdoutMessage, SDKUserMessageReplay } from '../entrypoints/sdk/controlTypes.js'

export function forwardMessagesToBridge(
  bridgeHandle: ReplBridgeHandle | undefined,
  bridgeLastForwardedIndex: { value: number },
  mutableMessages: Message[],
): void {
  if (!bridgeHandle) return
  // Guard against mutableMessages shrinking (compaction truncates it).
  const startIndex = Math.min(bridgeLastForwardedIndex.value, mutableMessages.length)
  const newMessages = mutableMessages
    .slice(startIndex)
    .filter(m => m.type === 'user' || m.type === 'assistant')
  bridgeLastForwardedIndex.value = mutableMessages.length
  if (newMessages.length > 0) {
    bridgeHandle.writeMessages(newMessages)
  }
}

export function injectModelSwitchBreadcrumbs(
  modelArg: string,
  resolvedModel: string,
  mutableMessages: Message[],
  output: Stream<StdoutMessage>,
): void {
  const breadcrumbs = createModelSwitchBreadcrumbs(
    modelArg,
    modelDisplayString(resolvedModel),
  )
  mutableMessages.push(...breadcrumbs)
  for (const crumb of breadcrumbs) {
    if (
      typeof crumb.message.content === 'string' &&
      crumb.message.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`)
    ) {
      output.enqueue({
        type: 'user',
        message: crumb.message,
        session_id: getSessionId(),
        parent_tool_use_id: null,
        uuid: crumb.uuid,
        timestamp: crumb.timestamp,
        isReplay: true,
      } satisfies SDKUserMessageReplay)
    }
  }
}
