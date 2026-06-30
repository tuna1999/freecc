/**
 * Returns the median of a numeric array. For an empty array returns NaN.
 * For even-length arrays returns the arithmetic mean of the two middle values.
 * Extracted from REPL.tsx in the mid-elegance refactor.
 */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}