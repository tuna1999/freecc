/**
 * Types for TeamCreateTool.
 *
 * Lives in its own module so `UI.tsx` can import `Input` without forming
 * a cycle through `TeamCreateTool.ts`. The runtime tool still re-exports
 * `Input` from here for backward compatibility.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    team_name: z.string().describe('Name for the new team to create.'),
    description: z.string().optional().describe('Team description/purpose.'),
    agent_type: z
      .string()
      .optional()
      .describe(
        'Type/role of the team lead (e.g., "researcher", "test-runner"). ' +
          'Used for team file and inter-agent coordination.',
      ),
  }),
)

export type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>