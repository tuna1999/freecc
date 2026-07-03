/**
 * Output types for ScheduleCronTool.
 *
 * Lives in its own module so `UI.tsx` can import the `*Output` types without
 * forming a cycle through `CronCreateTool.ts`, `CronDeleteTool.ts`, or
 * `CronListTool.ts`. Each tool file still re-exports its output type from
 * here for backward compatibility.
 */
import { z } from 'zod/v4'

export const createOutputSchema = z.object({
  id: z.string(),
  humanSchedule: z.string(),
  recurring: z.boolean(),
  durable: z.boolean().optional(),
})

export type CreateOutput = z.infer<typeof createOutputSchema>

export const deleteOutputSchema = z.object({
  id: z.string(),
})

export type DeleteOutput = z.infer<typeof deleteOutputSchema>

export const listOutputSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      cron: z.string(),
      humanSchedule: z.string(),
      prompt: z.string(),
      recurring: z.boolean().optional(),
      durable: z.boolean().optional(),
    }),
  ),
})

export type ListOutput = z.infer<typeof listOutputSchema>