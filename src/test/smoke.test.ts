import { describe, it, expect } from 'bun:test'

describe('test infrastructure', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })

  it('sees the test HOME from preload', () => {
    // The preload file in bunfig.toml points HOME at a temp dir so
    // config code under test does not read the developer's actual
    // ~/.freecc.json. If this assertion fails, the preload is not
    // wired up correctly.
    expect(process.env.HOME).toBeTruthy()
    expect(process.env.HOME).toContain('freecc-test-')
  })
})
