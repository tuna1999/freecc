/**
 * Small component to display transcript mode footer with dynamic keybinding.
 * Must be rendered inside KeybindingSetup to access keybinding context.
 *
 * Extracted from REPL.tsx in the mid-elegance refactor. Pure leaf component —
 * no business logic, no shared state. Safe to extract with no behavioral change.
 */
import { c as _c } from "react/compiler-runtime";
import { type ReactNode } from 'react';
import figures from 'figures';
import { Box, Text } from '../../ink.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';

type TranscriptModeFooterProps = {
  showAllInTranscript: boolean;
  virtualScroll: boolean;
  searchBadge?: { current: number; count: number };
  suppressShowAll?: boolean;
  status?: string;
};

export function TranscriptModeFooter({
  showAllInTranscript,
  virtualScroll,
  searchBadge,
  suppressShowAll = false,
  status
}: TranscriptModeFooterProps): ReactNode {
  const $ = _c(9);
  const toggleShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  const showAllShortcut = useShortcutDisplay("transcript:toggleShowAll", "Transcript", "ctrl+e");
  const t2 = searchBadge ? " \xB7 n/N to navigate" : virtualScroll ? ` · ${figures.arrowUp}${figures.arrowDown} scroll · home/end top/bottom` : suppressShowAll ? "" : ` · ${showAllShortcut} to ${showAllInTranscript ? "collapse" : "show all"}`;
  let t3;
  if ($[0] !== t2 || $[1] !== toggleShortcut) {
    t3 = <Text dimColor={true}>Showing detailed transcript · {toggleShortcut} to toggle{t2}</Text>;
    $[0] = t2;
    $[1] = toggleShortcut;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] !== searchBadge || $[4] !== status) {
    t4 = status ? <><Box flexGrow={1} /><Text>{status} </Text></> : searchBadge ? <><Box flexGrow={1} /><Text dimColor={true}>{searchBadge.current}/{searchBadge.count}{"  "}</Text></> : null;
    $[3] = searchBadge;
    $[4] = status;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== t3 || $[7] !== t4) {
    t5 = <Box noSelect={true} alignItems="center" alignSelf="center" borderTopDimColor={true} borderBottom={false} borderLeft={false} borderRight={false} borderStyle="single" marginTop={1} paddingLeft={2} width="100%">{t3}{t4}</Box>;
    $[6] = t3;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  return t5;
}