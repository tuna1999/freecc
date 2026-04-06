import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'remote-connect',
  description: 'Connect to a self-hosted remote relay server',
  argumentHint: '[--server <url> --key <key>]',
  aliases: ['rc-connect'],
  load: () => import('./remote-connect.js'),
} satisfies Command
