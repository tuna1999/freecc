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
 * Input schema for SendMessageTool. Kept in sync with the Zod schema
 * defined in `SendMessageTool.ts` (which is the runtime source of truth —
 * `Input = z.infer<typeof inputSchema>` is re-exported from there for
 * backward compatibility). When you change the schema, mirror it here.
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
