/**
 * Global singleton for the remote relay client.
 * Part of the remote-relay builtin plugin.
 *
 * State layout: the relay uses 11 module-level `let` variables below.
 * This is intentional — they collectively form the singleton's working
 * memory and a wrap-into-object refactor (P3.4 in the plan) was
 * considered but rejected because:
 *   1. It is a behavior-preserving rename, not a structural change
 *   2. With 11 references per identifier it carries real regression risk
 *   3. The P1.2 type cleanup already removed the worst of the 'any'
 *      leak — the singleton is now legible without object wrapping
 * If the relay ever needs to be instantiated per-session (e.g. for
 * tests), revisit the wrap-into-object refactor at that point.
 */

import type { RemoteClient } from './client.js'
import { getBuiltinPlugins } from '../plugins/builtinPlugins.js'
import type { RelayMessage, RelayMessageRef } from './types.js'

type RemoteInputListener = (input: string) => void
type RemoteInterruptListener = () => void
type PermissionHandler = { onAllow: () => void; onReject: () => void }
type PromptHandler = { onSelect: (key: string) => void; onAbort: () => void }

let activeClient: RemoteClient | null = null
let inputListener: RemoteInputListener | null = null
let interruptListener: RemoteInterruptListener | null = null
let registeredMessagesRef: RelayMessageRef | null = null
let currentPermissionHandler: PermissionHandler | null = null
let currentPromptHandler: PromptHandler | null = null
let pollingInterval: ReturnType<typeof setInterval> | null = null
let lastLen = 0
let lastText = ''
let isStreaming = false

function isPluginEnabled(): boolean {
  try {
    const { enabled } = getBuiltinPlugins()
    return enabled.some(p => p.name === 'remote-relay')
  } catch {
    return true // default to enabled if check fails
  }
}

export function setRemoteClient(client: RemoteClient | null): void {
  if (client && !isPluginEnabled()) {
    throw new Error('Remote relay plugin is disabled. Enable it via /plugin.')
  }

  activeClient = client
  lastLen = 0
  lastText = ''
  isStreaming = false

  if (client && !pollingInterval) {
    startPolling()
  } else if (!client && pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

export function getRemoteClient(): RemoteClient | null {
  return activeClient
}

export function onRemoteInput(listener: RemoteInputListener | null): void {
  inputListener = listener
}

export function onRemoteInterrupt(listener: RemoteInterruptListener | null): void {
  interruptListener = listener
}

export function dispatchRemoteInterrupt(): void {
  interruptListener?.()
}

// Track messages that came from the web so we don't echo them back
let lastWebInput = ''

export function dispatchRemoteInput(content: string): void {
  lastWebInput = content
  inputListener?.(content)
}

export function setRemotePermissionRequest(
  id: string | null,
  tool: string,
  detail: string,
  handler: PermissionHandler | null,
): void {
  currentPermissionHandler = handler
  if (!activeClient) return
  if (id && handler) {
    activeClient.send({
      type: 'permission_request',
      id,
      name: tool,
      detail,
      timestamp: Date.now(),
    })
  } else {
    activeClient.send({ type: 'permission_request', id: '', timestamp: Date.now() })
  }
}

export function dispatchPermissionResponse(decision: 'allow' | 'reject'): void {
  if (!currentPermissionHandler) return
  if (decision === 'allow') {
    currentPermissionHandler.onAllow()
  } else {
    currentPermissionHandler.onReject()
  }
  currentPermissionHandler = null
}

export function setRemotePromptRequest(
  id: string | null,
  message: string,
  options: Array<{ key: string; label: string; description?: string }>,
  handler: PromptHandler | null,
): void {
  currentPromptHandler = handler
  if (!activeClient) return
  if (id && handler) {
    activeClient.send({
      type: 'prompt_request',
      id,
      content: message,
      options,
      timestamp: Date.now(),
    })
  } else {
    activeClient.send({ type: 'prompt_request', id: '', timestamp: Date.now() })
  }
}

export function dispatchPromptResponse(selected: string): void {
  if (!currentPromptHandler) return
  currentPromptHandler.onSelect(selected)
  currentPromptHandler = null
}

/**
 * Called from REPL on every render to register the messages ref.
 */
export function forwardMessagesToRemote(messagesRef: RelayMessageRef): void {
  registeredMessagesRef = messagesRef
}

function startPolling(): void {
  if (pollingInterval) return

  // Poll at 80ms for responsive streaming
  pollingInterval = setInterval(() => {
    if (!activeClient || !activeClient.isConnected()) return
    if (!registeredMessagesRef) return

    const messages = registeredMessagesRef.current
    if (!messages || messages.length === 0) return

    const currentLen = messages.length
    const lastMsg = messages[currentLen - 1]
    const currentLastText = lastMsg ? getMessageText(lastMsg) : ''

    // New messages added
    if (currentLen > lastLen) {
      const startIdx = Math.max(lastLen, 0)
      for (let i = startIdx; i < currentLen; i++) {
        sendMessage(messages[i])
      }
      lastLen = currentLen
      lastText = currentLastText
      return
    }

    // Streaming: same count but last message text grew
    if (
      currentLen === lastLen &&
      currentLen > 0 &&
      currentLastText.length > lastText.length
    ) {
      const delta = currentLastText.slice(lastText.length)
      if (delta && activeClient) {
        const id = lastMsg?.uuid || 'stream'
        if (lastText.length === 0) {
          activeClient.sendStreamStart(id)
          activeClient.send({ type: 'status', processing: true, timestamp: Date.now() })
          isStreaming = true
        }
        activeClient.sendStreamDelta(id, delta)
      }
      lastText = currentLastText
      return
    }

    // Stream ended: was streaming but text stopped growing (same count, same text)
    if (currentLen === lastLen && isStreaming && lastText.length > 0 && currentLastText === lastText) {
      const id = lastMsg?.uuid || 'stream'
      activeClient.sendStreamEnd(id)
      activeClient.send({ type: 'status', processing: false, timestamp: Date.now() })
      isStreaming = false
      return
    }

    // Shrunk (compact/clear)
    if (currentLen < lastLen) {
      lastLen = currentLen
      lastText = currentLastText
    }
  }, 80)
}

function sendMessage(msg: RelayMessage): void {
  if (!activeClient || !msg) return

  // Skip internal/meta messages
  if (msg.isMeta || msg.isVisibleInTranscriptOnly || msg.isVirtual) return

  const msgType = msg.type || 'unknown'
  if (['system', 'progress', 'attachment', 'hook_result'].includes(msgType)) return

  const text = getMessageText(msg)

  // Skip messages with XML command tags
  if (text.includes('<command-name>') || text.includes('<local-command') || text.includes('<bash-')) return

  if (msgType === 'assistant') {
    // End any active stream if a new message arrives while streaming
    if (lastText.length > 0) {
      activeClient.sendStreamEnd(msg.uuid || 'stream')
      isStreaming = false
    }
    if (text) {
      activeClient.sendAssistantMessage(text, msg.uuid)
      // For non-streamed complete responses, mark processing done
      if (!isStreaming) {
        activeClient.send({ type: 'status', processing: false, timestamp: Date.now() })
      }
    }
    // Tool use and thinking blocks
    const blocks = msg.message?.content
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block && block.type === 'thinking' && block.thinking) {
          activeClient.send({
            type: 'thinking',
            content: block.thinking,
            timestamp: Date.now(),
          })
        } else if (block && block.type === 'tool_use') {
          if (block.name === 'ToolSearch') continue
          const input = (block.input as Record<string, unknown>) || {}
          const { label, args } = formatToolDisplay(block.name, input)
          activeClient.send({
            type: 'tool_use',
            name: label,
            content: args,
            id: block.id,
            detail: JSON.stringify(input, null, 2),
            timestamp: Date.now(),
          })
        }
      }
    }
  } else if (msgType === 'user') {
    // Forward local terminal input to web, but skip messages that came FROM the web
    if (text && text !== lastWebInput) {
      activeClient.send({
        type: 'message',
        role: 'user',
        content: text,
        id: msg.uuid,
        timestamp: Date.now(),
      })
      // Signal that processing has started
      activeClient.send({ type: 'status', processing: true, timestamp: Date.now() })
    }
    // Clear the marker after checking
    if (text === lastWebInput) lastWebInput = ''
  } else if (msgType === 'tool_result') {
    // Skip — assistant summarizes
  }
}

