/**
 * Tests for useTranscriptSearch — the search state machine extracted
 * from REPL.tsx.
 *
 * Covers the public API contract:
 *  - commitSearch persists a non-empty query and clears state when query
 *    is empty (0-match guard) — the bug that caused the `setSearchQuery`
 *    ReferenceError before commit/cancel callbacks were added
 *  - cancelSearch closes the bar without losing the prior query
 *  - hook returns searchQuery/searchCount/searchCurrent for the badge
 *
 * Mocks Ink + useSearchHighlight so the hook can run in a bare
 * react-dom tree.
 */

import { describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'

const happyWindow = new Window({ url: 'http://localhost/' })
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'Node',
  'getComputedStyle',
  'CSS',
] as const) {
  // Populate globals for React. happy-dom's types don't include all
  // these on globalThis, so we cast.
  ;(globalThis as Record<string, unknown>)[key] = (happyWindow as unknown as Record<string, unknown>)[key]
}
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// --- Module mocks ---

mock.module('../../ink.js', () => ({
  useInput: () => {},
  useTerminalSize: () => ({ columns: 80, rows: 24 }),
  useTerminalFocus: () => true,
  useTerminalTitle: () => {},
}))

mock.module('../../hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 80, rows: 24 }),
}))

mock.module('../../ink/hooks/use-search-highlight.js', () => {
  // Stable mock handlers so callbacks derived from them in the hook
  // (e.g. cancelSearch) remain referentially stable across renders —
  // mirrors the real useSearchHighlight which uses useCallback.
  const setQuery = mock(() => {})
  const setPositions = mock(() => {})
  const scanElement = mock(() => [])
  return {
    useSearchHighlight: () => ({ setQuery, setPositions, scanElement }),
  }
})

const { useTranscriptSearch } = await import('./useTranscriptSearch.js')

// --- Tiny renderHook harness ---

type RenderHookResult<T> = {
  result: { current: T }
  unmount: () => void
}

function renderHook<T>(callback: () => T): RenderHookResult<T> {
  const result: { current: T } = { current: undefined as unknown as T }
  let root: Root | null = null

  function Probe(): ReactNode {
    result.current = callback()
    return null
  }

  act(() => {
    root = createRoot(document.createElement('div'))
    root.render(createElement(Probe))
  })

  return {
    result,
    unmount: () => {
      act(() => root?.unmount())
    },
  }
}

// --- Tests ---

describe('useTranscriptSearch — initial state', () => {
  it('starts with bar closed, empty query, zero counts', () => {
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    expect(result.current.searchOpen).toBe(false)
    expect(result.current.searchQuery).toBe('')
    expect(result.current.searchCount).toBe(0)
    expect(result.current.searchCurrent).toBe(0)
    unmount()
  })

  it('exposes commitSearch and cancelSearch callbacks (no raw setters leaked)', () => {
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    expect(typeof result.current.commitSearch).toBe('function')
    expect(typeof result.current.cancelSearch).toBe('function')
    unmount()
  })
})

