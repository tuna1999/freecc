/**
 * Assistant (sub-agent / coworker) module entry point.
 *
 * Originally declared in a missing file — reconstructed as a stub so that
 * `src/bridge/initReplBridge.ts` can dynamically require it. The real
 * implementation lives elsewhere in the upstream tree; this stub
 * provides just enough surface for the conditional `require()` to
 * typecheck.
 */

export type AssistantSession = {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  metadata?: Record<string, unknown>
}

export type AssistantInfo = AssistantSession & {
  description?: string
}

export async function listAssistants(): Promise<AssistantInfo[]> {
  return []
}

export async function getAssistant(id: string): Promise<AssistantInfo | null> {
  return null
}

export async function stopAssistant(id: string): Promise<boolean> {
  return true
}

export const ASSISTANT_API_VERSION = '0.0.0-stub'