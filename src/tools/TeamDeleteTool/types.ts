/**
 * Types for TeamDeleteTool.
 *
 * Lives in its own module so `UI.tsx` can import `Output` without forming
 * a cycle through `TeamDeleteTool.ts`. The runtime tool still re-exports
 * `Output` from here for backward compatibility.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const inputSchema = lazySchema(() => z.strictObject({}))
export type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

export type Output = {
  success: boolean
  message: string
  team_name?: string
}
