/**
 * Transport interface for CLI ↔ SDK streams.
 *
 * Originally declared in a missing file — reconstructed from usage sites
 * in `src/cli/structuredIO.ts`, `src/cli/remoteIO.ts`, and the various
 * transport implementations in this directory. The shape is intentionally
 * minimal; concrete transports add their own connection state.
 */

import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'

/** Bidirectional message stream for the CLI's control protocol. */
export interface Transport {
  /** Open the transport and start streaming. Resolves when ready. */
  connect(): Promise<void>
  /** Close the transport. Idempotent. */
  disconnect(): Promise<void>
  /** Write one message to the SDK. */
  write(message: StdoutMessage): Promise<void>
  /** Write a batch atomically. */
  writeBatch(messages: StdoutMessage[]): Promise<void>
  /** Async iterator over incoming SDK messages. */
  messages(): AsyncIterableIterator<unknown>
  /** True when the underlying connection is open. */
  isConnected(): boolean
}