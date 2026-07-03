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
  /**
   * Enter pressed in the bar — commit the typed query.
   * Empty-typed queries are discarded (n/N dead anyway, badge hidden).
   * Closes the bar in both cases.
   */
  commitSearch: (q: string) => void;
  /**
   * Esc/Ctrl+C/Ctrl+G — abort the bar.
   * searchQuery (the committed one) is preserved; VML is told to re-scan
   * against the prior query so the highlight overlay stays consistent.
   */
  cancelSearch: () => void;
};

export function useTranscriptSearch(params: TranscriptSearchParams): TranscriptSearchResult {
  const { screen, virtualScrollActive, dumpMode, inTranscript } = params;

  const jumpRef = useRef<JumpHandle | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCount, setSearchCount] = useState(0);
  const [searchCurrent, setSearchCurrent] = useState(0);

  // Mirror refs so commitSearch/cancelSearch always read the latest values
  // without being recreated each time those change. The Enter handler can
  // fire in the same tick as `onSearchMatchesChange` (before React
  // commits the count update), so a closure-captured searchCount would
  // be stale — discards a query that actually has matches.
  const searchCountRef = useRef(0);
  const searchQueryRef = useRef('');

  const onSearchMatchesChange = useCallback((count: number, current: number) => {
    searchCountRef.current = count;
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
  //
  // searchQuery/searchOpen are read via refs so the effect only depends
  // on transcriptCols. Including them as deps would re-run this effect
  // on every keystroke while the bar is open (wasted work — guard
  // prevColsRef would prevent the reset, but the run itself is wasted).
  const transcriptCols = useTerminalSize().columns;
  const prevColsRef = useRef(transcriptCols);
  useEffect(() => {
    if (prevColsRef.current === transcriptCols) return;
    prevColsRef.current = transcriptCols;
    if (searchQueryRef.current || searchOpen) {
      setSearchOpen(false);
      setSearchQuery('');
      searchCountRef.current = 0;
      setSearchCount(0);
      setSearchCurrent(0);
      jumpRef.current?.disarmSearch();
      setHighlight('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs read inside
  }, [transcriptCols, setHighlight]);

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

  // Sync searchQuery ref so cancelSearch reads the latest value without
  // being recreated each commit. Search query can change mid-tick (Enter
  // fires before useEffect commits the state update).
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);

  // Enter pressed in the bar. Empty queries are discarded so n/N stays
  // dead and the badge stays hidden (junk pattern guard).
  const commitSearch = useCallback(
    (q: string) => {
      setSearchQuery(searchCountRef.current > 0 ? q : '');
      setSearchOpen(false);
      if (!q) {
        searchCountRef.current = 0;
        setSearchCount(0);
        setSearchCurrent(0);
        jumpRef.current?.setSearchQuery('');
      }
    },
    [], // stable — reads latest values via refs
  );

  // Esc/Ctrl+C/Ctrl+G — abort. The bar's effect last fired with whatever
  // was typed; searchQuery (committed) is unchanged. Two VML calls: ''
  // restores the anchor (0-match else-branch), then the prior searchQuery
  // re-scans from that anchor's nearest. Synchronous — one React batch.
  // setHighlight is explicit because the highlight sync-effect depends on
  // searchQuery (which we didn't change), so it wouldn't re-fire on its own.
  const cancelSearch = useCallback(() => {
    setSearchOpen(false);
    jumpRef.current?.setSearchQuery('');
    jumpRef.current?.setSearchQuery(searchQueryRef.current);
    setHighlight(searchQueryRef.current);
  }, [setHighlight]); // setHighlight is stable across renders (useSearchHighlight uses useCallback)

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
    commitSearch,
    cancelSearch,
  };
}