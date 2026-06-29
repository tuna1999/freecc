/**
 * Print-mode helper utilities extracted from `cli/print.ts`.
 *
 * Owns:
 * - trackReceivedMessageUuid: dedup UUID tracker with bounded LRU eviction.
 * - PromptValue / toBlocks: prompt block normalisation helpers.
 * - joinPromptValues: merge multiple queued command values into one.
 * - canBatchWith: check whether two queued commands can share an ask() call.
 * - removeInterruptedMessage: splice out a user message + sentinel pair.
 *
 * Public API re-exported from `cli/print.ts` for backward compatibility.
 */
import type { UUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs'
import type { Message, NormalizedUserMessage } from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'

// Track message UUIDs received during the current session runtime
const MAX_RECEIVED_UUIDS = 10_000
const receivedMessageUuids = new Set<UUID>()
const receivedMessageUuidsOrder: UUID[] = []

export function trackReceivedMessageUuid(uuid: UUID): boolean {
  if (receivedMessageUuids.has(uuid)) {
    return false // duplicate
  }
  receivedMessageUuids.add(uuid)
  receivedMessageUuidsOrder.push(uuid)
  // Evict oldest entries when at capacity
  if (receivedMessageUuidsOrder.length > MAX_RECEIVED_UUIDS) {
    const toEvict = receivedMessageUuidsOrder.splice(
      0,
      receivedMessageUuidsOrder.length - MAX_RECEIVED_UUIDS,
    )
    for (const old of toEvict) {
      receivedMessageUuids.delete(old)
    }
  }
  return true // new UUID
}

export type PromptValue = string | ContentBlockParam[]

export function toBlocks(v: PromptValue): ContentBlockParam[] {
  return typeof v === 'string' ? [{ type: 'text', text: v }] : v
}

/**
 * Join prompt values from multiple queued commands into one. Strings are
 * newline-joined; if any value is a block array, all values are normalized
 * to blocks and concatenated.
 */
export function joinPromptValues(values: PromptValue[]): PromptValue {
  if (values.length === 1) return values[0]!
  if (values.every(v => typeof v === 'string')) {
    return values.join('\n')
  }
  return values.flatMap(toBlocks)
}

/**
 * Whether `next` can be batched into the same ask() call as `head`. Only
 * prompt-mode commands batch, and only when the workload tag matches (so the
 * combined turn is attributed correctly) and the isMeta flag matches (so a
 * proactive tick can't merge into a user prompt and lose its hidden-in-
 * transcript marking when the head is spread over the merged command).
 */
export function canBatchWith(
  head: QueuedCommand,
  next: QueuedCommand | undefined,
): boolean {
  return (
    next !== undefined &&
    next.mode === 'prompt' &&
    next.workload === head.workload &&
    next.isMeta === head.isMeta
  )
}

/**
 * Removes an interrupted user message and its synthetic assistant sentinel
 * from the message array. Used during gateway-triggered restarts to clean up
 * the message history before re-enqueuing the interrupted prompt.
 *
 * @internal Exported for testing
 */
export function removeInterruptedMessage(
  messages: Message[],
  interruptedUserMessage: NormalizedUserMessage,
): void {
  const idx = messages.findIndex(m => m.uuid === interruptedUserMessage.uuid)
  if (idx !== -1) {
    // Remove the user message and the sentinel that immediately follows it.
    // splice safely handles the case where idx is the last element.
    messages.splice(idx, 2)
  }
}