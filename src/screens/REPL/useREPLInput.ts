/**
 * Input state management for the prompt input area.
 *
 * Owns the user-input-related useState/useRef cluster:
 *   - inputValue + the wrapper setInputValue that runs intercept +
 *     repin-scroll + activation side-effects
 *   - inputMode (PromptInputMode — 'prompt' | 'shell' | '@mention' | etc.)
 *   - stashedPrompt (preserved across slash-command dialogs)
 *   - pastedContents (file/image paste buffer)
 *   - vimMode (VimMode for the optional vim keybinding layer)
 *   - isPromptInputActive (true iff the prompt has non-whitespace text)
 *
 * What this hook does NOT own (deliberately):
 *   - submitCount (lives with the submit logic, not with input state)
 *   - The onSubmit handler (calls into too many cross-cutting services
 *     to extract cleanly)
 *   - PromptInput rendering (lives in REPL.tsx)
 *
 * Extracted from REPL.tsx in the mid-elegance refactor. The hook is
 * a pure state cluster — no JSX, no callbacks that read other REPL
 * state. Setters are stable references (useCallback) so the JSX
 * callers don't see new function identities on each render.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { consumeEarlyInput } from '../../utils/earlyInput.js';
import { expandPastedTextRefs, parseReferences } from '../../history.js';
import { prependModeCharacterToInput } from '../../components/PromptInput/inputModes.js';
import { prependToShellHistoryCache } from '../../utils/suggestions/shellHistoryCompletion.js';
import type { PromptInputMode, VimMode } from '../../types/textInputTypes.js';
import type { PastedContent } from '../../utils/config.js';

export type UseREPLInputParams = {
  /** Try a slash-command suggestion intercept on every keystroke. */
  trySuggestBgPRIntercept: (prev: string, next: string) => boolean;
  /** Repin ScrollBox after a user scrolls while idle. */
  repinScroll: () => void;
  /** How long the prompt stays \"active\" after the last non-blank keystroke. */
  PROMPT_SUPPRESSION_MS: number;
  /** Monotonic timestamp of last user scroll (for repin gating). */
  lastUserScrollTsRef: MutableRefObject<number>;
  /** Window in ms where a scroll suppresses the repin-on-type repaint. */
  RECENT_SCROLL_REPIN_WINDOW_MS: number;
};

export type UseREPLInputResult = {
  inputValue: string;
  setInputValue: (value: string) => void;
  /**
   * Raw state setter — bypasses the side-effects of `setInputValue`
   * (slash-command intercept, repin-on-type, activation flag).
   * Reserved for integrations that need direct control over the input
   * buffer (e.g. voice transcription write-back).
   */
  setInputValueRaw: Dispatch<SetStateAction<string>>;
  inputMode: PromptInputMode;
  setInputMode: (mode: PromptInputMode) => void;
  stashedPrompt: {
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | null;
  setStashedPrompt: (
    s: {
      text: string;
      cursorOffset: number;
      pastedContents: Record<number, PastedContent>;
    } | null
  ) => void;
  pastedContents: Record<number, PastedContent>;
  setPastedContents: Dispatch<SetStateAction<Record<number, PastedContent>>>;
  vimMode: VimMode;
  setVimMode: (mode: VimMode) => void;
  isPromptInputActive: boolean;
  setIsPromptInputActive: (active: boolean) => void;
  /** Mirror ref — read the latest inputValue without subscribing. */
  inputValueRef: MutableRefObject<string>;
};

export function useREPLInput(params: UseREPLInputParams): UseREPLInputResult {
  const {
    trySuggestBgPRIntercept,
    repinScroll,
    PROMPT_SUPPRESSION_MS,
    lastUserScrollTsRef,
    RECENT_SCROLL_REPIN_WINDOW_MS,
  } = params;

  const [isPromptInputActive, setIsPromptInputActiveRaw] = useState(false);
  const [inputValue, setInputValueRaw] = useState(() => consumeEarlyInput());
  const [inputMode, setInputMode] = useState<PromptInputMode>('prompt');
  const [stashedPrompt, setStashedPrompt] = useState<{
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | null>(null);
  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');

  // Mirror ref so non-render paths (event handlers, async closures) can
  // read the latest input value without subscribing to state.
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  // Wrap setInputValue to co-locate suppression state updates. Three
  // side-effects live here:
  //   1. Slash-command intercept — early-return when suggestion fires.
  //   2. Repin-on-type — after a recent scroll, pin ScrollBox to bottom
  //      when the user resumes typing.
  //   3. Activation flag — flip on first non-blank char.
  const setInputValue = useCallback(
    (value: string) => {
      if (trySuggestBgPRIntercept(inputValueRef.current, value)) return;
      if (
        inputValueRef.current === '' &&
        value !== '' &&
        Date.now() - lastUserScrollTsRef.current >= RECENT_SCROLL_REPIN_WINDOW_MS
      ) {
        repinScroll();
      }
      // Update the ref synchronously so downstream React updates (e.g.
      // the auto-restore finally) read the new value before commit.
      inputValueRef.current = value;
      setInputValueRaw(value);
      setIsPromptInputActiveRaw(value.trim().length > 0);
    },
    [repinScroll, trySuggestBgPRIntercept, lastUserScrollTsRef, RECENT_SCROLL_REPIN_WINDOW_MS],
  );

  // Deactivate after the suppression window when input empties out.
  useEffect(() => {
    if (inputValue.trim().length === 0) return;
    const timer = setTimeout(() => setIsPromptInputActiveRaw(false), PROMPT_SUPPRESSION_MS);
    return () => clearTimeout(timer);
  }, [inputValue, PROMPT_SUPPRESSION_MS]);

  return {
    inputValue,
    setInputValue,
    setInputValueRaw,
    inputMode,
    setInputMode,
    stashedPrompt,
    setStashedPrompt,
    pastedContents,
    setPastedContents,
    vimMode,
    setVimMode,
    isPromptInputActive,
    setIsPromptInputActive: setIsPromptInputActiveRaw,
    inputValueRef,
  };
}