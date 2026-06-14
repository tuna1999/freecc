# TypeScript strictness migration notes

This document tracks the deliberate decision to keep
`strict: false` (and especially `noImplicitAny: false`) in
`tsconfig.json`, and the path to enable them incrementally.

## Why strict is off today

Flipping `noImplicitAny: true` in this codebase surfaces ~7,950
type errors. Categorised:

| Category | Approx. count | Notes |
|---|---|---|
| Missing type declarations for npm packages | ~1,800 | `react/compiler-runtime`, `qrcode`, several `mcp*` and `lsp*` paths. Fix: add `@types/*` or local `.d.ts` shims. |
| Implicit any return types | ~5,100 | React components and helper functions. Fix: explicit return annotations or rely on type inference for non-exported fns. |
| Implicit any parameter types | ~800 | `useState<X | undefined>`, callbacks, etc. Fix: explicit `<X>` parameters. |
| Pre-existing 7.x SDK drift | ~250 | TypeScript 6.0+ flag deprecations (`baseUrl`, `verbatimModuleSyntax` interactions with relative `.js` imports). Fix: per-file pragma or codemod. |

The first three categories are the same kind of work — a
mechanical "annotate this thing" pass — but the volume is such
that a single context window cannot hold the full diff and
review it for correctness.

## Why we did not just do it

For a personal/localhost project the upside of strict mode is
"earlier bug detection during refactors". The downside is
"every refactor now needs to also annotate 5,000+ implicit
any sites". With zero test coverage (P6 in the plan) the
upside is the only thing keeping the work from being pure
overhead.

## Path forward

When this work is taken up, do it in this order to keep each
commit reviewable:

1. **Add missing `@types/*` packages and local `.d.ts` shims**
   for the npm packages. (Eliminates ~1,800 errors.)
2. **Enable `noImplicitAny: true`** and fix the ~5,900 remaining
   errors file-by-file. Prefer a per-file `// @ts-noImplicitAny`
   escape hatch for files that are too entangled to fix in one
   sitting.
3. **Enable `strictNullChecks: true`** separately. The existing
   `?.` / `??` patterns mean this surfaces fewer surprises than
   `noImplicitAny`.
4. **Add `bun:test` coverage (P6.2) first** so each step can be
   validated with a `bun test` run, not just `tsc --noEmit`.
