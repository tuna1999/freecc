/**
 * Self-hosted remote server client transport.
 *
 * Connects to a remote relay server via WebSocket, creates a session,
 * and relays messages between the local REPL and remote web clients.
 */

import WebSocket from 'ws'
import type { RemoteMessage, RemoteServerConfig, SessionCreateResponse } from './types.js'
import { RemoteMessageSchema } from './schemas.js'

export type RemoteClientEvents = {
  /** Remote web user sent a message */
  onUserMessage: (content: string) => void
  /** Remote web user requested interrupt/stop */
  onInterrupt: () => void
  /** Remote web user responded to a permission request */
  onPermissionResponse: (decision: 'allow' | 'reject') => void
  /** Remote web user selected an option from a prompt */
  onPromptResponse: (selected: string) => void
  /** Session info updated */
  onSessionInfo: (info: { sessionId: string; webClients: number }) => void
  /** System notification from server */
  onSystem: (content: string) => void
  /** Connection state changed */
  onConnectionChange: (connected: boolean) => void
  /** Error occurred */
  onError: (error: Error) => void
}

export class RemoteClient {
  private ws: WebSocket | null = null
  private sessionInfo: SessionCreateResponse | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectAttempts = 0
  /** Maximum delay between reconnect attempts (ms). 30s is a good balance
   *  for localhost dev servers (which usually restart in seconds) without
   *  hammering a server that is down for an extended period. */
  private readonly RECONNECT_MAX_BACKOFF_MS = 30_000
  private readonly RECONNECT_BASE_BACKOFF_MS = 1_000

  constructor(
    private config: RemoteServerConfig,
    private events: Partial<RemoteClientEvents> = {},
  ) {}

