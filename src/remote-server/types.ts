/**
 * Protocol types shared between the self-hosted remote server and CLI client.
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js'

/**
 * Minimal shape the relay needs from a local REPL message. We avoid coupling
 * to the (currently-missing) src/types/message.ts module so the relay can be
 * typed independently. The contract is:
 * - `type` is one of: user | assistant | system | tool_result | progress | attachment | hook_result
 * - `uuid` is optional and may be absent on synthetic messages
 * - `message.content` is the Anthropic-style content (string or ContentBlockParam[])
 * - meta flags (`isMeta`, `isVisibleInTranscriptOnly`, `isVirtual`) are honoured by the poller
 */
export interface RelayMessage {
  type?: string
  uuid?: string
  isMeta?: boolean
  isVisibleInTranscriptOnly?: boolean
  isVirtual?: boolean
  message?: {
    content?: string | ContentBlockParam[]
  }
  content?: string
}

/**
 * Mutable ref shape that REPL hands to the relay. Mirrors React.RefObject<Message[]>
 * but typed against our local RelayMessage.
 */
export interface RelayMessageRef {
  current: RelayMessage[]
}

export type RemoteMessageType =
  | 'message'
  | 'stream_start'
  | 'stream_delta'
  | 'stream_end'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'status'
  | 'interrupt'
  | 'permission_request'
  | 'permission_response'
  | 'prompt_request'
  | 'prompt_response'
  | 'system'
  | 'session_info'
  | 'history'
  | 'ping'
  | 'pong'

export interface RemoteMessage {
  type: RemoteMessageType
  role?: 'user' | 'assistant' | 'system' | 'tool'
  content?: string
  name?: string
  id?: string
  sessionId?: string
  status?: string
  processing?: boolean
  decision?: 'allow' | 'reject'
  detail?: string
  selected?: string
  options?: Array<{ key: string; label: string; description?: string }>
  cliConnected?: boolean
  webClients?: number
  messages?: RemoteMessage[]
  timestamp: number
}

export interface SessionCreateResponse {
  sessionId: string
  token: string
  url: string
  wsCliUrl: string
  wsWebUrl: string
}

export interface RemoteServerConfig {
  serverUrl: string
  clientKey: string
}