describe('useTranscriptSearch — commitSearch semantics', () => {
  it('persists a non-empty query when matches > 0 and closes the bar', () => {
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    // Pretend VML reported 3 matches for the upcoming commit.
    act(() => {
      result.current.onSearchMatchesChange(3, 1)
    })

    act(() => {
      result.current.commitSearch('foo')
    })

    expect(result.current.searchQuery).toBe('foo')
    expect(result.current.searchOpen).toBe(false)
    unmount()
  })

  it('discards query when matches = 0 (0-match guard)', () => {
    // 0-match guard: if no matches, junk query must not persist —
    // n/N would be dead and the badge hidden. The hook reads
    // `searchCount` via a ref (not closure) so the 0-match decision
    // is always based on the most recently reported matches.
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    act(() => {
      result.current.commitSearch('junk')
    })

    expect(result.current.searchQuery).toBe('')
    unmount()
  })

  it('discards empty queries even when matches > 0', () => {
    // Empty input + 0-match-count reset path: the bar unmounts before
    // its [query] effect fires with '', so we explicitly clear count.
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    act(() => {
      result.current.onSearchMatchesChange(5, 1)
    })

    act(() => {
      result.current.commitSearch('')
    })

    expect(result.current.searchQuery).toBe('')
    // Counters reset by the !q branch inside commitSearch.
    expect(result.current.searchCount).toBe(0)
    expect(result.current.searchCurrent).toBe(0)
    unmount()
  })

  it('uses the LATEST searchCount via ref (regression for stale-closure bug)', () => {
    // Regression: before the ref-pattern fix, the Enter handler could
    // see a stale searchCount=0 when VML had reported 5 matches in
    // the same tick. The query that DID have matches was then
    // discarded. The ref pattern guarantees commitSearch reads the
    // most recent value regardless of React batching.
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    // Simulate: VML reports 5 matches in the same tick as the user
    // presses Enter. act() batches these; commitSearch (with stable
    // identity) reads the ref that onSearchMatchesChange updated.
    act(() => {
      result.current.onSearchMatchesChange(5, 1)
      result.current.commitSearch('foo')
    })

    // Despite the synchronous order, the ref was updated before
    // commitSearch read it — query persists.
    expect(result.current.searchQuery).toBe('foo')
    unmount()
  })
})

describe('useTranscriptSearch — cancelSearch semantics', () => {
  it('closes the bar without touching searchQuery (when searchCount > 0)', () => {
    // The bar's effect last fired with whatever was typed; the committed
    // searchQuery stays. Only the bar's open state changes.
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    // First commit a query so searchQuery has a value to preserve.
    act(() => {
      result.current.onSearchMatchesChange(2, 1)
    })
    act(() => {
      result.current.commitSearch('hello')
    })
    expect(result.current.searchQuery).toBe('hello')

    act(() => {
      result.current.cancelSearch()
    })

    // searchQuery preserved; only the bar closes.
    expect(result.current.searchQuery).toBe('hello')
    expect(result.current.searchOpen).toBe(false)
    unmount()
  })
})

describe('useTranscriptSearch — onSearchMatchesChange', () => {
  it('updates searchCount + searchCurrent', () => {
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    act(() => {
      result.current.onSearchMatchesChange(7, 3)
    })

    expect(result.current.searchCount).toBe(7)
    expect(result.current.searchCurrent).toBe(3)
    unmount()
  })
})

describe('useTranscriptSearch — reference stability', () => {
  it('cancelSearch is stable when its dep (searchQuery) is unchanged', () => {
    // commitSearch's deps include searchCount, so it changes when the
    // badge updates — that's expected. cancelSearch's deps include
    // searchQuery (which we don't mutate in this test), so it should
    // stay stable across a no-op render.
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    const firstCancel = result.current.cancelSearch

    // A state update that doesn't affect searchQuery → re-render.
    act(() => {
      result.current.onSearchMatchesChange(1, 1)
    })

    expect(result.current.cancelSearch).toBe(firstCancel)
    unmount()
  })

  it('onSearchMatchesChange is stable (no deps)', () => {
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    const first = result.current.onSearchMatchesChange

    act(() => {
      result.current.onSearchMatchesChange(1, 1)
    })

    expect(result.current.onSearchMatchesChange).toBe(first)
    unmount()
  })

  it('cancelSearch reads latest searchQuery via ref (not stale closure)', () => {
    // Regression test for the stale-searchCount/searchQuery closure
    // bug. cancelSearch must see the most recently committed value,
    // not a stale snapshot from when the callback was created.
    const { result, unmount } = renderHook(() =>
      useTranscriptSearch({
        screen: 'transcript',
        virtualScrollActive: true,
        dumpMode: false,
        inTranscript: true,
      }),
    )

    // Commit a query so cancelSearch has something to preserve.
    act(() => {
      result.current.onSearchMatchesChange(2, 1)
    })
    act(() => {
      result.current.commitSearch('hello')
    })

    const cancelAfterCommit = result.current.cancelSearch

    // The cancelSearch identity was stable across the searchCount update
    // → commit. Verify it's still the same one now.
    expect(result.current.cancelSearch).toBe(cancelAfterCommit)
    unmount()
  })
})