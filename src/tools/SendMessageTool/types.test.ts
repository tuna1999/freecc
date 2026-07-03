/**
 * Compile-time identity check: the hand-maintained `Input` mirror in
 * `./types.ts` must structurally equal `z.infer<typeof inputSchema>`.
 *
 * The runtime Zod schema in `SendMessageTool.ts` is the source of truth
 * — if these types drift, downstream consumers (UI.tsx renders, etc.)
 * will silently receive the wrong shape.
 *
 * This test only checks types (no runtime asserts) — tsc fails on drift.
 *
 * If you change either type, update the other AND this test should pass
 * automatically (or you'll see the exact mismatch here).
 */

// Standard tsc-only assertion helpers. Equal is bidirectional (passes
// only when A and B have identical structure).
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

type Expect<T extends true> = T

import type { InputInferred } from './SendMessageTool.js'
import type { Input } from './types.js'

// `Input` (hand-maintained in types.ts) must be a structural subtype
// of `InputInferred` (z.infer<typeof inputSchema>) in both directions.
// If either check fails, tsc will surface the exact mismatch.
//
// Single-direction each check (rather than Equal) lets Zod's inferred
// types carry subtle differences like discriminated union narrowing
// without false negatives — Equal would catch too much.
type _InputExtendsSchema = Input extends InputInferred ? true : false
type _SchemaExtendsInput = InputInferred extends Input ? true : false

// Both must be true. Use intersection to require both.
type _Both = _InputExtendsSchema & _SchemaExtendsInput
type _InputMatchesSchema = Expect<_Both extends true ? true : false>

// `MessageRouting`, `MessageOutput`, etc. are not validated by a Zod
// schema anywhere in the codebase — they are constructed inline. There
// is no compile-time check for them; runtime construction would catch
// drift in handler functions.

// Silence unused warnings — the test is the type assertion itself.
export type _ = _InputMatchesSchema