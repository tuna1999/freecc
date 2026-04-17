import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Login } from '../../commands/login/login.js'
import { Select } from '../../components/CustomSelect/select.js'
import { Spinner } from '../../components/Spinner.js'
import TextInput from '../../components/TextInput.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { Box, Link, Text, useInput } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getCodexOAuthTokens, hasAnthropicApiKeyAuth } from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { OPENROUTER_DEFAULT_BASE_URL } from '../../services/api/chat-completions-adapter.js'
import { getAPIProvider, type APIProvider } from '../../utils/model/providers.js'
import { setMainLoopModelOverride } from '../../bootstrap/state.js'
import { useSetAppState } from '../../state/AppState.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

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
  {
    value: 'openrouter',
    label: 'OpenRouter',
    description: 'Access 200+ models via OpenRouter',
    envVar: 'CLAUDE_CODE_USE_OPENROUTER',
  },
  {
    value: 'anthropicCompat',
    label: 'Anthropic-Compatible API',
    description: 'Custom endpoint with Anthropic API format',
    envVar: 'CLAUDE_CODE_USE_ANTHROPIC_COMPAT',
  },
]

const PROVIDER_ENV_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_OPENROUTER',
  'CLAUDE_CODE_USE_ANTHROPIC_COMPAT',
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

  // Clear stale model from settings — the old provider's model won't work
  // with the new provider. The new provider's default will be used instead.
  updateSettingsForSource('userSettings', { model: undefined })

  // Clear the in-memory model override so model resolution falls through
  // to the new provider's default instead of reusing the old provider's model.
  setMainLoopModelOverride(undefined)

  // Persist the choice so it survives restarts
  saveGlobalConfig((current) => ({
    ...current,
    apiProvider: provider,
  }))
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
    case 'openrouter':
      return !!getGlobalConfig().openrouterApiKey
    case 'anthropicCompat': {
      const cfg = getGlobalConfig()
      return !!cfg.anthropicCompatApiKey && !!cfg.anthropicCompatBaseUrl
    }
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
 * Mirrors ThirdPartyApiKeySetup in ConsoleOAuthFlow.tsx:
 * base-url → api-key → fetch models → model-select (or skip if fetch fails).
 */
function OpenAIApiKeySetup({
  onDone,
  onBack,
  onChangeAPIKey,
}: {
  onDone: LocalJSXCommandOnDone
  onBack: () => void
  onChangeAPIKey: () => void
}): React.ReactNode {
  const cfg = getGlobalConfig()
  const setAppState = useSetAppState()
  const [step, setStep] = React.useState<'api-key' | 'base-url' | 'loading' | 'model-select'>('api-key')
  const [apiKey, setApiKey] = React.useState(cfg.openaiApiKey ?? '')
  const [baseUrl, setBaseUrl] = React.useState(cfg.openaiBaseUrl ?? '')
  const [models, setModels] = React.useState<Array<{ id: string }>>([])
  const [apiKeyCursor, setApiKeyCursor] = React.useState(cfg.openaiApiKey?.length ?? 0)
  const [baseUrlCursor, setBaseUrlCursor] = React.useState(cfg.openaiBaseUrl?.length ?? 0)

  useInput((_input, key) => {
    if (!key.escape) return
    if (step === 'api-key') onBack()
    else if (step === 'base-url') setStep('api-key')
  }, { isActive: step === 'api-key' || step === 'base-url' })

  function saveAndDone(modelId?: string) {
    saveGlobalConfig(current => ({
      ...current,
      openaiApiKey: apiKey,
      openaiBaseUrl: baseUrl || undefined,
      openaiModel: modelId || undefined,
      openaiAvailableModels: models.length > 0 ? models.map(m => m.id) : undefined,
      apiProvider: 'openai',
    }))
    for (const envVar of PROVIDER_ENV_VARS) {
      delete process.env[envVar]
    }
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    // Update both the bootstrap override and AppState so /model shows the
    // correct model immediately and the model resolution chain is consistent.
    setMainLoopModelOverride(modelId || undefined)
    updateSettingsForSource('userSettings', { model: modelId || undefined })
    setAppState(prev => ({ ...prev, mainLoopModel: modelId ?? null }))
    onChangeAPIKey()
    const urlMsg = baseUrl ? ` with base URL ${chalk.dim(baseUrl)}` : ''
    onDone(
      `Switched provider to ${chalk.bold(getProviderLabel('openai'))} using API key${urlMsg}`,
    )
  }

  function fetchModels() {
    const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    setStep('loading')
    globalThis.fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then(r => r.json())
      .then((data: unknown) => {
        const list: Array<{ id: string }> = Array.isArray((data as { data?: unknown }).data)
          ? (data as { data: Array<{ id: string }> }).data
          : []
        if (list.length > 0) {
          setModels(list.sort((a, b) => a.id.localeCompare(b.id)))
          setStep('model-select')
        } else {
          saveAndDone()
        }
      })
      .catch(() => {
        saveAndDone()
      })
  }

  if (step === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>API Key</Text>
        <Text dimColor>Enter your OpenAI API key (press Enter to continue):</Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          cursorOffset={apiKeyCursor}
          onChangeCursorOffset={setApiKeyCursor}
          onSubmit={(value: string) => {
            const trimmed = value.trim()
            if (!trimmed) return
            setApiKey(trimmed)
            setStep('base-url')
          }}
          placeholder="sk-..."
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'base-url') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Base URL <Text dimColor>(optional)</Text></Text>
        <Text dimColor>
          Leave empty for https://api.openai.com/v1, or enter a custom endpoint:
        </Text>
        <TextInput
          value={baseUrl}
          onChange={setBaseUrl}
          cursorOffset={baseUrlCursor}
          onChangeCursorOffset={setBaseUrlCursor}
          onSubmit={(value: string) => {
            const url = value.trim()
            setBaseUrl(url)
            fetchModels()
          }}
          placeholder="https://api.openai.com/v1"
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Enter to continue · Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'loading') {
    return (
      <Box flexDirection="column" gap={1}>
        <Spinner label="Fetching available models..." />
      </Box>
    )
  }

  // model-select step
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select Model</Text>
      <Text dimColor>Choose the model to use with this API:</Text>
      <Select
        options={models.map(m => ({ label: m.id, value: m.id }))}
        onChange={(modelId: string) => saveAndDone(modelId)}
      />
    </Box>
  )
}

