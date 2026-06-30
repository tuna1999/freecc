/**
 * Less-style search input for transcript mode.
 *
 * Owns:
 *   - Search bar state (open, query, count, current)
 *   - `jumpRef` to the VirtualMessageList's match navigation
 *   - `/` opens bar, `n`/`N` jumps to next/prev match
 *   - Resize handling (clears search on terminal width change)
 *   - Screen-change cleanup (reset search on entry/exit)
 *   - Highlight overlay wiring (useSearchHighlight)
 *
 * What this hook does NOT own (kept in REPL.tsx):
 *   - Escape-hatch handlers (`q` exit, `[` dump, `v` editor) — those
 *     touch editor-tempfile rendering and dump-mode state that are
 *     caller-managed.
 *
 * Extracted from REPL.tsx in the mid-elegance refactor. The hook returns
 * the search-related state + jumpRef + handlers; REPL picks what to
 * forward to <TranscriptSearchBar>, <Messages>, and the global
 * keybinding prop bag.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useInput } from '../../ink.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useSearchHighlight } from '../../ink/hooks/use-search-highlight.js';
import type { JumpHandle } from '../../components/VirtualMessageList.js';

export type TranscriptSearchParams = {
  /** Current screen mode — search only active in transcript mode. */
  screen: 'prompt' | 'transcript';
  /** Whether virtual scroll is active (FullscreenEnv + !disableVirtualScroll). */
  virtualScrollActive: boolean;
  /** Whether dump-to-scrollback mode is active (set by `[`). */
  dumpMode: boolean;
  /**
   * True iff we are currently inside transcript mode — used to reset
   * search on entry (fresh `less`) and to drive the highlight overlay.
   */
  inTranscript: boolean;
};

export type TranscriptSearchResult = {
  /** Ref forwarded to <VirtualMessageList> as `jumpRef`. */
  jumpRef: RefObject<JumpHandle | null>;
  /** Whether the search bar is currently mounted. */
  searchOpen: boolean;
  /** Committed search query (persists after bar closes for n/N). */
  searchQuery: string;
  /** Total matches in the visible transcript for the current query. */
  searchCount: number;
  /** Current match index (1-based) — drives the badge. */
  searchCurrent: number;
  /** Sets the screen-space yellow highlight overlay. */
  setHighlight: ReturnType<typeof useSearchHighlight>['setQuery'];
  /** Sets per-element scan positions for precise n/N targeting. */
  setPositions: ReturnType<typeof useSearchHighlight>['setPositions'];
  /** Per-element scan helper from useSearchHighlight. */
  scanElement: ReturnType<typeof useSearchHighlight>['scanElement'];
  /** Updates match-count + current-index badge. */
  onSearchMatchesChange: (count: number, current: number) => void;
};

export function useTranscriptSearch(params: TranscriptSearchParams): TranscriptSearchResult {
  const { screen, virtualScrollActive, dumpMode, inTranscript } = params;

  const jumpRef = useRef<JumpHandle | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCount, setSearchCount] = useState(0);
  const [searchCurrent, setSearchCurrent] = useState(0);

  const onSearchMatchesChange = useCallback((count: number, current: number) => {
    setSearchCount(count);
    setSearchCurrent(current);
  }, []);

  const { setQuery: setHighlight, scanElement, setPositions } = useSearchHighlight();

  // Less `n`/`N` and `/` open. Search bar's own useSearchInput handles
  // query editing; this hook only manages the open/closed mode + jumps.
  useInput((input, key, event) => {
    if (key.ctrl || key.meta) return;
    if (input === '/') {
      // Capture scrollTop NOW — typing is a preview, 0-matches snaps
      // back here. Synchronous ref write, fires before the bar's
      // mount-effect calls setSearchQuery.
      jumpRef.current?.setAnchor();
      setSearchOpen(true);
      event.stopImmediatePropagation();
      return;
    }
    // Held-key batching: tokenizer coalesces to 'nnn'. Same uniform-batch
    // pattern as modalPagerAction in ScrollKeybindingHandler.tsx. Each
    // repeat is a step (n isn't idempotent like g).
    const c = input[0];
    if ((c === 'n' || c === 'N') && input === c.repeat(input.length) && searchCount > 0) {
      const fn = c === 'n' ? jumpRef.current?.nextMatch : jumpRef.current?.prevMatch;
      if (fn) for (let i = 0; i < input.length; i++) fn();
      event.stopImmediatePropagation();
    }
  }, {
    isActive: screen === 'transcript' && virtualScrollActive && !searchOpen && !dumpMode,
  });

  // Resize → abort search. Positions are (msg, query, WIDTH)-keyed —
  // cached positions are stale after a width change. Clearing
  // searchQuery triggers VML's setSearchQuery('') which clears
  // positionsCache + setPositions(null). Bar closes. User hits / again
  // → fresh.
  const transcriptCols = useTerminalSize().columns;
  const prevColsRef = useRef(transcriptCols);
  useEffect(() => {
    if (prevColsRef.current !== transcriptCols) {
      prevColsRef.current = transcriptCols;
      if (searchQuery || searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchCount(0);
        setSearchCurrent(0);
        jumpRef.current?.disarmSearch();
        setHighlight('');
      }
    }
  }, [transcriptCols, searchQuery, searchOpen, setHighlight]);

  // Fresh `less` per transcript entry. Prevents stale highlights matching
  // unrelated normal-mode text (overlay is alt-screen-global) and avoids
  // surprise n/N on re-entry.
  useEffect(() => {
    if (!inTranscript) {
      setSearchQuery('');
      setSearchCount(0);
      setSearchCurrent(0);
      setSearchOpen(false);
    }
  }, [inTranscript]);

  // Highlight overlay mirrors `inTranscript` plus current query.
  useEffect(() => {
    setHighlight(inTranscript ? searchQuery : '');
    // Clear the position-based CURRENT (yellow) overlay too. setHighlight
    // only clears the scan-based inverse. Without this, the yellow box
    // persists at its last screen coords after ctrl-c exits transcript.
    if (!inTranscript) setPositions(null);
  }, [inTranscript, searchQuery, setHighlight, setPositions]);

  return {
    jumpRef,
    searchOpen,
    searchQuery,
    searchCount,
    searchCurrent,
    setHighlight,
    setPositions,
    scanElement,
    onSearchMatchesChange,
  };
}