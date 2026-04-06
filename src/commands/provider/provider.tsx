import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Login } from '../../commands/login/login.js'
import { Select } from '../../components/CustomSelect/select.js'
import TextInput from '../../components/TextInput.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { Box, Link, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getCodexOAuthTokens, hasAnthropicApiKeyAuth } from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getAPIProvider, type APIProvider } from '../../utils/model/providers.js'

const PROVIDER_OPTIONS: Array<{
  value: APIProvider
  label: string
  description: string
  envVar: string
}> = [
  {
    value: 'firstParty',
    label: 'Anthropic (First-Party)',
    description: 'Direct Anthropic API',
    envVar: '',
  },
  {
    value: 'bedrock',
    label: 'AWS Bedrock',
    description: 'Amazon Bedrock',
    envVar: 'CLAUDE_CODE_USE_BEDROCK',
  },
  {
    value: 'vertex',
    label: 'Google Vertex AI',
    description: 'Google Cloud Vertex AI',
    envVar: 'CLAUDE_CODE_USE_VERTEX',
  },
  {
    value: 'foundry',
    label: 'Microsoft Foundry',
    description: 'Microsoft Azure Foundry',
    envVar: 'CLAUDE_CODE_USE_FOUNDRY',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    description: 'OpenAI-compatible API',
    envVar: 'CLAUDE_CODE_USE_OPENAI',
  },
]

const PROVIDER_ENV_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
]

function getProviderLabel(provider: APIProvider): string {
  return PROVIDER_OPTIONS.find(o => o.value === provider)?.label ?? provider
}

function applyProvider(provider: APIProvider): void {
  // Clear all provider env vars first
  for (const envVar of PROVIDER_ENV_VARS) {
    delete process.env[envVar]
  }

  // Set the selected provider's env var
  const option = PROVIDER_OPTIONS.find(o => o.value === provider)
  if (option && option.envVar) {
    process.env[option.envVar] = '1'
  }
}

/**
 * Check if credentials/config exist for a given provider.
 */
function hasProviderCredentials(provider: APIProvider): boolean {
  switch (provider) {
    case 'firstParty':
      return hasAnthropicApiKeyAuth() || !!process.env.ANTHROPIC_API_KEY
    case 'bedrock':
      return !!(
        process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_PROFILE ||
        process.env.AWS_SESSION_TOKEN
      )
    case 'vertex':
      return !!(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.CLOUD_ML_PROJECT_ID
      )
    case 'foundry':
      return !!(
        process.env.FOUNDRY_API_KEY ||
        process.env.AZURE_API_KEY
      )
    case 'openai':
      return !!getCodexOAuthTokens()?.accessToken || !!getGlobalConfig().openaiApiKey
  }
}

type PickerAction = APIProvider | 'login'

const PROVIDER_DOCS: Record<string, { url: string; envHint: string }> = {
  bedrock: {
    url: 'https://code.claude.com/docs/en/amazon-bedrock',
    envHint: 'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION',
  },
  vertex: {
    url: 'https://code.claude.com/docs/en/google-vertex-ai',
    envHint:
      'Set GOOGLE_APPLICATION_CREDENTIALS and CLOUD_ML_PROJECT_ID',
  },
  foundry: {
    url: 'https://code.claude.com/docs/en/microsoft-foundry',
    envHint: 'Set FOUNDRY_API_KEY or AZURE_API_KEY',
  },
}

/**
 * 3P platform setup info screen, shown when credentials are missing.
 */
