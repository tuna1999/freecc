/**
 * Protocol types shared between the self-hosted remote server and CLI client.
 */

export type RemoteMessageType =
  | 'message'
  | 'stream_start'
  | 'stream_delta'
  | 'stream_end'
  | 'tool_use'
  | 'tool_result'
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