  /**
   * Create a session on the remote server and connect via WebSocket.
   * @returns Session info including the shareable URL.
   */
  async connect(): Promise<SessionCreateResponse> {
    // Create session via HTTP
    const res = await fetch(`${this.config.serverUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': this.config.clientKey,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(
        `Failed to create session: ${res.status} ${(body as any).error || res.statusText}`,
      )
    }

    this.sessionInfo = (await res.json()) as SessionCreateResponse

    // Connect WebSocket
    this._connectWs()

    return this.sessionInfo
  }

  /**
   * Send a message to all connected web clients via the relay server.
   */
  send(message: RemoteMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    try {
      this.ws.send(JSON.stringify(message))
    } catch {
      // Ignore send errors on closed socket
    }
  }

  /**
   * Send an assistant text message.
   */
  sendAssistantMessage(content: string, id?: string): void {
    this.send({
      type: 'message',
      role: 'assistant',
      content,
      id: id || `cli_${Date.now()}`,
      timestamp: Date.now(),
    })
  }

  /**
   * Send a streaming start event.
   */
  sendStreamStart(id: string): void {
    this.send({ type: 'stream_start', id, timestamp: Date.now() })
  }

  /**
   * Send a streaming text delta.
   */
  sendStreamDelta(id: string, content: string): void {
    this.send({ type: 'stream_delta', id, content, timestamp: Date.now() })
  }

  /**
   * Send a streaming end event.
   */
  sendStreamEnd(id: string): void {
    this.send({ type: 'stream_end', id, timestamp: Date.now() })
  }

  /**
   * Send a tool use event.
   */
  sendToolUse(name: string, content: string, id?: string): void {
    this.send({
      type: 'tool_use',
      name,
      content,
      id: id || `tool_${Date.now()}`,
      timestamp: Date.now(),
    })
  }

  /**
   * Send a tool result event.
   */
  sendToolResult(content: string, id?: string): void {
    this.send({
      type: 'tool_result',
      content,
      id: id || `result_${Date.now()}`,
      timestamp: Date.now(),
    })
  }

  /**
   * Send a system message.
   */
  sendSystem(content: string): void {
    this.send({ type: 'system', content, timestamp: Date.now() })
  }

  /**
   * Get the shareable session URL.
   */
  getSessionUrl(): string | null {
    return this.sessionInfo?.url ?? null
  }

  /**
   * Get session ID.
   */
  getSessionId(): string | null {
    return this.sessionInfo?.sessionId ?? null
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Close the connection and clean up.
   */
  async close(): Promise<void> {
    this.closed = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'client closing')
      } catch {}
      this.ws = null
    }

    // Delete session on server
    if (this.sessionInfo) {
      try {
        await fetch(
          `${this.config.serverUrl}/api/sessions/${this.sessionInfo.sessionId}`,
          {
            method: 'DELETE',
            headers: { 'X-Client-Key': this.config.clientKey },
          },
        )
      } catch {}
      this.sessionInfo = null
    }
  }

  /** @private */
  private _connectWs(): void {
    if (!this.sessionInfo || this.closed) return

    const wsUrl = this.sessionInfo.wsCliUrl
    this.ws = new WebSocket(wsUrl)

    this.ws.on('open', () => {
      this.events.onConnectionChange?.(true)
      // Reset backoff after a successful connection — the next disconnect
      // (which hopefully will not happen) should start fresh.
      this.reconnectAttempts = 0

      // Ping every 30s to keep alive
      this.pingInterval = setInterval(() => {
        this.send({ type: 'ping', timestamp: Date.now() })
      }, 30000)
    })

    this.ws.on('message', (data) => {
      try {
        const raw = JSON.parse(data.toString())
        // Validate against the schema before dispatching into the local REPL
        // pipeline. A malformed or hostile message is dropped silently rather
        // than cast through 'as RemoteMessage' and forwarded to the input
        // listener (which would feed it back to Claude as if the user typed it).
        const parsed = RemoteMessageSchema.safeParse(raw)
        if (!parsed.success) {
          this.events.onError?.(new Error(
            `Invalid WebSocket message: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
          ))
          return
        }
        this._handleMessage(parsed.data as RemoteMessage)
      } catch {
        // Malformed JSON — ignore. The relay protocol is closed, so a stray
        // non-JSON frame is almost certainly a bug somewhere upstream.
      }
    })

    this.ws.on('close', () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval)
        this.pingInterval = null
      }

      this.events.onConnectionChange?.(false)

      // Auto-reconnect unless explicitly closed. Use exponential backoff
      // with jitter so a long-down server does not get hammered (the previous
      // 3s fixed delay fired 20 conn/min indefinitely).
      if (!this.closed) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        const exponential = this.RECONNECT_BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempts)
        const capped = Math.min(exponential, this.RECONNECT_MAX_BACKOFF_MS)
        // Full jitter: random value in [capped/2, capped]. This avoids
        // a thundering herd if many clients reconnect at once.
        const jittered = capped / 2 + Math.random() * (capped / 2)
        this.reconnectAttempts++
        this.reconnectTimer = setTimeout(() => this._connectWs(), jittered)
      }
    })

    this.ws.on('error', (err) => {
      this.events.onError?.(err)
    })
  }

  /** @private */
  private _handleMessage(msg: RemoteMessage): void {
    switch (msg.type) {
      case 'message':
        if (msg.role === 'user' && msg.content) {
          this.events.onUserMessage?.(msg.content)
        }
        break

      case 'session_info':
        this.events.onSessionInfo?.({
          sessionId: msg.sessionId!,
          webClients: msg.webClients ?? 0,
        })
        break

      case 'system':
        this.events.onSystem?.(msg.content ?? '')
        break

      case 'interrupt':
        this.events.onInterrupt?.()
        break

      case 'permission_response':
        if (msg.decision) {
          this.events.onPermissionResponse?.(msg.decision)
        }
        break

      case 'prompt_response':
        if (msg.selected) {
          this.events.onPromptResponse?.(msg.selected)
        }
        break

      case 'pong':
        // Server responded to ping
        break
    }
  }
}
