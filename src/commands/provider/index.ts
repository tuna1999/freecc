import type { Command } from '../../commands.js'
import { getAPIProvider, type APIProvider } from '../../utils/model/providers.js'

const PROVIDER_LABELS: Record<APIProvider, string> = {
  firstParty: 'Anthropic (First-Party)',
  bedrock: 'AWS Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  openai: 'OpenAI',
}

export default {
  type: 'local-jsx',
  name: 'provider',
  get description() {
    return `Switch API provider (currently ${PROVIDER_LABELS[getAPIProvider()]})`
  },
  argumentHint: '[provider]',
  load: () => import('./provider.js'),
} satisfies Command