/**
 * Setup for OpenAI-compatible API with custom base URL.
 * Flow: base-url (required) → api-key → loading → model-select → model (fallback).
 */
function OpenAICompatSetup({
  onDone,
  onBack,
  onChangeAPIKey,
}: {
  onDone: LocalJSXCommandOnDone
  onBack: () => void
  onChangeAPIKey: () => void
}): React.ReactNode {
  const cfg = getGlobalConfig()
  const setAppState = useSetAppState()
  const [step, setStep] = React.useState<'base-url' | 'api-key' | 'loading' | 'model-select' | 'model'>('base-url')
  const [baseUrl, setBaseUrl] = React.useState(cfg.openaiBaseUrl ?? '')
  const [apiKey, setApiKey] = React.useState(cfg.openaiApiKey ?? '')
  const [models, setModels] = React.useState<Array<{ id: string }>>([])
  const [fetchError, setFetchError] = React.useState('')
  const [manualModel, setManualModel] = React.useState('')
  const [baseUrlCursor, setBaseUrlCursor] = React.useState(cfg.openaiBaseUrl?.length ?? 0)
  const [apiKeyCursor, setApiKeyCursor] = React.useState(cfg.openaiApiKey?.length ?? 0)
  const [modelCursor, setModelCursor] = React.useState(0)

  useInput((_input, key) => {
    if (!key.escape) return
    if (step === 'base-url') onBack()
    else if (step === 'api-key') setStep('base-url')
    else if (step === 'loading') setStep('api-key')
    else if (step === 'model-select') setStep('api-key')
    else if (step === 'model') setStep('api-key')
  }, { isActive: step !== 'loading' })

  function saveAndDone(modelId?: string) {
    saveGlobalConfig(current => ({
      ...current,
      openaiApiKey: apiKey || undefined,
      openaiBaseUrl: baseUrl,
      openaiModel: modelId || undefined,
      openaiAvailableModels: models.length > 0 ? models.map(m => m.id) : undefined,
      apiProvider: 'openai',
    }))
    for (const envVar of PROVIDER_ENV_VARS) {
      delete process.env[envVar]
    }
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    setMainLoopModelOverride(modelId || undefined)
    updateSettingsForSource('userSettings', { model: modelId || undefined })
    setAppState(prev => ({ ...prev, mainLoopModel: modelId ?? null }))
    onChangeAPIKey()
    onDone(
      `Switched provider to ${chalk.bold(getProviderLabel('openai'))} at ${chalk.dim(baseUrl)}`,
    )
  }

  function fetchModels(url: string, key: string) {
    const base = url.replace(/\/+$/, '')
    setStep('loading')
    const paths = ['/v1/models', '/models']
    let lastError = ''

    function tryNext(idx: number) {
      if (idx >= paths.length) {
        setFetchError(lastError)
        setStep('model')
        return
      }
      const fetchUrl = `${base}${paths[idx]}`
      const headers: Record<string, string> = {}
      if (key) {
        headers.Authorization = `Bearer ${key}`
      }
      globalThis.fetch(fetchUrl, { headers })
        .then(r => {
          if (!r.ok) {
            lastError = `${paths[idx]} → HTTP ${r.status}`
            tryNext(idx + 1)
            return null
          }
          return r.json()
        })
        .then((data: unknown | null) => {
          if (data === null) return
          let list: Array<{ id: string }> = []
          const d = data as Record<string, unknown>
          if (Array.isArray(d.data)) {
            list = (d.data as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? m.name ?? ''),
            })).filter(m => m.id)
          }
          if (list.length === 0 && Array.isArray(d.models)) {
            list = (d.models as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? m.name ?? ''),
            })).filter(m => m.id)
          }
          if (list.length === 0 && Array.isArray(data)) {
            list = (data as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? m.name ?? ''),
            })).filter(m => m.id)
          }
          if (list.length > 0) {
            const sorted = list.sort((a, b) => a.id.localeCompare(b.id))
            setModels(sorted)
            saveGlobalConfig(current => ({
              ...current,
              openaiAvailableModels: sorted.map(m => m.id),
            }))
            setStep('model-select')
          } else {
            lastError = `${paths[idx]} → no models in response`
            tryNext(idx + 1)
          }
        })
        .catch((err: Error) => {
          lastError = `${paths[idx]} → ${err.message}`
          tryNext(idx + 1)
        })
    }

    tryNext(0)
  }

  if (step === 'base-url') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Base URL</Text>
        <Text dimColor>Enter the base URL of your OpenAI-compatible provider:</Text>
        <TextInput
          value={baseUrl}
          onChange={setBaseUrl}
          cursorOffset={baseUrlCursor}
          onChangeCursorOffset={setBaseUrlCursor}
          onSubmit={(value: string) => {
            const url = value.trim()
            if (!url) return
            setBaseUrl(url)
            setStep('api-key')
          }}
          placeholder="http://localhost:11434"
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>API Key <Text dimColor>(optional)</Text></Text>
        <Text dimColor>Leave empty if no auth is required, or enter your API key:</Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          cursorOffset={apiKeyCursor}
          onChangeCursorOffset={setApiKeyCursor}
          onSubmit={(value: string) => {
            setApiKey(value.trim())
            fetchModels(baseUrl, value.trim())
          }}
          placeholder="sk-... (or leave empty)"
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Enter to continue · Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'loading') {
    return (
      <Box flexDirection="column" gap={1}>
        <Spinner label="Fetching available models..." />
      </Box>
    )
  }

  if (step === 'model-select') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Select Model</Text>
        <Text dimColor>Choose the model to use with this provider:</Text>
        <Select
          options={models.map(m => ({ label: m.id, value: m.id }))}
          onChange={(modelId: string) => saveAndDone(modelId)}
          onCancel={() => setStep('api-key')}
        />
      </Box>
    )
  }

  // step === 'model' — fallback manual entry
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Model ID</Text>
      {fetchError ? (
        <Box flexDirection="column">
          <Text color="yellow">Could not auto-detect models:</Text>
          <Text color="yellow">{fetchError}</Text>
        </Box>
      ) : (
        <Text dimColor>No models found at this endpoint.</Text>
      )}
      <Text dimColor>Enter the model ID to use:</Text>
      <TextInput
        value={manualModel}
        onChange={setManualModel}
        cursorOffset={modelCursor}
        onChangeCursorOffset={setModelCursor}
        onSubmit={(value: string) => {
          const trimmed = value.trim()
          saveAndDone(trimmed || undefined)
        }}
        placeholder="gpt-4o, llama3, etc."
        focus={true}
        showCursor={true}
      />
      <Text dimColor>Press Enter to confirm · Esc to go back</Text>
    </Box>
  )
}

