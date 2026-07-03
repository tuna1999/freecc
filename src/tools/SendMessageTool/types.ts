/**
 * Shared output types for SendMessageTool.
 *
 * Lives in its own module so `UI.tsx` can import `Input` and
 * `SendMessageToolOutput` without forming a cycle through `SendMessageTool.ts`.
 * The runtime tool still re-exports these types from here for backward
 * compatibility.
 */

export type MessageRouting = {
  sender: string
  senderColor?: string
  target: string
  targetColor?: string
  summary?: string
  content?: string
}

export type MessageOutput = {
  success: boolean
  message: string
  routing?: MessageRouting
}

export type BroadcastOutput = {
  success: boolean
  message: string
  recipients: string[]
  routing?: MessageRouting
}

export type RequestOutput = {
  success: boolean
  message: string
  request_id: string
  target: string
}

export type ResponseOutput = {
  success: boolean
  message: string
  request_id?: string
}

export type SendMessageToolOutput =
  | MessageOutput
  | BroadcastOutput
  | RequestOutput
  | ResponseOutput

/**
 * Hand-maintained mirror of the Zod schema in `SendMessageTool.ts`.
 *
 * Why not `z.infer<typeof inputSchema>`? That would create an import
 * cycle (UI.tsx → SendMessageTool.ts → types.ts → SendMessageTool.ts).
 * So this file duplicates the schema's TYPE surface, and the runtime
 * Zod schema in `SendMessageTool.ts` is the actual source of truth.
 *
 * IMPORTANT: When the Zod schema changes, mirror the change here AND
 * ensure the compile-time identity check in `types.test.ts` still passes.
 */
export type StructuredMessageInput =
  | { type: 'shutdown_request'; reason?: string }
  | {
      type: 'shutdown_response'
      request_id: string
      approve: boolean
      reason?: string
    }
  | {
      type: 'plan_approval_response'
      request_id: string
      approve: boolean
      feedback?: string
    }

export type Input = {
  to: string
  summary?: string
  message: string | StructuredMessageInput
}
