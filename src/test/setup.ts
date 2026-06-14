/**
 * Bun test preload — runs once before each test file.
 *
 * Sets up a stable HOME / XDG_CONFIG_HOME so the config code under
 * test points at a known location regardless of the dev environment.
 * Tests that mutate config should call resetGlobalConfig() (or just
 * delete the temp file) to keep state isolated.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempHome = mkdtempSync(join(tmpdir(), 'freecc-test-'))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome
process.env.XDG_CONFIG_HOME = join(tempHome, '.config')

// bun:test exposes `afterAll` on the global scope inside test files
// but not in preload; the individual tests can rmSync if they care.
export function cleanupTestHome(): void {
  try {
    rmSync(tempHome, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}
