/**
 * Global singleton for the remote relay client.
 * Part of the remote-relay builtin plugin.
 */

import type { RemoteClient } from './client.js'
import { getBuiltinPlugins } from '../plugins/builtinPlugins.js'

type RemoteInputListener = (input: string) => void
type MessagesRef = { current: any[] }

let activeClient: RemoteClient | null = null
let inputListener: RemoteInputListener | null = null
let registeredMessagesRef: MessagesRef | null = null
let pollingInterval: ReturnType<typeof setInterval> | null = null
let lastLen = 0
let lastText = ''

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

// Track messages that came from the web so we don't echo them back
let lastWebInput = ''

export function dispatchRemoteInput(content: string): void {
  lastWebInput = content
  inputListener?.(content)
}

/**
 * Called from REPL on every render to register the messages ref.
 */
export function forwardMessagesToRemote(messagesRef: MessagesRef): void {
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
        // Use stream events for live text
        if (lastText.length === 0) {
          activeClient.sendStreamStart(id)
        }
        activeClient.sendStreamDelta(id, delta)
      }
      lastText = currentLastText
      return
    }

    // Shrunk (compact/clear)
    if (currentLen < lastLen) {
      lastLen = currentLen
      lastText = currentLastText
    }
  }, 80)
}

function sendMessage(msg: any): void {
  if (!activeClient || !msg) return

  // Skip internal/meta messages
  if (msg.isMeta || msg.isVisibleInTranscriptOnly || msg.isVirtual) return

  const msgType = msg.type || 'unknown'
  if (['system', 'progress', 'attachment', 'hook_result'].includes(msgType)) return

  const text = getMessageText(msg)

  // Skip messages with XML command tags
  if (text.includes('<command-name>') || text.includes('<local-command') || text.includes('<bash-')) return

  if (msgType === 'assistant') {
    // End any active stream before sending a complete message
    if (lastText.length > 0) {
      activeClient.sendStreamEnd(msg.uuid || 'stream')
    }
    if (text) {
      activeClient.sendAssistantMessage(text, msg.uuid)
    }
    // Tool use blocks
    const blocks = msg.message?.content
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block && block.type === 'tool_use') {
          if (block.name === 'ToolSearch') continue
          const input = block.input || {}
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
    }
    // Clear the marker after checking
    if (text === lastWebInput) lastWebInput = ''
  } else if (msgType === 'tool_result') {
    // Skip — assistant summarizes
  }
}

function formatToolDisplay(name: string, input: any): { label: string; args: string } {
  if (!name) return { label: 'Tool', args: '' }

  function fmtArgs(obj: any, keys?: string[]): string {
    const entries = keys
      ? keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]])
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
    case 'Bash': return { label: 'Bash', args: input.command ? `(${input.command.slice(0, 80)}${input.command.length > 80 ? '...' : ''})` : '' }
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

function getMessageText(msg: any): string {
  if (!msg) return ''
  const content = msg.message?.content ?? msg.content
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
