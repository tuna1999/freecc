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
