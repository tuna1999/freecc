/**
 * Remote Relay Built-in Plugin
 *
 * Makes the remote relay feature discoverable and toggleable via /plugin.
 * The actual relay logic lives in src/remote-server/ and is activated
 * by the /remote-connect command.
 */

import { registerBuiltinPlugin } from '../../builtinPlugins.js'

export function registerRemoteRelayPlugin(): void {
  registerBuiltinPlugin({
    name: 'remote-relay',
    description:
      'Connect to a self-hosted relay server for remote web access. Use /remote-connect to set up.',
    version: '1.0.0',
    defaultEnabled: true,
    isAvailable: () => true,
  })
}