function PlatformSetupInfo({
  provider,
  onDone,
  onBack,
}: {
  provider: APIProvider
  onDone: LocalJSXCommandOnDone
  onBack: () => void
}): React.ReactNode {
  const info = PROVIDER_DOCS[provider]

  const handleSelect = React.useCallback(
    (value: string) => {
      if (value === 'switch') {
        applyProvider(provider)
        onDone(
          `Switched provider to ${chalk.bold(getProviderLabel(provider))}. Set the required environment variables, then restart Claude Code.`,
        )
      } else {
        onBack()
      }
    },
    [provider, onDone, onBack],
  )

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Text bold>
        Setup required for {getProviderLabel(provider)}
      </Text>
      <Text>
        No credentials detected for this provider. Set the required
        environment variables, then restart Claude Code.
      </Text>
      {info && (
        <>
          <Text>{info.envHint}</Text>
          <Text>
            Documentation:{' '}
            <Link url={info.url}>{info.url}</Link>
          </Text>
        </>
      )}
      <Box marginTop={1}>
        <Select
          options={[
            { value: 'switch', label: 'Switch anyway', description: 'Set provider now, configure credentials later' },
            { value: 'back', label: 'Go back', description: 'Return to provider list' },
          ]}
          onChange={handleSelect}
          onCancel={onBack}
        />
      </Box>
    </Box>
  )
}

/**
 * OAuth login flow, wrapping the existing Login component.
 * The Login component handles both Anthropic OAuth and OpenAI Codex OAuth.
 */
function OAuthLoginFlow({
  onDone,
  context,
  onBack,
  targetProvider,
}: {
  onDone: LocalJSXCommandOnDone
  context: LocalJSXCommandContext
  onBack: () => void
  targetProvider?: APIProvider
}): React.ReactNode {
  return (
    <Login
      onDone={(success: boolean) => {
        if (success) {
          context.onChangeAPIKey()
          if (targetProvider) {
            applyProvider(targetProvider)
          }
          const label = targetProvider
            ? getProviderLabel(targetProvider)
            : 'your selected provider'
          onDone(`Login successful. Provider set to ${label}.`)
        } else {
          onBack()
        }
      }}
      startingMessage="Sign in to configure your account for this provider."
    />
  )
}

/**
 * API key input form for OpenAI provider.
 */
function OpenAIApiKeySetup({
  onDone,
  onBack,
}: {
  onDone: LocalJSXCommandOnDone
  onBack: () => void
}): React.ReactNode {
  const cfg = getGlobalConfig()
  const [step, setStep] = React.useState<'api-key' | 'base-url'>('api-key')
  const [apiKey, setApiKey] = React.useState(cfg.openaiApiKey ?? '')
  const [baseUrl, setBaseUrl] = React.useState(cfg.openaiBaseUrl ?? '')

  useKeybinding('confirm:no', onBack, {
    context: 'Cancel',
    isActive: true,
  })

  if (step === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>OpenAI API Key</Text>
        <Text dimColor>Enter your OpenAI API key (sk-...):</Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          onSubmit={(value: string) => {
            if (!value.trim()) {
              onBack()
              return
            }
            setApiKey(value.trim())
            setStep('base-url')
          }}
          placeholder="sk-..."
        />
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    )
  }

  // base-url step
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>OpenAI Base URL</Text>
      <Text dimColor>
        Enter base URL (leave empty for default https://api.openai.com/v1):
      </Text>
      <TextInput
        value={baseUrl}
        onChange={setBaseUrl}
        onSubmit={(value: string) => {
          const trimmedUrl = value.trim()
          saveGlobalConfig(current => ({
            ...current,
            openaiApiKey: apiKey,
            openaiBaseUrl: trimmedUrl || undefined,
          }))
          applyProvider('openai')
          const urlMsg = trimmedUrl
            ? ` with base URL ${chalk.dim(trimmedUrl)}`
            : ''
          onDone(
            `Switched provider to ${chalk.bold(getProviderLabel('openai'))} using API key${urlMsg}`,
          )
        }}
        placeholder="https://api.openai.com/v1"
      />
      <Text dimColor>Press Esc to go back</Text>
    </Box>
  )
}

/**
 * Sub-menu for OpenAI: use existing, login with OAuth, or use API key.
 */
