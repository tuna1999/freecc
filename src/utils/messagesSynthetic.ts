/**
 * Synthetic message detection helpers extracted from `utils/messages.ts`.
 *
 * Owns:
 * - Synthetic text constants (INTERRUPT, CANCEL, REJECT, NO_RESPONSE…)
 *   so consumers can detect them without stringly-typed checks.
 * - SYNTHETIC_MODEL: the placeholder model name used for non-LLM
 *   generated messages.
 * - SYNTHETIC_MESSAGES: set of the above placeholder texts.
 * - isSyntheticMessage: detect whether a message is a runtime-emitted
 *   synthetic.
 * - isSyntheticApiErrorMessage: detect synthetic API error messages.
 */
import type { AssistantMessage, Message } from '../types/message.js'

export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
export const CANCEL_MESSAGE = '[Request canceled]'
export const REJECT_MESSAGE = 'No, I will not do that.'
export const NO_RESPONSE_REQUESTED = 'No response requested.'

export const SYNTHETIC_MODEL = '<synthetic>'

export const SYNTHETIC_MESSAGES = new Set([
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  NO_RESPONSE_REQUESTED,
])

export function isSyntheticMessage(message: Message): boolean {
  return (
    message.type !== 'progress' &&
    message.type !== 'attachment' &&
    message.type !== 'system' &&
    Array.isArray(message.message.content) &&
    message.message.content[0]?.type === 'text' &&
    SYNTHETIC_MESSAGES.has(message.message.content[0].text)
  )
}

export function isSyntheticApiErrorMessage(
  message: Message,
): message is AssistantMessage & { isApiErrorMessage: true } {
  return (
    message.type === 'assistant' &&
    message.isApiErrorMessage === true &&
    message.message.model === SYNTHETIC_MODEL
  )
}
