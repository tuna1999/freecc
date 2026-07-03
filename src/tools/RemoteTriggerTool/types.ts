/**
 * Types for RemoteTriggerTool.
 *
 * Lives in its own module so `UI.tsx` can import `Input` and `Output`
 * without forming a cycle through `RemoteTriggerTool.ts`. The runtime tool
 * still re-exports these types from here for backward compatibility.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['list', 'get', 'create', 'update', 'run']),
    trigger_id: z
      .string()
      .regex(/^[\w-]+$/)
      .optional()
      .describe('Required for get, update, and run'),
    body: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('JSON body for create and update'),
  }),
)

export type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    status: z.number(),
    json: z.string(),
  }),
)

export type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>