function OpenAIOptionsMenu({
  onDone,
  context,
  onBack,
  isCurrent,
  hasExisting,
}: {
  onDone: LocalJSXCommandOnDone
  context: LocalJSXCommandContext
  onBack: () => void
  isCurrent: boolean
  hasExisting: boolean
}): React.ReactNode {
  const [subPhase, setSubPhase] = React.useState<'menu' | 'oauth' | 'apikey'>('menu')

  if (subPhase === 'oauth') {
    return (
      <OAuthLoginFlow
        onDone={onDone}
        context={context}
        onBack={() => setSubPhase('menu')}
        targetProvider="openai"
      />
    )
  }

  if (subPhase === 'apikey') {
    return (
      <OpenAIApiKeySetup
        onDone={onDone}
        onBack={() => setSubPhase('menu')}
      />
    )
  }

  const options: Array<{
    value: string
    label: string
    description: string
  }> = []

  if (hasExisting) {
    options.push({
      value: 'use-existing',
      label: isCurrent ? 'Keep current account' : 'Use existing account',
      description: 'Continue with the currently configured OpenAI credentials',
    })
  }

  options.push(
    {
      value: 'oauth',
      label: 'Login with OpenAI OAuth',
      description: 'Sign in with your ChatGPT Plus/Pro subscription',
    },
    {
      value: 'apikey',
      label: 'Use API key',
      description: 'Enter an OpenAI API key and optional base URL',
    },
  )

  const handleSelect = React.useCallback(
    (value: string) => {
      if (value === 'use-existing') {
        if (isCurrent) {
          onDone(
            `Provider is already ${chalk.bold(getProviderLabel('openai'))}`,
            { display: 'system' },
          )
        } else {
          applyProvider('openai')
          onDone(
            `Switched provider to ${chalk.bold(getProviderLabel('openai'))}`,
          )
        }
      } else if (value === 'oauth') {
        setSubPhase('oauth')
      } else if (value === 'apikey') {
        setSubPhase('apikey')
      }
    },
    [isCurrent, onDone],
  )

  return (
    <Box flexDirection="column">
      <Text bold>OpenAI Provider</Text>
      <Text dimColor>Choose how to authenticate with OpenAI:</Text>
      <Box marginTop={1}>
        <Select
          options={options}
          onChange={handleSelect}
          onCancel={onBack}
        />
      </Box>
    </Box>
  )
}

type PickerState =
  | { phase: 'pick' }
  | { phase: 'login'; targetProvider?: APIProvider }
  | { phase: 'platform-setup'; provider: APIProvider }
  | { phase: 'openai-options' }

