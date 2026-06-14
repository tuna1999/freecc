# Searchable Model Picker + Onboarding Provider Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model selection in `/provider` searchable, and give first-run onboarding a provider+model step — so a user who picks "Anthropic-compatible → base URL → API key → model" actually sees a fetched, searchable model list instead of a dead-end.

**Architecture:** A new `ModelSearchPicker` wraps the existing `FuzzyPicker<string>` (caller-owned filtering, windowed) and bakes in a multi-word-substring filter, replacing the plain `Select` at the four `/provider` model-select steps. A new `OnboardingProviderStep` adapter renders the existing (newly-exported) `ProviderPickerWrapper` inside onboarding, adapting the command-style `onDone(result, options)` callback to onboarding's `onDone(): void`. No changes to the fetch helper or state machine.

**Tech Stack:** TypeScript, React (Ink, React-Compiler output), `bun:test`. Existing components: `src/components/design-system/FuzzyPicker.tsx`, `src/commands/provider/{fetchModels,planProviderSwitch,useProviderSetupWizard}`.

**Spec:** `docs/superpowers/specs/2026-06-14-searchable-model-picker-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/commands/provider/filterModels.ts` | **NEW** | Pure `filterModels(models, query)` — multi-word substring filter. Domain-agnostic, fully unit-testable. |
| `src/commands/provider/filterModels.test.ts` | **NEW** | Unit tests for `filterModels`. |
| `src/commands/provider/ModelSearchPicker.tsx` | **NEW** | `FuzzyPicker<string>` wrapper; owns `query` state + `useMemo(filtered)`; renders model list with match count. |
| `src/commands/provider/provider.tsx` | **MODIFY** | (a) Export `ProviderPickerWrapper`. (b) Replace the 4 `<Select>` model-select blocks with `<ModelSearchPicker>`. (c) Expand the 2 compat error messages. |
| `src/commands/provider/OnboardingProviderStep.tsx` | **NEW** | Adapter: renders `ProviderPickerWrapper`, maps `onDone(result, options)` → onboarding `onDone()`. |
| `src/components/Onboarding.tsx` | **MODIFY** | Add conditional `provider` step (after `theme`, before `security`); gate on "no config". |

**Why split `filterModels` from `ModelSearchPicker`:** the filter is pure logic with many edge cases (empty query, multi-token, slashes/hyphens, case). Isolating it gives fast, exhaustive tests with no React/Ink setup — the same reason `planProviderSwitch` was split from `applyProviderSwitch` (see `planProviderSwitch.ts` header comment). `ModelSearchPicker` stays a thin presentational wrapper.

---

## Task 1: Pure filter function (`filterModels`)

**Files:**
- Create: `src/commands/provider/filterModels.ts`
- Create: `src/commands/provider/filterModels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/commands/provider/filterModels.test.ts`:

```ts
/**
 * Tests for filterModels — the multi-word substring filter used by
 * ModelSearchPicker. An id matches iff every whitespace-separated token
 * in the query is a case-insensitive substring of the id.
 */
import { describe, it, expect } from 'bun:test'
import { filterModels } from './filterModels.js'

describe('filterModels', () => {
  const MODELS = [
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-8',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-coder-32b',
  ]

  it('returns all models for an empty query', () => {
    expect(filterModels(MODELS, '')).toEqual(MODELS)
    expect(filterModels(MODELS, '   ')).toEqual(MODELS)
  })

  it('filters by a single token, case-insensitive substring', () => {
    expect(filterModels(MODELS, 'sonnet')).toEqual(['anthropic/claude-sonnet-4-6'])
    expect(filterModels(MODELS, 'GPT')).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
    ])
  })

  it('ANDs multiple tokens (every token must match)', () => {
    // "sonnet 4" matches only the model containing both "sonnet" and "4"
    expect(filterModels(MODELS, 'sonnet 4')).toEqual(['anthropic/claude-sonnet-4-6'])
    // "openai mini" narrows to one
    expect(filterModels(MODELS, 'openai mini')).toEqual(['openai/gpt-4o-mini'])
  })

  it('returns an empty array when no id matches all tokens', () => {
    expect(filterModels(MODELS, 'sonnet gemini')).toEqual([])
    expect(filterModels(MODELS, 'zzz')).toEqual([])
  })

  it('preserves input order (no re-sorting)', () => {
    const order = ['c-model', 'a-model', 'b-model']
    expect(filterModels(order, 'model')).toEqual(order)
  })

  it('handles tokens with no id containing them among a mixed set', () => {
    expect(filterModels(MODELS, 'deepseek coder')).toEqual([])
    // 'coder' only exists in qwen, 'deepseek' only in deepseek — AND excludes both
    expect(filterModels(MODELS, 'qwen coder')).toEqual(['qwen/qwen-2.5-coder-32b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/commands/provider/filterModels.test.ts`
