/**
 * Chat / CLI stream message types.
 *
 * Originally declared in a missing file — reconstructed from usage sites in
 * `src/components/Message.tsx`, `src/types/logs.ts`, `src/cli/print.ts`,
 * `src/services/tools/toolOrchestration.ts`, etc. These shapes are
 * intentionally broad (index signatures + a `type` discriminator) so
 * callers can pass through fields the type hasn't been taught about yet.
 */
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ImageBlockParam,
  TextBlockParam,
  ThinkingBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'

/** Raw message streamed from the SDK. */
export type Message = {
  type: string
  [key: string]: any
}

/** Block-based content for a user / assistant message. */
export type ContentBlock =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | BetaContentBlock

/** User-authored message (input). */
export type UserMessage = {
  type: 'user'
  uuid: string
  message: {
    role: 'user'
    content: string | ContentBlock[]
  }
  toolUseResult?: unknown
  isMeta?: boolean
  isVisibleInTranscriptOnly?: boolean
  [key: string]: any
}

/** Assistant (model) message. */
export type AssistantMessage = {
  type: 'assistant'
  uuid: string
  message: {
    role: 'assistant'
    content: ContentBlock[]
    model?: string
    stop_reason?: string | null
  }
  [key: string]: any
}

/** Attachment message (image, PDF, etc.). */
export type AttachmentMessage = {
  type: 'attachment'
  uuid: string
  attachment: {
    name: string
    contentType?: string
    data?: string
  }
  [key: string]: any
}

/** System message (init, status, hooks, etc.). */
export type SystemMessage = {
  type: 'system'
  uuid: string
  subtype?: string
  message?: { content?: unknown }
  [key: string]: any
}

/** In-progress / streaming message, parameterised by toolUseID. */
export type ProgressMessage<T = unknown> = {
  type: 'progress'
  uuid: string
  toolUseID: string
  message?: { content?: unknown }
  data?: T
  [key: string]: any
}

/** Multiple tool uses grouped together in the transcript view. */
export type GroupedToolUseMessage = {
  type: 'grouped_tool_use'
  uuid: string
  toolUses: Array<{
    id: string
    name: string
    input: unknown
    result?: unknown
  }>
  [key: string]: any
}

/** Collapsed read/search group in the transcript view. */
export type CollapsedReadSearchGroup = {
  type: 'collapsed_read_search'
  uuid: string
  entries: Array<{
    id: string
    toolName: string
    input: unknown
    result?: unknown
  }>
  [key: string]: any
}

/** Normalized user-message variant produced by the agent SDK. */
export type NormalizedUserMessage = UserMessage | AttachmentMessage

/** Anything that can be rendered as a single chat row. */
export type RenderableMessage =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | ProgressMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup

/** Local-only system command message (slash command execution, etc.). */
export type SystemLocalCommandMessage = {
  type: 'system_local_command'
  uuid: string
  command: string
  [key: string]: any
}