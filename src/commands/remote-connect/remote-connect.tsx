import chalk from 'chalk'
import * as React from 'react'
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
    // If already connected, show disconnect option
    if (getRemoteClient()?.isConnected()) {
      return { step: 'menu' }
    }
    if (savedServer && savedKey) {
      return { step: 'menu' }
    }
    return { step: 'input-server' }
  })
  const [serverUrl, setServerUrl] = React.useState(savedServer)
  const [clientKey, setClientKey] = React.useState(savedKey)

  const doConnect = React.useCallback(
    async (server: string, key: string) => {
      setPhase({ step: 'connecting' })

      try {
        // Close existing client if any
        const existing = getRemoteClient()
        if (existing) {
          await existing.close()
          setRemoteClient(null)
        }

        const rc = new RemoteClient(
          { serverUrl: server, clientKey: key },
          {
            onUserMessage: (content) => {
              dispatchRemoteInput(content)
            },
            onConnectionChange: (_connected) => {},
            onError: (_err) => {},
          },
        )

        const session = await rc.connect()

        // Save config for next time
        saveGlobalConfig((current) => ({
          ...current,
          remoteServerUrl: server,
          remoteClientKey: key,
        }))

        // Register globally — the REPL hooks will pick it up
        setRemoteClient(rc)

        // Return control to REPL immediately with the session URL
        onDone(
          `Remote connected. Share this URL:\n${chalk.cyan(session.url)}`,
        )
      } catch (err) {
        setPhase({
          step: 'error',
          message: (err as Error).message,
        })
      }
    },
    [onDone],
  )

  const doDisconnect = React.useCallback(async () => {
    const existing = getRemoteClient()
    if (existing) {
      await existing.close()
      setRemoteClient(null)
    }
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
            if (!trimmed) {
              onDone('Cancelled', { display: 'system' })
              return
            }
            setServerUrl(trimmed)
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
        <Text bold>Client Key</Text>
        <Text dimColor>Enter your client key from the server:</Text>
        <TextInput
          value={clientKey}
          onChange={setClientKey}
          onSubmit={(val: string) => {
            const trimmed = val.trim()
            if (!trimmed) {
              setPhase({ step: 'input-server' })
              return
            }
            setClientKey(trimmed)
            void doConnect(serverUrl, trimmed)
          }}
          placeholder="ck_..."
        />
      </Box>
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
              { value: 'reconfigure', label: 'Change server/key' },
              { value: 'cancel', label: 'Cancel' },
            ]}
            onChange={(val) => {
              if (val === 'retry') {
                void doConnect(serverUrl, clientKey)
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
    options.push({
      value: 'disconnect',
      label: 'Disconnect',
      description: 'Close the current remote session',
    })
    options.push({
      value: 'reconnect',
      label: 'Reconnect',
      description: `New session on ${savedServer}`,
    })
  } else {
    options.push({
      value: 'connect',
      label: 'Connect',
      description: `Connect to ${savedServer}`,
    })
  }

  options.push(
    {
      value: 'reconfigure',
      label: 'Change server/key',
      description: 'Enter new server URL and client key',
    },
    { value: 'cancel', label: 'Cancel' },
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Remote Connect</Text>
      <Text dimColor>
        Server: {savedServer}
        {isConnected ? chalk.green(' (connected)') : ''}
      </Text>
      <Box marginTop={1}>
        <Select
          options={options}
          onChange={(val) => {
            if (val === 'connect' || val === 'reconnect') {
              void doConnect(savedServer, savedKey)
            } else if (val === 'disconnect') {
              void doDisconnect()
            } else if (val === 'reconfigure') {
              setPhase({ step: 'input-server' })
            } else {
              onDone('Cancelled', { display: 'system' })
            }
          }}
          onCancel={() => onDone('Cancelled', { display: 'system' })}
        />
      </Box>
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
        '  /remote-connect                          Interactive setup',
        '  /remote-connect --server <url> --key <key>  Direct connect',
        '',
        'The remote server relays messages between this CLI and a web browser.',
        'Run /remote-connect again to disconnect.',
      ].join('\n'),
      { display: 'system' },
    )
    return
  }

  // Parse --server and --key from args
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