/**
 * API key input form for OpenRouter provider.
 * Flow: base-url → api-key → loading (fetch models) → model-select.
 */
function OpenRouterApiKeySetup({
  onDone,
  onBack,
  onChangeAPIKey,
}: {
  onDone: LocalJSXCommandOnDone
  onBack: () => void
  onChangeAPIKey: () => void
}): React.ReactNode {
  const cfg = getGlobalConfig()
  const setAppState = useSetAppState()
  const [step, setStep] = React.useState<'api-key' | 'loading' | 'model-select'>('api-key')
  const [apiKey, setApiKey] = React.useState(cfg.openrouterApiKey ?? '')
  const [models, setModels] = React.useState<Array<{ id: string }>>([])
  const [apiKeyCursor, setApiKeyCursor] = React.useState(cfg.openrouterApiKey?.length ?? 0)

  useInput((_input, key) => {
    if (!key.escape) return
    onBack()
  }, { isActive: step === 'api-key' })

  function saveAndDone(modelId?: string) {
    saveGlobalConfig(current => ({
      ...current,
      openrouterApiKey: apiKey,
      openrouterModel: modelId || undefined,
      openrouterAvailableModels: models.length > 0 ? models.map(m => m.id) : undefined,
      apiProvider: 'openrouter',
    }))
    for (const envVar of PROVIDER_ENV_VARS) {
      delete process.env[envVar]
    }
    process.env.CLAUDE_CODE_USE_OPENROUTER = '1'
    setMainLoopModelOverride(modelId || undefined)
    updateSettingsForSource('userSettings', { model: modelId || undefined })
    setAppState(prev => ({ ...prev, mainLoopModel: modelId ?? null }))
    onChangeAPIKey()
    onDone(`Switched provider to ${chalk.bold(getProviderLabel('openrouter'))} using API key`)
  }

  function fetchModels(key: string) {
    setStep('loading')
    globalThis.fetch(`${OPENROUTER_DEFAULT_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })
      .then(r => r.json())
      .then((data: unknown) => {
        const list: Array<{ id: string }> = Array.isArray((data as { data?: unknown }).data)
          ? (data as { data: Array<{ id: string }> }).data
          : []
        if (list.length > 0) {
          setModels(list.sort((a, b) => a.id.localeCompare(b.id)))
          setStep('model-select')
        } else {
          saveAndDone()
        }
      })
      .catch(() => {
        saveAndDone()
      })
  }

  if (step === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>OpenRouter API Key</Text>
        <Text dimColor>Enter your OpenRouter API key and press Enter:</Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          cursorOffset={apiKeyCursor}
          onChangeCursorOffset={setApiKeyCursor}
          onSubmit={(value: string) => {
            const trimmed = value.trim()
            if (!trimmed) return
            setApiKey(trimmed)
            fetchModels(trimmed)
          }}
          placeholder="sk-or-..."
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'loading') {
    return (
      <Box flexDirection="column" gap={1}>
        <Spinner label="Fetching available models..." />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select Model</Text>
      <Text dimColor>Choose the model to use with OpenRouter:</Text>
      <Select
        options={models.map(m => ({ label: m.id, value: m.id }))}
        onChange={(modelId: string) => saveAndDone(modelId)}
      />
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
  const [subPhase, setSubPhase] = React.useState<'menu' | 'oauth' | 'apikey' | 'openai-compat'>('menu')
  const setAppState = useSetAppState()

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
          setAppState(prev => ({ ...prev, mainLoopModel: null }))
          onDone(
            `Switched provider to ${chalk.bold(getProviderLabel('openai'))}`,
          )
        }
      } else if (value === 'oauth') {
        setSubPhase('oauth')
      } else if (value === 'apikey') {
        setSubPhase('apikey')
      } else if (value === 'openai-compat') {
        setSubPhase('openai-compat')
      }
    },
    [isCurrent, onDone],
  )

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
        onChangeAPIKey={context.onChangeAPIKey}
      />
    )
  }

  if (subPhase === 'openai-compat') {
    return (
      <OpenAICompatSetup
        onDone={onDone}
        onBack={() => setSubPhase('menu')}
        onChangeAPIKey={context.onChangeAPIKey}
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
    {
      value: 'openai-compat',
      label: 'OpenAI Compatible API',
      description: 'Custom endpoint with OpenAI API format (Ollama, LM Studio, etc.)',
    },
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

/**
 * API key + base URL setup for Anthropic-compatible providers.
 * Flow: base-url → api-key → loading (fetch models) → model-select.
 */
function AnthropicCompatApiKeySetup({
  onDone,
  onBack,
  onChangeAPIKey,
}: {
  onDone: LocalJSXCommandOnDone
  onBack: () => void
  onChangeAPIKey: () => void
}): React.ReactNode {
  const cfg = getGlobalConfig()
  const setAppState = useSetAppState()
  const [step, setStep] = React.useState<'base-url' | 'api-key' | 'loading' | 'model-select' | 'model'>('base-url')
  const [baseUrl, setBaseUrl] = React.useState(cfg.anthropicCompatBaseUrl ?? '')
  const [apiKey, setApiKey] = React.useState(cfg.anthropicCompatApiKey ?? '')
  const [model, setModel] = React.useState(cfg.anthropicCompatModel ?? '')
  const [models, setModels] = React.useState<Array<{ id: string }>>([])
  const [fetchError, setFetchError] = React.useState<string>('')
  const [baseUrlCursor, setBaseUrlCursor] = React.useState(cfg.anthropicCompatBaseUrl?.length ?? 0)
  const [apiKeyCursor, setApiKeyCursor] = React.useState(cfg.anthropicCompatApiKey?.length ?? 0)
  const [modelCursor, setModelCursor] = React.useState(cfg.anthropicCompatModel?.length ?? 0)

  useInput((_input, key) => {
    if (!key.escape) return
    if (step === 'base-url') onBack()
    else if (step === 'api-key') setStep('base-url')
    else if (step === 'loading') setStep('api-key')
    else if (step === 'model-select') setStep('api-key')
    else if (step === 'model') setStep('api-key')
  }, { isActive: step === 'base-url' || step === 'api-key' || step === 'loading' || step === 'model-select' || step === 'model' })

  function saveAndDone(modelId?: string) {
    saveGlobalConfig(current => ({
      ...current,
      anthropicCompatApiKey: apiKey,
      anthropicCompatBaseUrl: baseUrl,
      anthropicCompatModel: modelId || undefined,
      apiProvider: 'anthropicCompat',
    }))
    for (const envVar of PROVIDER_ENV_VARS) {
      delete process.env[envVar]
    }
    process.env.CLAUDE_CODE_USE_ANTHROPIC_COMPAT = '1'
    setMainLoopModelOverride(modelId || undefined)
    updateSettingsForSource('userSettings', { model: modelId || undefined })
    setAppState(prev => ({ ...prev, mainLoopModel: modelId ?? null }))
    onChangeAPIKey()
    onDone(`Switched provider to ${chalk.bold(getProviderLabel('anthropicCompat'))} at ${chalk.dim(baseUrl)}`)
  }

  function fetchModels(url: string, key: string) {
    const base = url.replace(/\/+$/, '')
    setStep('loading')
    // Try multiple paths: /models, /v1/models
    const paths = ['/models', '/v1/models']
    let lastError = ''

    function tryNext(idx: number) {
      if (idx >= paths.length) {
        setFetchError(lastError)
        setStep('model')
        return
      }
      const fetchUrl = `${base}${paths[idx]}`
      globalThis.fetch(fetchUrl, {
        headers: {
          'x-api-key': key,
          Authorization: `Bearer ${key}`,
        },
      })
        .then(r => {
          if (!r.ok) {
            lastError = `${paths[idx]} → HTTP ${r.status}`
            tryNext(idx + 1)
            return null
          }
          return r.json()
        })
        .then((data: unknown | null) => {
          if (data === null) return
          // Handle { data: [{ id: ... }] } (OpenAI/Anthropic style)
          let list: Array<{ id: string }> = []
          const d = data as Record<string, unknown>
          if (Array.isArray(d.data)) {
            list = (d.data as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? m.name ?? ''),
            })).filter(m => m.id)
          }
          // Handle { models: [{ name: ... }] } (Ollama-style)
          if (list.length === 0 && Array.isArray(d.models)) {
            list = (d.models as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? m.name ?? ''),
            })).filter(m => m.id)
          }
          // Handle direct array [{ id: ... }]
          if (list.length === 0 && Array.isArray(data)) {
            list = (data as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
              id: String(m.id ?? m.name ?? ''),
            })).filter(m => m.id)
          }
          if (list.length > 0) {
            const sorted = list.sort((a, b) => a.id.localeCompare(b.id))
            setModels(sorted)
            saveGlobalConfig(current => ({
              ...current,
              anthropicCompatAvailableModels: sorted.map(m => m.id),
            }))
            setStep('model-select')
          } else {
            lastError = `${paths[idx]} → no models in response`
            tryNext(idx + 1)
          }
        })
        .catch((err: Error) => {
          lastError = `${paths[idx]} → ${err.message}`
          tryNext(idx + 1)
        })
    }

    tryNext(0)
  }

  if (step === 'base-url') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Base URL</Text>
        <Text dimColor>Enter the base URL of your Anthropic-compatible provider:</Text>
        <TextInput
          value={baseUrl}
          onChange={setBaseUrl}
          cursorOffset={baseUrlCursor}
          onChangeCursorOffset={setBaseUrlCursor}
          onSubmit={(value: string) => {
            const url = value.trim()
            if (!url) return
            setBaseUrl(url)
            setStep('api-key')
          }}
          placeholder="https://your-provider.com/api/anthropic"
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>API Key</Text>
        <Text dimColor>Enter your API key for {baseUrl}:</Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          cursorOffset={apiKeyCursor}
          onChangeCursorOffset={setApiKeyCursor}
          onSubmit={(value: string) => {
            const trimmed = value.trim()
            if (!trimmed) return
            setApiKey(trimmed)
            fetchModels(baseUrl, trimmed)
          }}
          placeholder="sk-..."
          focus={true}
          showCursor={true}
        />
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    )
  }

  if (step === 'loading') {
    return (
      <Box flexDirection="column" gap={1}>
        <Spinner label="Fetching available models..." />
      </Box>
    )
  }

  if (step === 'model-select') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Select Model</Text>
        <Text dimColor>Choose the model to use with this provider:</Text>
        <Select
          options={models.map(m => ({ label: m.id, value: m.id }))}
          onChange={(modelId: string) => saveAndDone(modelId)}
          onCancel={() => setStep('api-key')}
        />
      </Box>
    )
  }

  // step === 'model' — fallback manual entry when fetch fails or returns empty
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Model ID</Text>
      {fetchError ? (
        <Box flexDirection="column">
          <Text color="yellow">Could not auto-detect models (tried /models, /v1/models):</Text>
          <Text color="yellow">{fetchError}</Text>
        </Box>
      ) : (
        <Text dimColor>Models fetched but no match found.</Text>
      )}
      <Text dimColor>Enter the model ID to use:</Text>
      <TextInput
        value={model}
        onChange={setModel}
        cursorOffset={modelCursor}
        onChangeCursorOffset={setModelCursor}
        onSubmit={(value: string) => {
          const trimmed = value.trim()
          saveAndDone(trimmed || undefined)
        }}
        placeholder="claude-sonnet-4-6"
        focus={true}
        showCursor={true}
      />
      <Text dimColor>Press Enter to confirm · Esc to go back</Text>
    </Box>
  )
}

type PickerState =
  | { phase: 'pick' }
  | { phase: 'login'; targetProvider?: APIProvider }
  | { phase: 'platform-setup'; provider: APIProvider }
  | { phase: 'openai-options' }
  | { phase: 'openrouter-setup' }
  | { phase: 'anthropic-compat-setup' }

function ProviderPickerWrapper({
  onDone,
  context,
}: {
  onDone: LocalJSXCommandOnDone
  context: LocalJSXCommandContext
}): React.ReactNode {
  const currentProvider = getAPIProvider()
  const setAppState = useSetAppState()
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

      // OpenRouter goes directly to key setup
      if (provider === 'openrouter') {
        setState({ phase: 'openrouter-setup' })
        return
      }

      // Anthropic-compatible goes directly to setup
      if (provider === 'anthropicCompat') {
        setState({ phase: 'anthropic-compat-setup' })
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
      setAppState(prev => ({ ...prev, mainLoopModel: null }))
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

  if (state.phase === 'openrouter-setup') {
    return (
      <OpenRouterApiKeySetup
        onDone={onDone}
        onBack={handleBack}
        onChangeAPIKey={context.onChangeAPIKey}
      />
    )
  }

  if (state.phase === 'anthropic-compat-setup') {
    return (
      <AnthropicCompatApiKeySetup
        onDone={onDone}
        onBack={handleBack}
        onChangeAPIKey={context.onChangeAPIKey}
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
  const setAppState = useSetAppState()

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
    setAppState(prev => ({ ...prev, mainLoopModel: null }))
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
