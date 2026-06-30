/**
 * Sets the terminal tab title, with an animated prefix glyph while a query
 * is running. Isolated from REPL so the 960ms animation tick re-renders only
 * this leaf component (which returns null — pure side-effect) instead of the
 * entire REPL tree. Before extraction, the tick was ~1 REPL render/sec for
 * the duration of every turn, dragging PromptInput and friends along.
 *
 * Extracted from REPL.tsx in the mid-elegance refactor.
 */
import { c as _c } from "react/compiler-runtime";
import { useEffect, useState, type ReactNode } from 'react';
import { useTerminalFocus, useTerminalTitle } from '../../ink.js';

const TITLE_ANIMATION_FRAMES = ['⠂', '⠐'];
const TITLE_STATIC_PREFIX = '✳';
const TITLE_ANIMATION_INTERVAL_MS = 960;

type AnimatedTerminalTitleProps = {
  isAnimating: boolean;
  title: string;
  disabled: boolean;
  noPrefix: boolean;
};

function _temp2(setFrame_0: (updater: (prev: number) => number) => void) {
  return setFrame_0(_temp);
}

function _temp(f: number): number {
  return (f + 1) % TITLE_ANIMATION_FRAMES.length;
}

export function AnimatedTerminalTitle({
  isAnimating,
  title,
  disabled,
  noPrefix
}: AnimatedTerminalTitleProps): ReactNode {
  const $ = _c(6);
  const terminalFocused = useTerminalFocus();
  const [frame, setFrame] = useState(0);
  let t1;
  let t2;
  if ($[0] !== disabled || $[1] !== isAnimating || $[2] !== noPrefix || $[3] !== terminalFocused) {
    t1 = () => {
      if (disabled || noPrefix || !isAnimating || !terminalFocused) {
        return;
      }
      const interval = setInterval(_temp2, TITLE_ANIMATION_INTERVAL_MS, setFrame);
      return () => clearInterval(interval);
    };
    t2 = [disabled, noPrefix, isAnimating, terminalFocused];
    $[0] = disabled;
    $[1] = isAnimating;
    $[2] = noPrefix;
    $[3] = terminalFocused;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  useEffect(t1, t2);
  const prefix = isAnimating ? TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX : TITLE_STATIC_PREFIX;
  useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`);
  return null;
}