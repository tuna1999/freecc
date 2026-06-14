/**
 * Zod schemas for the remote relay protocol.
 *
 * Use these at the WebSocket boundary (client.ts message handler) to reject
 * unknown / malformed messages before dispatching to local REPL code paths.
 *
 * The CLI runs in a personal/localhost context (per project policy), so the
 * threat model is "defensive parsing", not "untrusted network". Even so, a
 * malicious or buggy relay server can inject unexpected shapes, and the
 * previous `as RemoteMessage` cast would happily forward garbage into the
 * input pipeline.
 */

import { z } from 'zod'

const timestamp = z.number()

const promptOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

export const RemoteMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    content: z.string().optional(),
    id: z.string().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('stream_start'),
    id: z.string(),
    timestamp,
  }),
  z.object({
    type: z.literal('stream_delta'),
    id: z.string(),
    content: z.string(),
    timestamp,
  }),
  z.object({
    type: z.literal('stream_end'),
    id: z.string(),
    timestamp,
  }),
  z.object({
    type: z.literal('tool_use'),
    name: z.string(),
    content: z.string().optional(),
    id: z.string().optional(),
    detail: z.string().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('tool_result'),
    content: z.string().optional(),
    id: z.string().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('thinking'),
    content: z.string(),
    timestamp,
  }),
  z.object({
    type: z.literal('status'),
    status: z.string().optional(),
    processing: z.boolean().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('interrupt'),
    timestamp,
  }),
  z.object({
    type: z.literal('permission_request'),
    id: z.string().optional(),
    name: z.string().optional(),
    detail: z.string().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('permission_response'),
    decision: z.enum(['allow', 'reject']).optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('prompt_request'),
    id: z.string().optional(),
    content: z.string().optional(),
    options: z.array(promptOptionSchema).optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('prompt_response'),
    selected: z.string().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('system'),
    content: z.string().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('session_info'),
    sessionId: z.string().optional(),
    webClients: z.number().optional(),
    cliConnected: z.boolean().optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('history'),
    messages: z.array(z.unknown()).optional(),
    timestamp,
  }),
  z.object({
    type: z.literal('ping'),
    timestamp,
  }),
  z.object({
    type: z.literal('pong'),
    timestamp,
  }),
])

/**
 * Inferred TS type for a validated RemoteMessage.
 * Use this instead of importing RemoteMessage from types.ts when consuming
 * parsed messages, so the schema is the single source of truth.
 */
export type ParsedRemoteMessage = z.infer<typeof RemoteMessageSchema>