Expected: FAIL — `Cannot find module './filterModels.js'` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/commands/provider/filterModels.ts`:

```ts
/**
 * Multi-word substring filter for model id lists.
 *
 * Splits the query on whitespace into tokens; an id matches iff EVERY token
 * is a case-insensitive substring of the id. Empty/whitespace query returns
 * all ids unchanged. The returned list preserves input order (the caller's
 * list is already sorted alphabetically by fetchModelsFromBaseUrl).
 *
 * Extracted as a pure function so the filter is unit-testable in isolation
 * (no React/Ink) — same rationale as planProviderSwitch.
 */
export function filterModels(models: readonly string[], query: string): string[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return [...models]
  return models.filter(id => {
    const lower = id.toLowerCase()
    return tokens.every(tok => lower.includes(tok))
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/commands/provider/filterModels.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/provider/filterModels.ts src/commands/provider/filterModels.test.ts
git commit -m "feat(provider): add pure filterModels multi-word substring filter"
```

---

## Task 2: `ModelSearchPicker` component

**Files:**
- Create: `src/commands/provider/ModelSearchPicker.tsx`

This component is a thin wrapper; its behaviour is driven by `FuzzyPicker` (already battle-tested by GlobalSearch/QuickOpen). There is no unit test for the component itself — the filter is tested in Task 1, and the integration is verified by manual smoke + type-check. (Ink component testing requires heavy harness setup not present in this repo; follow the repo's existing convention of testing pure helpers, not Ink components.)

- [ ] **Step 1: Create the component**

Create `src/commands/provider/ModelSearchPicker.tsx`:

```tsx
/**
 * Searchable, windowed picker for a list of model ids.
 *
 * Wraps the generic FuzzyPicker<string> with the model-list domain: it owns
 * the query state and re-filters the model list on each keystroke via the
 * pure filterModels helper (multi-word substring). Callers pass the raw
 * fetched list and get onSelect(id) / onCancel() callbacks — mirroring the
 * Select API it replaces, so the four /provider flows don't repeat filter
 * logic.
 *
 * FuzzyPicker is caller-owned-filtering: it calls onQueryChange(query) and
 * we pass back the filtered items. This wrapper owns that filtering.
 */
import * as React from 'react'
import { FuzzyPicker } from '../../components/design-system/FuzzyPicker.js'
import { Text } from '../../ink.js'
import { filterModels } from './filterModels.js'

type Props = {
  /** Full fetched model id list (unfiltered). */
  models: Array<{ id: string }> | string[]
  title?: string
  onSelect: (modelId: string) => void
  onCancel: () => void
  /** Shown when the filtered list is empty (default: "No models match"). */
  emptyMessage?: string
}

export function ModelSearchPicker({
  models,
  title = 'Select Model',
  onSelect,
  onCancel,
  emptyMessage = 'No models match',
}: Props): React.ReactNode {
  // Normalise to a plain id string list — callers today pass { id } objects
  // (the wizard's state shape), but string[] is also accepted for flexibility.
  const ids: string[] = React.useMemo(
    () => models.map(m => (typeof m === 'string' ? m : m.id)),
    [models],
  )

  const [query, setQuery] = React.useState('')
  const filtered = React.useMemo(() => filterModels(ids, query), [ids, query])

  const matchLabel =
    query.trim().length > 0 ? `${filtered.length} / ${ids.length} models` : undefined

  return (
    <FuzzyPicker<string>
      title={title}
      placeholder="Type to search models…"
      items={filtered}
      getKey={id => id}
      renderItem={(id, isFocused) => (
        <Text color={isFocused ? 'suggestion' : undefined}>{id}</Text>
      )}
      onQueryChange={setQuery}
      onSelect={id => onSelect(id)}
      onCancel={onCancel}
      emptyMessage={q => (q ? emptyMessage : 'No models available')}
      matchLabel={matchLabel}
      selectAction="select"
    />
  )
}
```

- [ ] **Step 2: Type-check the new file**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ModelSearchPicker" || echo "NO_ERRORS_IN_PICKER"`
Expected: `NO_ERRORS_IN_PICKER` (the file compiles; if other unrelated errors exist in the repo they won't match the grep).

- [ ] **Step 3: Commit**

```bash
git add src/commands/provider/ModelSearchPicker.tsx
git commit -m "feat(provider): add ModelSearchPicker wrapping FuzzyPicker"
```

---

## Task 3: Export `ProviderPickerWrapper` + wire `ModelSearchPicker` into the 4 `/provider` flows

This is one logical change but touches 4 near-identical sites in `provider.tsx`. Do all four edits, then type-check once, then commit. The export is needed first so `OnboardingProviderStep` (Task 4) can import it.

**Files:**
- Modify: `src/commands/provider/provider.tsx`
  - Add `export` to `ProviderPickerWrapper` (line ~1031)
  - Add `ModelSearchPicker` import (line ~20, near the `fetchModelsFromBaseUrl` import)
  - Replace 4 `<Select>` blocks (OpenAI ~455, OpenAI-compat ~590, OpenRouter ~724, Anthropic-compat ~983)
  - Expand 2 compat error messages (OpenAI-compat ~605-606, Anthropic-compat ~998-999)

- [ ] **Step 1: Export `ProviderPickerWrapper`**

In `src/commands/provider/provider.tsx`, change the function declaration at line ~1031:

```tsx
// BEFORE
function ProviderPickerWrapper({
  onDone,
  context,
}: {
```
```tsx
// AFTER
export function ProviderPickerWrapper({
  onDone,
  context,
}: {
```

- [ ] **Step 2: Add the `ModelSearchPicker` import**

Add this line immediately after the existing `fetchModelsFromBaseUrl` import (line 20):

```tsx
import { ModelSearchPicker } from './ModelSearchPicker.js'
```

- [ ] **Step 3: Replace the OpenAI-direct model-select `<Select>`**

In `OpenAIApiKeySetup`, replace the `model-select` return block (lines ~451-460):

```tsx
  // model-select step
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select Model</Text>
      <Text dimColor>Choose the model to use with this API:</Text>
      <Select
        options={models.map(m => ({ label: m.id, value: m.id }))}
        onChange={(modelId: string) => saveAndDone(modelId)}
      />
    </Box>
  )
```
with:

```tsx
  // model-select step
  return (
    <ModelSearchPicker
      models={models}
      onSelect={(modelId: string) => saveAndDone(modelId)}
      onCancel={() => setStep('base-url')}
    />
  )
```

> Note: OpenAI-direct's previous flow had no `onCancel` on its `Select` (it couldn't go back). Going back to `base-url` is the correct prior step (its step order is `api-key → base-url → loading → model-select`). `setStep` is already destructured in this component (line 348).

- [ ] **Step 4: Replace the OpenAI-compat model-select `<Select>`**

In `OpenAICompatSetup`, replace the `model-select` return block (lines ~585-596):

```tsx
  if (step === 'model-select') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Select Model</Text>
        <Text dimColor>Choose the model to use with this provider:</Text>
        <Select
          options={models.map(m => ({ label: m.id, value: m.id }))}
          onChange={(modelId: string) => saveAndDone(modelId)}
          onCancel={() => setStep('api-key')}
        />
      </Box>
    )
  }
```
with:

```tsx
  if (step === 'model-select') {
    return (
      <ModelSearchPicker
        models={models}
        onSelect={(modelId: string) => saveAndDone(modelId)}
        onCancel={() => setStep('api-key')}
      />
    )
  }
```

- [ ] **Step 5: Expand the OpenAI-compat manual-fallback error message**

In the same `OpenAICompatSetup`, the `model` (manual) step error block (lines ~603-607) currently reads:

```tsx
      {fetchError ? (
        <Box flexDirection="column">
          <Text color="yellow">Could not auto-detect models:</Text>
          <Text color="yellow">{fetchError}</Text>
        </Box>
      ) : (
```

Replace with (adds a retry hint; `fetchError` already carries the tried paths + statuses):

```tsx
      {fetchError ? (
        <Box flexDirection="column">
          <Text color="yellow">Could not auto-detect models:</Text>
          <Text color="yellow">{fetchError}</Text>
          <Text dimColor>Press Esc to go back and correct the base URL / API key.</Text>
        </Box>
      ) : (
```

- [ ] **Step 6: Replace the OpenRouter model-select `<Select>`**

In `OpenRouterApiKeySetup`, the final return block (lines ~720-729) is the implicit `model-select` step. Replace:

```tsx
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select Model</Text>
      <Text dimColor>Choose the model to use with OpenRouter:</Text>
      <Select
        options={models.map(m => ({ label: m.id, value: m.id }))}
        onChange={(modelId: string) => saveAndDone(modelId)}
      />
    </Box>
  )
}
```
with:

```tsx
  return (
    <ModelSearchPicker
      models={models}
      title="Select OpenRouter Model"
      onSelect={(modelId: string) => saveAndDone(modelId)}
      onCancel={() => setStep('api-key')}
    />
  )
}
```

> Note: OpenRouter's `Select` previously had no `onCancel`. `setStep('api-key')` is the correct prior step; `setStep` is destructured in this component. If `setStep` is NOT in OpenRouter's destructure list, add it from `wiz` — verify by checking the `const { … } = wiz` line in `OpenRouterApiKeySetup` (around line 647-660). The wizard exposes `setStep` (see `useProviderSetupWizard.ts:41`).

- [ ] **Step 7: Replace the Anthropic-compat model-select `<Select>`**

In `AnthropicCompatApiKeySetup`, replace the `model-select` return block (lines ~978-990):

```tsx
  if (step === 'model-select') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Select Model</Text>
        <Text dimColor>Choose the model to use with this provider:</Text>
        <Select
          options={models.map(m => ({ label: m.id, value: m.id }))}
          onChange={(modelId: string) => saveAndDone(modelId)}
          onCancel={() => setStep('api-key')}
        />
      </Box>
    )
  }
```
with:

```tsx
  if (step === 'model-select') {
    return (
      <ModelSearchPicker
        models={models}
        onSelect={(modelId: string) => saveAndDone(modelId)}
        onCancel={() => setStep('api-key')}
      />
    )
  }
```

- [ ] **Step 8: Expand the Anthropic-compat manual-fallback error message**

In the same component, the `model` step error block (lines ~996-1000):

```tsx
      {fetchError ? (
        <Box flexDirection="column">
          <Text color="yellow">Could not auto-detect models (tried /models, /v1/models):</Text>
          <Text color="yellow">{fetchError}</Text>
        </Box>
      ) : (
```

Replace with:

```tsx
      {fetchError ? (
        <Box flexDirection="column">
          <Text color="yellow">Could not auto-detect models:</Text>
          <Text color="yellow">{fetchError}</Text>
          <Text dimColor>Press Esc to go back and correct the base URL / API key.</Text>
        </Box>
      ) : (
```

> The `fetchError` string already includes the tried paths and HTTP statuses (e.g. `"/v1/models → HTTP 401"`), so the "(tried /models, /v1/models)" prefix is now redundant — removing it avoids duplicating info.

- [ ] **Step 9: Verify `Select` import is still needed**

Run a grep to confirm `Select` is still used elsewhere in `provider.tsx` (the top-level provider picker at line ~1191 still uses it):

Run: `grep -n "<Select" src/commands/provider/provider.tsx`
Expected: at least one remaining match (the `ProviderPickerWrapper` provider-list `Select`). If zero matches remain, remove the now-unused `import { Select } from '../../components/CustomSelect/select.js'` (line 5). If matches remain, leave the import.

- [ ] **Step 10: Type-check**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "provider\.tsx" || echo "NO_ERRORS_IN_PROVIDER_TSX"`
Expected: `NO_ERRORS_IN_PROVIDER_TSX`.

- [ ] **Step 11: Run existing provider tests to confirm no regression**

Run: `bun test src/commands/provider/`
Expected: PASS — all existing tests (`fetchModels.test.ts`, `planProviderSwitch.test.ts`, `filterModels.test.ts`) green. (These test pure helpers, not the JSX, so they should be unaffected.)

- [ ] **Step 12: Commit**

```bash
git add src/commands/provider/provider.tsx
git commit -m "feat(provider): replace Select with searchable ModelSearchPicker in all flows"
```

---

## Task 4: `OnboardingProviderStep` adapter

**Files:**
- Create: `src/commands/provider/OnboardingProviderStep.tsx`

- [ ] **Step 1: Read `ProviderPickerWrapper`'s `context` usage to confirm the adapter shape**

Run: `grep -n "context\." src/commands/provider/provider.tsx`
Expected: confirm the only `context.*` read inside `ProviderPickerWrapper` and the setup components it renders is `context.onChangeAPIKey` (passed through at lines ~1128, ~1138). If any other `context.*` field is read, note it here — the adapter must provide it.

This is a read-only verification step; no edit. Record the finding: the adapter's synthesized context only needs `onChangeAPIKey` (plus the type's required fields, satisfied by casting).

- [ ] **Step 2: Create the adapter component**

Create `src/commands/provider/OnboardingProviderStep.tsx`:

```tsx
/**
 * Adapter that runs the /provider wizard (ProviderPickerWrapper) inside
 * first-run onboarding.
 *
 * The wizard's components take onDone: LocalJSXCommandOnDone =
 * (result?, options?) => void and a context: LocalJSXCommandContext.
 * Onboarding only has onDone(): void. This adapter bridges the two:
 *  - It synthesises a minimal context (only onChangeAPIKey is read by the
 *    wizard; the rest of the LocalJSXCommandContext type is satisfied by a
 *    cast — the wizard never reads it).
 *  - It forwards the wizard's onDone(result, options) to onboarding's
 *    onDone(), dropping the args: the provider switch already persisted
 *    config and printed its own message via applyProviderSwitch.
 *
 * Why an adapter instead of refactoring the wizard's signature: changing
 * onDone's type would ripple through the /provider command path and its
 * tests. Keeping the seam in one new file isolates the change.
 */
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { ProviderPickerWrapper } from './provider.js'

type Props = {
  /** Onboarding's advance callback (no args). */
  onAdvance: () => void
}

export function OnboardingProviderStep({ onAdvance }: Props): React.ReactNode {
  const adaptOnDone: LocalJSXCommandOnDone = () => {
    onAdvance()
  }

  // The wizard only reads context.onChangeAPIKey. A no-op is correct here:
  // onboarding has no existing API-key-change side effect to trigger, and
  // the wizard persists its own config via applyProviderSwitch.
  const context = {
    onChangeAPIKey: () => {},
  } as unknown as LocalJSXCommandContext

  return <ProviderPickerWrapper onDone={adaptOnDone} context={context} />
}
```

- [ ] **Step 3: Confirm the import path for the types**

Run: `grep -n "export type LocalJSXCommandOnDone\|type LocalJSXCommandOnDone" src/types/command.ts`
Expected: a match. If `LocalJSXCommandOnDone` is NOT exported from `src/types/command.ts`, find where it IS defined and import from there instead. (It is referenced as a type in `provider.tsx` line 3 imports `CommandResultDisplay` from `../../commands.js` — check whether `LocalJSXCommandOnDone` comes from `../../commands.js` or `../../types/command.js` by running: `grep -rn "LocalJSXCommandOnDone" src/types/ src/commands.ts`.) Adjust the import in Step 2's file to the correct source.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "OnboardingProviderStep" || echo "NO_ERRORS_IN_ADAPTER"`
Expected: `NO_ERRORS_IN_ADAPTER`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/provider/OnboardingProviderStep.tsx
git commit -m "feat(provider): add OnboardingProviderStep adapter for first-run"
```

---

## Task 5: Wire the provider step into `Onboarding.tsx`

`Onboarding.tsx` is React Compiler output. Per `CLAUDE.md`, the safe edit pattern is to add a new `const providerStep = <.../>` node and a `steps.push(...)` call — mirroring `themeStep`/`securityStep`. Do NOT touch the compiled `useCallback`/`useMemo` internals.

**Files:**
- Modify: `src/components/Onboarding.tsx`

- [ ] **Step 1: Add imports for the adapter and config check**

At the top of `src/components/Onboarding.tsx`, after the existing `import { OnboardingProviderStep } ...` — actually add these two imports near the other component imports (after line 15, near `ApproveApiKey`):

```tsx
import { OnboardingProviderStep } from '../commands/provider/OnboardingProviderStep.js'
```

And near the config import (line 10, after `getCustomApiKeyStatus`):

```tsx
import { getGlobalConfig } from '../utils/config.js'
```

> If `getGlobalConfig` is already imported, skip that line. Check with: `grep -n "getGlobalConfig" src/components/Onboarding.tsx`.

- [ ] **Step 2: Add the "no provider configured" gate**

After the `apiKeyNeedingApproval` useMemo block (lines ~98-109), add a new `useMemo` that computes whether onboarding should offer the provider step. Insert immediately before `function handleApiKeyDone`:

```tsx
  const shouldOfferProviderStep = useMemo(() => {
    // Only offer the provider/model step when NOTHING is configured yet:
    // no ANTHROPIC_API_KEY env, no OAuth, and no custom provider config.
    if (process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()) return false
    if (!oauthEnabled) {
      // OAuth disabled means first-party login isn't an option at all in
      // this build — but if a custom provider is already set, skip too.
    }
    const cfg = getGlobalConfig()
    const hasCustomProvider =
      !!cfg.openaiApiKey ||
      !!cfg.openaiBaseUrl ||
      !!cfg.anthropicCompatApiKey ||
      !!cfg.anthropicCompatBaseUrl ||
      !!cfg.openrouterApiKey
    if (hasCustomProvider) return false
    // If OAuth is enabled AND the user has a valid token, they're set up.
    // hasAnthropicApiKeyAuth covers the env-key case; OAuth token presence
    // is checked via hasProviderCredentials('firstParty') but that lives in
    // provider.tsx — keep the check here minimal: env key absence + no
    // custom provider is enough to offer the step.
    return !process.env.ANTHROPIC_API_KEY
  }, [oauthEnabled])
```

> The double `if (!process.env.ANTHROPIC_API_KEY)` / final return is intentional and resolves to: offer iff no env key AND no custom provider. (The intermediate `if (!oauthEnabled)` block is a no-op placeholder kept so the logic reads top-down; it can be simplified to a single boolean expression if preferred — but the explicit early-returns are clearer for the onboarding author.) If lint complains about the empty `if` body, replace lines 4-6 of the block with a comment-only body or collapse to the single return.

- [ ] **Step 3: Define the provider step node**

Near `themeStep` / `securityStep` definitions (after `const preflightStep = …` line ~96), add:

```tsx
  const providerStep = (
    <Box flexDirection="column" marginTop={1}>
      <OnboardingProviderStep onAdvance={goToNextStep} />
    </Box>
  )
```

> `Box` and `goToNextStep` are both in scope already (Box imported line 6; goToNextStep defined line 42).

- [ ] **Step 4: Push the step into the steps array, after `theme` and before `security`**

In the `steps` assembly (lines ~116-145), the current order is: `[preflight?] → theme → [api-key?] → [oauth?] → security → [terminal-setup?]`. Insert the provider step right after the `theme` push (after line ~126) and before the `apiKeyNeedingApproval` push:

```tsx
  steps.push({
    id: 'theme',
    component: themeStep
  })
  if (shouldOfferProviderStep) {
    steps.push({
      id: 'provider',
      component: providerStep
    })
  }
  if (apiKeyNeedingApproval) {
```

- [ ] **Step 5: Extend the `StepId` type**

The `StepId` union (line 22) must include `'provider'`. Change:

```tsx
type StepId = 'preflight' | 'theme' | 'oauth' | 'api-key' | 'security' | 'terminal-setup';
```
to:

```tsx
type StepId = 'preflight' | 'theme' | 'provider' | 'oauth' | 'api-key' | 'security' | 'terminal-setup';
```

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "Onboarding.tsx" || echo "NO_ERRORS_IN_ONBOARDING"`
Expected: `NO_ERRORS_IN_ONBOARDING`.

- [ ] **Step 7: Commit**

```bash
git add src/components/Onboarding.tsx
git commit -m "feat(onboarding): offer provider+model step when nothing is configured"
```

---

## Task 6: Build verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: no errors in any file touched by this plan (provider.tsx, Onboarding.tsx, the 4 new files). Pre-existing unrelated errors elsewhere are acceptable — only confirm none point at our files.

- [ ] **Step 2: Full provider test suite**

Run: `bun test src/commands/provider/`
Expected: PASS — `filterModels.test.ts` (6), `fetchModels.test.ts` (9), `planProviderSwitch.test.ts` (15), all green.

- [ ] **Step 3: Dev build compiles**

Run: `bun run build:dev`
Expected: completes without error, produces `./freecc-dev`.

- [ ] **Step 4: Manual smoke — searchable picker in `/provider`**

Run `./freecc-dev` (or `bun run dev`), then:
1. Type `/provider` → choose "Anthropic-compatible".
2. Enter a base URL with a `/models` endpoint (e.g. a local LiteLLM/Ollama proxy, or `https://openrouter.ai/api/v1` with a key for OpenRouter).
3. Enter API key.
4. **Verify:** a searchable model list appears (not a plain arrow-key `Select`).
5. **Verify:** typing a partial model name (e.g. "sonnet") filters the list live; the match count "N / M models" shows below.
6. **Verify:** Enter selects; Esc goes back to the API-key step.
7. **Verify:** pointing at a bogus URL shows the expanded error ("Could not auto-detect models: <path> → HTTP <status>" + the "Press Esc…" hint) rather than a terse one-liner.

- [ ] **Step 5: Manual smoke — onboarding step**

In a clean config (temporarily move/rename the onboarding-completed flag, or test in a fresh checkout / `--worktree`), run `./freecc-dev`:
1. **Verify:** onboarding shows a provider step after the theme step (only if no API key / OAuth / custom provider is set).
2. Choose Anthropic-compatible → base URL → key → model. **Verify:** it uses the searchable picker.
3. On completion, **verify:** onboarding advances to the security step and the REPL starts with the chosen provider/model.

> If testing onboarding is impractical to set up (requires clearing `hasCompletedOnboarding`), at minimum confirm via the Step 1-2 type-check and build that the wiring is sound, and rely on the `/provider` smoke (Step 4) for behavioural confidence.

- [ ] **Step 6: Final commit (if any smoke-test fixups were made)**

```bash
git add -A
git commit -m "fix: smoke-test adjustments for model picker" || echo "nothing to commit"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Spec goal 1 (onboarding provider+model step) → Tasks 4 + 5. ✅
- Spec goal 2 (searchable picker in all 4 flows) → Tasks 2 + 3. ✅
- Spec goal 3 / fetch-failure visibility (expanded error message, no state-machine restructure) → Task 3 Steps 5 + 8. ✅
- Spec "only when not configured" gate → Task 5 Step 2. ✅
- Spec filter algorithm (multi-word substring) → Task 1. ✅
- Spec non-goals (no extractModelIds change, no fetch-trigger standardization, no AbortController, no integration tests) → respected; none appear in tasks. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases" in steps. Task 4 Step 1 and Task 4 Step 3 are *verification* steps with concrete grep commands, not placeholders — they resolve a real uncertainty (the exact `context` fields read) without guessing in the plan. Task 5 Step 2 has one note about a potential empty-if-body lint, with a concrete fallback.

**Type consistency:** `filterModels(models: readonly string[], query: string)` (Task 1) matches its call in `ModelSearchPicker` (Task 2) `filterModels(ids, query)`. `ModelSearchPicker`'s `onSelect(id)` / `onCancel()` match the 4 call sites in Task 3. `OnboardingProviderStep`'s `onAdvance: () => void` matches onboarding's `goToNextStep` (Task 5 Step 3). `ProviderPickerWrapper` is exported in Task 3 Step 1 before being imported in Task 4 Step 2.

**Risk noted:** Task 5 Step 2's `shouldOfferProviderStep` has a slightly awkward double-condition. It is functionally correct (offer iff no env key AND no custom provider) but could be simplified. Left as-is for clarity with a documented fallback; not a correctness issue.
