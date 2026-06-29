/**
 * Message lookup and merge helpers extracted from `utils/messages.ts`.
 *
 * Owns:
 * - getLastAssistantMessage: most-recent assistant message (REPL hot path).
 * - hasToolCallsInLastAssistantTurn: scan backwards for tool_use.
 * - mergeUserMessages / mergeAssistantMessages: combine adjacent same-role
 *   messages (used by history compaction / streaming).
 * - mergeUserMessagesAndToolResults: re-order tool results to the front of
 *   the merged message.
 * - hoistToolResults / normalizeUserTextContent: private helpers used by
 *   the merge functions.
 */
import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { AssistantMessage, Message, UserMessage } from '../types/message.js'

export function getLastAssistantMessage(
  messages: Message[],
): AssistantMessage | undefined {
  // findLast exits early from the end — much faster than filter + last for
  // large message arrays (called on every REPL render via useFeedbackSurvey).
  return messages.findLast(
    (msg): msg is AssistantMessage => msg.type === 'assistant',
  )
}

export function hasToolCallsInLastAssistantTurn(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && message.type === 'assistant') {
      const assistantMessage = message as AssistantMessage
      const content = assistantMessage.message.content
      if (Array.isArray(content)) {
        return content.some(block => block.type === 'tool_use')
      }
    }
  }
  return false
}

function hoistToolResults(content: ContentBlockParam[]): ContentBlockParam[] {
  const toolResults: ContentBlockParam[] = []
  const otherBlocks: ContentBlockParam[] = []

  for (const block of content) {
    if (block.type === 'tool_result') {
      toolResults.push(block)
    } else {
      otherBlocks.push(block)
    }
  }

  return [...toolResults, ...otherBlocks]
}

function normalizeUserTextContent(
  a: string | ContentBlockParam[],
): ContentBlockParam[] {
  if (typeof a === 'string') {
    return [{ type: 'text', text: a }]
  }
  return a
}