function ProviderPickerWrapper({
  onDone,
  context,
}: {
  onDone: LocalJSXCommandOnDone
  context: LocalJSXCommandContext
}): React.ReactNode {
  const currentProvider = getAPIProvider()
  const [state, setState] = React.useState<PickerState>({ phase: 'pick' })

  const handleCancel = React.useCallback(() => {
    onDone(
      `Kept provider as ${chalk.bold(getProviderLabel(currentProvider))}`,
      { display: 'system' },
    )
  }, [currentProvider, onDone])

  const handleSelect = React.useCallback(
    (value: PickerAction) => {
      // "Login / Add new account" option
      if (value === 'login') {
        setState({ phase: 'login', targetProvider: undefined })
        return
      }

      const provider = value as APIProvider

      // OpenAI always shows options sub-menu
      if (provider === 'openai') {
        setState({ phase: 'openai-options' })
        return
      }

      // Same provider, no change needed
      if (provider === currentProvider) {
        onDone(
          `Provider is already ${chalk.bold(getProviderLabel(provider))}`,
          { display: 'system' },
        )
        return
      }

      // Check if credentials exist for the target provider
      if (!hasProviderCredentials(provider)) {
        if (provider === 'firstParty') {
          // For first-party, launch OAuth login flow
          setState({ phase: 'login', targetProvider: provider })
        } else {
          // For 3P providers (bedrock/vertex/foundry), show setup info
          setState({ phase: 'platform-setup', provider })
        }
        return
      }

      // Credentials exist, just switch
      applyProvider(provider)
      onDone(
        `Switched provider to ${chalk.bold(getProviderLabel(provider))}`,
      )
    },
    [currentProvider, onDone],
  )

  const handleBack = React.useCallback(() => {
    setState({ phase: 'pick' })
  }, [])

  if (state.phase === 'openai-options') {
    return (
      <OpenAIOptionsMenu
        onDone={onDone}
        context={context}
        onBack={handleBack}
        isCurrent={currentProvider === 'openai'}
        hasExisting={hasProviderCredentials('openai')}
      />
    )
  }

  if (state.phase === 'login') {
    return (
      <OAuthLoginFlow
        onDone={onDone}
        context={context}
        onBack={handleBack}
        targetProvider={state.targetProvider}
      />
    )
  }

  if (state.phase === 'platform-setup') {
    return (
      <PlatformSetupInfo
        provider={state.provider}
        onDone={onDone}
        onBack={handleBack}
      />
    )
  }

  const options: Array<{
    value: PickerAction
    label: React.ReactNode
    description?: string
  }> = PROVIDER_OPTIONS.map(opt => ({
    value: opt.value,
    label:
      opt.value === currentProvider
        ? `${opt.label} (current)`
        : opt.label,
    description: opt.description,
  }))

  // Add "Login / Add new account" option
  options.push({
    value: 'login',
    label: 'Login / Add new account',
    description: 'Sign in with Anthropic OAuth',
  })

  return (
    <Box flexDirection="column">
      <Text bold>Select API provider</Text>
      <Text dimColor>
        Current provider: {getProviderLabel(currentProvider)}
      </Text>
      <Box marginTop={1}>
        <Select
          options={options}
          defaultValue={currentProvider}
          onChange={handleSelect}
          onCancel={handleCancel}
        />
      </Box>
    </Box>
  )
}

function SetProviderAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const currentProvider = getAPIProvider()

  React.useEffect(() => {
    const normalized = args.toLowerCase().trim()

    // Find matching provider
    const match = PROVIDER_OPTIONS.find(
      opt =>
        opt.value === normalized ||
        opt.label.toLowerCase() === normalized ||
        opt.label.toLowerCase().includes(normalized),
    )

    if (!match) {
      const available = PROVIDER_OPTIONS.map(o => o.value).join(', ')
      onDone(
        `Unknown provider '${args}'. Available providers: ${available}`,
        { display: 'system' },
      )
      return
    }

    if (match.value === currentProvider) {
      onDone(
        `Provider is already ${chalk.bold(getProviderLabel(match.value))}`,
        { display: 'system' },
      )
      return
    }

    applyProvider(match.value)
    onDone(
      `Switched provider to ${chalk.bold(getProviderLabel(match.value))}`,
    )
  }, [args, currentProvider, onDone])

  return null
}

function ShowProviderAndClose({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const currentProvider = getAPIProvider()

  React.useEffect(() => {
    onDone(
      `Current provider: ${chalk.bold(getProviderLabel(currentProvider))}`,
      { display: 'system' },
    )
  }, [currentProvider, onDone])

  return null
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  args = args?.trim() || ''

  if (COMMON_INFO_ARGS.includes(args)) {
    return <ShowProviderAndClose onDone={onDone} />
  }

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Run /provider to open the provider selection menu, or /provider [name] to set the provider directly.\nAvailable providers: firstParty, bedrock, vertex, foundry, openai',
      { display: 'system' },
    )
    return
  }

  if (args) {
    return <SetProviderAndClose args={args} onDone={onDone} />
  }

  return <ProviderPickerWrapper onDone={onDone} context={context} />
}