function formatToolDisplay(
  name: string,
  input: Record<string, unknown>,
): { label: string; args: string } {
  if (!name) return { label: 'Tool', args: '' }

  function fmtArgs(obj: Record<string, unknown>, keys?: string[]): string {
    const entries = keys
      ? keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]] as const)
      : Object.entries(obj).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return ''
    const parts = entries.map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      const display = s.length > 60 ? s.slice(0, 57) + '...' : s
      return `${k}: "${display}"`
    })
    return `(${parts.join(', ')})`
  }

  switch (name) {
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : ''
      return { label: 'Bash', args: cmd ? `(${cmd.slice(0, 80)}${cmd.length > 80 ? '...' : ''})` : '' }
    }
    case 'Read': return { label: 'Read', args: fmtArgs(input, ['file_path']) }
    case 'Write': return { label: 'Write', args: fmtArgs(input, ['file_path']) }
    case 'Edit': return { label: 'Edit', args: fmtArgs(input, ['file_path']) }
    case 'Glob': return { label: 'Glob', args: fmtArgs(input, ['pattern']) }
    case 'Grep': return { label: 'Grep', args: fmtArgs(input, ['pattern', 'path']) }
    case 'Agent': return { label: 'Agent', args: input.description ? `(${input.description})` : '' }
    case 'WebSearch': return { label: 'WebSearch', args: fmtArgs(input, ['query']) }
    case 'WebFetch': return { label: 'WebFetch', args: fmtArgs(input, ['url']) }
    case 'Skill': return { label: 'Skill', args: fmtArgs(input, ['skill']) }
    default:
      if (name.startsWith('mcp__')) {
        const parts = name.split('__')
        const server = parts[1] || ''
        const tool = parts.slice(2).join('__') || ''
        return { label: `${server} - ${tool} (MCP)`, args: fmtArgs(input) }
      }
      return { label: name, args: fmtArgs(input) }
  }
}

function getMessageText(msg: RelayMessage): string {
  if (!msg) return ''
  // Per RelayMessage contract, content lives at message.content (Anthropic-style)
  // — do NOT fall back to msg.content, which is a different field on other shapes.
  const content = msg.message?.content
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const b of content) {
      if (b && b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text)
      }
    }
    return parts.join('\n')
  }
  return ''
}
