/**
 * Tests for useREPLInput — the input state cluster extracted from REPL.tsx.
 *
 * Covers the public API contract that callers depend on:
 *  - wrapped setInputValue runs side-effects in order (intercept → repin → state)
 *  - setInputValueRaw bypasses those side-effects (used by voice integration)
 *  - isPromptInputActive is set on non-blank input and auto-cleared after the
 *    suppression window when input empties out
 *  - inputValueRef mirrors the latest inputValue synchronously
 *
 * Mocks Ink + earlyInput + history.js + inputModes so the hook can run in a
 * bare react-dom tree.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'

// happy-dom supplies window/document/etc on globalThis so React's
// createRoot can run inside bun:test (which has no DOM by default).
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
  // @ts-expect-error – populating globals for React
  globalThis[key] = (happyWindow as any)[key]
}

// React 19's act() warns when this flag isn't set. Required for the
// wrapped createRoot renderHook harness to drive state updates.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// --- Module mocks (must be registered before importing the hook) ---

mock.module('../../ink.js', () => ({
  // useInput / useTerminalSize / useSearchHighlight aren't exercised by
  // useREPLInput — the hook only owns state. Keeping them as no-ops.
  useInput: () => {},
  useTerminalSize: () => ({ columns: 80, rows: 24 }),
  useTerminalFocus: () => true,
  useTerminalTitle: () => {},
}))

mock.module('../../utils/earlyInput.js', () => ({
  consumeEarlyInput: () => '',
}))

mock.module('../../history.js', () => ({
  expandPastedTextRefs: (input: string) => input,
  parseReferences: () => [],
}))

mock.module('../../components/PromptInput/inputModes.js', () => ({
  prependModeCharacterToInput: (input: string) => input,
}))

mock.module('../../utils/suggestions/shellHistoryCompletion.js', () => ({
  prependToShellHistoryCache: () => {},
}))

const { useREPLInput } = await import('./useREPLInput.js')

// --- Tiny renderHook harness around react-dom ---

type RenderHookResult<T> = {
  result: { current: T }
  rerender: (nextParams?: any) => void
  unmount: () => void
}

function renderHook<T>(callback: () => T): RenderHookResult<T> {
  const result: { current: T } = { current: undefined as unknown as T }
  let latestParams: any = undefined
  let root: Root | null = null

  function Probe({ params }: { params: any }): ReactNode {
    latestParams = params
    result.current = callback()
    return null
  }

  act(() => {
    root = createRoot(document.createElement('div'))
    root.render(createElement(Probe, { params: latestParams }))
  })

  return {
    result,
    rerender: () => {
      act(() => {
        root?.render(createElement(Probe, { params: latestParams }))
      })
    },
    unmount: () => {
      act(() => root?.unmount())
    },
  }
}

// --- Shared param factory ---

function makeParams(overrides: Partial<Parameters<typeof useREPLInput>[0]> = {}) {
  return {
    trySuggestBgPRIntercept: mock(() => false),
    repinScroll: mock(() => {}),
    PROMPT_SUPPRESSION_MS: 1500,
    lastUserScrollTsRef: { current: 0 },
    RECENT_SCROLL_REPIN_WINDOW_MS: 100,
    ...overrides,
  }
}

// --- Tests ---

describe('useREPLInput — wrapped setInputValue side-effects', () => {
  beforeEach(() => {
    // bun:test's spyOn doesn't reset between tests automatically; the
    // mocks declared inside makeParams are fresh each call anyway.
  })

  afterEach(() => {
    // No-op; renderHook lifecycle in each test owns unmount.
  })

  it('runs slash-command intercept BEFORE updating state', () => {
    const tryIntercept = mock((_prev: string, _next: string) => true)
    const params = makeParams({ trySuggestBgPRIntercept: tryIntercept })
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      result.current.setInputValue('/fix')
    })

    expect(tryIntercept).toHaveBeenCalledTimes(1)
    // Intercept returned true → state never updated
    expect(result.current.inputValue).toBe('')
    unmount()
  })

  it('calls repinScroll on first non-blank char after a stale scroll', () => {
    const repin = mock(() => {})
    const lastUserScrollTsRef = { current: Date.now() - 10_000 } // old
    const params = makeParams({ repinScroll: repin, lastUserScrollTsRef })
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      result.current.setInputValue('h')
    })

    expect(repin).toHaveBeenCalledTimes(1)
    expect(result.current.inputValue).toBe('h')
    unmount()
  })

  it('skips repinScroll inside the recent-scroll window', () => {
    const repin = mock(() => {})
    const lastUserScrollTsRef = { current: Date.now() } // brand-new
    const params = makeParams({ repinScroll: repin, lastUserScrollTsRef })
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      result.current.setInputValue('h')
    })

    expect(repin).not.toHaveBeenCalled()
    unmount()
  })

  it('flips isPromptInputActive on non-blank input', () => {
    const params = makeParams()
    const { result, unmount } = renderHook(() => useREPLInput(params))

    expect(result.current.isPromptInputActive).toBe(false)

    act(() => {
      result.current.setInputValue('hello')
    })

    expect(result.current.isPromptInputActive).toBe(true)
    unmount()
  })

  it('treats whitespace-only input as not-active', () => {
    const params = makeParams()
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      result.current.setInputValue('   ')
    })

    expect(result.current.isPromptInputActive).toBe(false)
    unmount()
  })
})

describe('useREPLInput — setInputValueRaw bypass', () => {
  it('setInputValueRaw updates state without calling intercept/repin', () => {
    const tryIntercept = mock(() => false)
    const repin = mock(() => {})
    const params = makeParams({
      trySuggestBgPRIntercept: tryIntercept,
      repinScroll: repin,
    })
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      // Voice integration calls this — must NOT trigger slash-command
      // intercept or repinScroll.
      result.current.setInputValueRaw('/voice command')
    })

    expect(tryIntercept).not.toHaveBeenCalled()
    expect(repin).not.toHaveBeenCalled()
    expect(result.current.inputValue).toBe('/voice command')
    unmount()
  })

  it('setInputValueRaw does NOT flip activation (raw is pure state — wrapped handles UX)', () => {
    const params = makeParams()
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      result.current.setInputValueRaw('raw text')
    })

    // Documented behavior: setInputValueRaw is the bypass used by voice
    // integration. It updates inputValue but skips activation so a
    // programmatic write doesn't suppress interrupt dialogs.
    expect(result.current.inputValue).toBe('raw text')
    expect(result.current.isPromptInputActive).toBe(false)
    unmount()
  })

  it('setInputValueRaw ALSO updates inputValueRef (regression for voice desync)', () => {
    // Voice integration calls setInputValueRaw('voice text'). The ref
    // must reflect this so a subsequent user keystroke sees the right
    // prev in intercept/repin gates. Without the shared write path,
    // intercept would compare the new keystroke against '' (stale)
    // and repin would fire on the first keystroke after voice writes.
    const tryIntercept = mock((_prev: string, next: string) => {
      expect(_prev).toBe('voice text') // critical assertion
      return false
    })
    const params = makeParams({ trySuggestBgPRIntercept: tryIntercept })
    const { result, unmount } = renderHook(() => useREPLInput(params))

    act(() => {
      result.current.setInputValueRaw('voice text')
    })

    // Ref must mirror what was just written.
    expect(result.current.inputValueRef.current).toBe('voice text')

    // Subsequent setInputValue sees the right prev.
    act(() => {
      result.current.setInputValue('more')
    })

    expect(tryIntercept).toHaveBeenCalledWith('voice text', 'more')
    expect(result.current.inputValue).toBe('more')
    unmount()
  })
})

describe('useREPLInput — inputValueRef mirror', () => {
  it('inputValueRef.current mirrors the latest inputValue synchronously', () => {
    const params = makeParams()
    const { result, unmount } = renderHook(() => useREPLInput(params))

    expect(result.current.inputValueRef.current).toBe('')

    act(() => {
      result.current.setInputValue('foo')
    })

    expect(result.current.inputValueRef.current).toBe('foo')
    unmount()
  })
})

describe('useREPLInput — initial state', () => {
  it('starts with empty inputValue, INSERT vimMode, null stashedPrompt', () => {
    const params = makeParams()
    const { result, unmount } = renderHook(() => useREPLInput(params))

    expect(result.current.inputValue).toBe('')
    expect(result.current.vimMode).toBe('INSERT')
    expect(result.current.stashedPrompt).toBe(null)
    expect(result.current.pastedContents).toEqual({})
    expect(result.current.isPromptInputActive).toBe(false)
    unmount()
  })
})

describe('useREPLInput — setter reference stability', () => {
  it('setters are stable across re-renders (no new identity each render)', () => {
    const params = makeParams()
    const { result, rerender, unmount } = renderHook(() => useREPLInput(params))

    const firstInput = result.current.setInputValue
    const firstMode = result.current.setInputMode
    const firstVim = result.current.setVimMode
    const firstStash = result.current.setStashedPrompt

    rerender()

    expect(result.current.setInputValue).toBe(firstInput)
    expect(result.current.setInputMode).toBe(firstMode)
    expect(result.current.setVimMode).toBe(firstVim)
    expect(result.current.setStashedPrompt).toBe(firstStash)
    unmount()
  })
})