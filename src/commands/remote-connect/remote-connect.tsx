import chalk from 'chalk'
import * as React from 'react'
import { hostname } from 'node:os'
import { Select } from '../../components/CustomSelect/select.js'
import TextInput from '../../components/TextInput.js'
import { COMMON_HELP_ARGS } from '../../constants/xml.js'
import { Box, Text } from '../../ink.js'
import { RemoteClient } from '../../remote-server/client.js'
import {
  dispatchRemoteInput,
  getRemoteClient,
  setRemoteClient,
} from '../../remote-server/relay.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

type Phase =
  | { step: 'menu' }
  | { step: 'input-server' }
  | { step: 'input-key' }
  | { step: 'connecting' }
  | { step: 'pairing'; serverUrl: string; pairingId: string }
  | { step: 'error'; message: string }

function RemoteConnectUI({
  onDone,
  initialServer,
  initialKey,
}: {
  onDone: LocalJSXCommandOnDone
  initialServer?: string
  initialKey?: string
}): React.ReactNode {
  const cfg = getGlobalConfig()
  const savedServer = initialServer || (cfg as any).remoteServerUrl || ''
  const savedKey = initialKey || (cfg as any).remoteClientKey || ''

  const [phase, setPhase] = React.useState<Phase>(() => {
    if (getRemoteClient()?.isConnected()) return { step: 'menu' }
    if (savedServer && savedKey) return { step: 'menu' }
    return { step: 'input-server' }
  })
  const [serverUrl, setServerUrl] = React.useState(savedServer)
  const [clientKey, setClientKey] = React.useState(savedKey)

  const doConnect = React.useCallback(
    async (server: string, key: string) => {
      setPhase({ step: 'connecting' })
      try {
        const existing = getRemoteClient()
        if (existing) { await existing.close(); setRemoteClient(null) }

        const rc = new RemoteClient(
          { serverUrl: server, clientKey: key },
          {
            onUserMessage: (content) => { dispatchRemoteInput(content) },
            onConnectionChange: () => {},
            onError: () => {},
          },
        )
        const session = await rc.connect()
        saveGlobalConfig((current) => ({
          ...current,
          remoteServerUrl: server,
          remoteClientKey: key,
        }))
        setRemoteClient(rc)
        onDone(`Remote connected. Share this URL:\n${chalk.cyan(session.url)}`)
      } catch (err) {
        setPhase({ step: 'error', message: (err as Error).message })
      }
    },
    [onDone],
  )

  const doPair = React.useCallback(
    async (server: string) => {
      setPhase({ step: 'connecting' })
      try {
        const res = await fetch(`${server}/api/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostname: hostname() }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as any).error || `Server returned ${res.status}`)
        }
        const { pairingId } = (await res.json()) as { pairingId: string }
        setPhase({ step: 'pairing', serverUrl: server, pairingId })
      } catch (err) {
        setPhase({ step: 'error', message: (err as Error).message })
      }
    },
    [],
  )

  const doDisconnect = React.useCallback(async () => {
    const existing = getRemoteClient()
    if (existing) { await existing.close(); setRemoteClient(null) }
    onDone('Remote session disconnected', { display: 'system' })
  }, [onDone])

  // --- Render phases ---

  if (phase.step === 'input-server') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Remote Server URL</Text>
        <Text dimColor>Enter the URL of your remote relay server:</Text>
        <TextInput
          value={serverUrl}
          onChange={setServerUrl}
          onSubmit={(val: string) => {
            const trimmed = val.trim()
            if (!trimmed) { onDone('Cancelled', { display: 'system' }); return }
            setServerUrl(trimmed)
            // Ask: pair or enter key manually
            setPhase({ step: 'input-key' })
          }}
          placeholder="http://your-server:8081"
        />
      </Box>
    )
  }

  if (phase.step === 'input-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Authentication</Text>
        <Select
          options={[
            { value: 'pair', label: 'Request access', description: 'Send pairing request to server admin for approval' },
            { value: 'key', label: 'Enter client key', description: 'I already have a client key' },
          ]}
          onChange={(val) => {
            if (val === 'pair') {
              void doPair(serverUrl)
            } else {
              setClientKey('')
              setPhase({ step: 'menu' }) // reuse menu with key input
            }
          }}
          onCancel={() => setPhase({ step: 'input-server' })}
        />
      </Box>
    )
  }

  if (phase.step === 'pairing') {
    return (
      <PairingWait
        serverUrl={phase.serverUrl}
        pairingId={phase.pairingId}
        onApproved={(key) => {
          setClientKey(key)
          void doConnect(phase.serverUrl, key)
        }}
        onRejected={() => setPhase({ step: 'error', message: 'Pairing request was rejected by the server admin.' })}
        onCancel={() => onDone('Cancelled', { display: 'system' })}
      />
    )
  }

  if (phase.step === 'connecting') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>Connecting to {serverUrl}...</Text>
      </Box>
    )
  }

  if (phase.step === 'error') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red">Error: {phase.message}</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { value: 'retry', label: 'Retry' },
              { value: 'reconfigure', label: 'Change server' },
              { value: 'cancel', label: 'Cancel' },
            ]}
            onChange={(val) => {
              if (val === 'retry') {
                if (clientKey) void doConnect(serverUrl, clientKey)
                else void doPair(serverUrl)
              } else if (val === 'reconfigure') {
                setPhase({ step: 'input-server' })
              } else {
                onDone('Cancelled', { display: 'system' })
              }
            }}
          />
        </Box>
      </Box>
    )
  }

  // Menu phase
  const isConnected = getRemoteClient()?.isConnected()

  const options: Array<{ value: string; label: string; description?: string }> = []
  if (isConnected) {
    options.push({ value: 'disconnect', label: 'Disconnect', description: 'Close the current remote session' })
    options.push({ value: 'reconnect', label: 'Reconnect', description: `New session on ${savedServer}` })
  } else if (savedServer && savedKey) {
    options.push({ value: 'connect', label: 'Connect', description: `Connect to ${savedServer}` })
  }
  options.push(
    { value: 'new-server', label: 'Connect to new server', description: 'Enter server URL and pair or enter key' },
    { value: 'cancel', label: 'Cancel' },
  )

  // If we came from "Enter client key" option, show key input
  if (!savedKey && savedServer && !isConnected) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Client Key</Text>
        <Text dimColor>Enter your client key:</Text>
        <TextInput
          value={clientKey}
          onChange={setClientKey}
          onSubmit={(val: string) => {
            const trimmed = val.trim()
            if (!trimmed) { setPhase({ step: 'input-key' }); return }
            void doConnect(serverUrl, trimmed)
          }}
          placeholder="ck_..."
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Remote Connect</Text>
      <Text dimColor>
        Server: {savedServer || '(not configured)'}
        {isConnected ? chalk.green(' (connected)') : ''}
      </Text>
      <Box marginTop={1}>
        <Select
          options={options}
          onChange={(val) => {
            if (val === 'connect' || val === 'reconnect') void doConnect(savedServer, savedKey)
            else if (val === 'disconnect') void doDisconnect()
            else if (val === 'new-server') setPhase({ step: 'input-server' })
            else onDone('Cancelled', { display: 'system' })
          }}
          onCancel={() => onDone('Cancelled', { display: 'system' })}
        />
      </Box>
    </Box>
  )
}

/**
 * Polls the server for pairing approval.
 */
function PairingWait({
  serverUrl,
  pairingId,
  onApproved,
  onRejected,
  onCancel,
}: {
  serverUrl: string
  pairingId: string
  onApproved: (clientKey: string) => void
  onRejected: () => void
  onCancel: () => void
}): React.ReactNode {
  const [dots, setDots] = React.useState('')

  React.useEffect(() => {
    let cancelled = false

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${serverUrl}/api/pair/${pairingId}`)
          if (!res.ok) { onRejected(); return }
          const data = (await res.json()) as { status: string; clientKey?: string }
          if (data.status === 'approved' && data.clientKey) {
            onApproved(data.clientKey)
            return
          }
          if (data.status === 'rejected') {
            onRejected()
            return
          }
        } catch {
          // Network error, keep trying
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
    }

    void poll()

    const dotTimer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 500)

    return () => {
      cancelled = true
      clearInterval(dotTimer)
    }
  }, [serverUrl, pairingId, onApproved, onRejected])

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="yellow">Waiting for approval{dots}</Text>
      <Text>Pairing request sent to server admin.</Text>
      <Text dimColor>
        The admin will see your request at {serverUrl}/admin
      </Text>
      <Text dimColor>Press Ctrl+C to cancel.</Text>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || ''

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      [
        'Connect to a self-hosted remote relay server.',
        '',
        'Usage:',
        '  /remote-connect                          Interactive setup with pairing',
        '  /remote-connect --server <url> --key <key>  Direct connect with key',
        '',
        'First-time setup:',
        '  1. Enter the server URL',
        '  2. Choose "Request access" to send a pairing request',
        '  3. Wait for the server admin to approve',
        '  4. Connected! Your key is saved for next time.',
      ].join('\n'),
      { display: 'system' },
    )
    return
  }

  let serverUrl: string | undefined
  let clientKey: string | undefined
  const serverMatch = args.match(/--server\s+(\S+)/)
  const keyMatch = args.match(/--key\s+(\S+)/)
  if (serverMatch) serverUrl = serverMatch[1]
  if (keyMatch) clientKey = keyMatch[1]

  return (
    <RemoteConnectUI
      onDone={onDone}
      initialServer={serverUrl}
      initialKey={clientKey}
    />
  )
}
