# Searchable Model Picker + Onboarding Provider Step

**Date:** 2026-06-14
**Status:** Approved (awaiting spec review)
**Scope:** B (focused) — picker searchability + onboarding re-use, no changes to fetch helper internals

## Problem

When a user starts the project for the first time and chooses Anthropic-compatible →
base URL → API key → model ID, the model ID is **not auto-fetched from the remote host**.
The user wants: (1) auto-fetch of the model list, and (2) a search/filter input in the
model picker, because the host may return many models.

An 8-agent audit (`audit-model-fetch-flows`, wf_959f2e2c) found the situation is more
nuanced than "no fetch":

| Flow | Auto-fetches? | Picker searchable? | Reality |
|------|:---:|:---:|---|
| Anthropic-compat `/provider` | ✅ | ❌ | Fetch runs (`provider.tsx:902`) but on parse failure **silently falls back** to a free-text input — indistinguishable from "no fetch". Picker is a plain `Select` (5-row window, arrow keys only). |
| OpenAI direct `/provider` | ✅ | ❌ | On fetch error, `saveAndDone(undefined)` — no message, no retry, no picker. |
| OpenAI-compat `/provider` | ✅ | ❌ | Empty key still fetches (confusing 401); failure → manual entry. |
| OpenRouter `/provider` | ✅ | ❌ | 200+ models, plain `Select` → effectively unusable. |
| **First-run / `Onboarding.tsx`** | ❌ **none** | ❌ | **No model-selection step at all.** `Onboarding.tsx` never imports `fetchModels` or the provider wizard. **This is the flow the user hit** — here "no fetch" is literally true. |

**User's confirmed experience:** the Onboarding wizard (not `/provider`).

## Goals

1. **Onboarding gains a provider + model step** that re-uses the existing `/provider`
   wizard (no duplicated logic), shown only when nothing is configured yet.
2. **Every `/provider` model-select step becomes searchable** via a reusable
   `ModelSearchPicker` wrapping the existing `FuzzyPicker`.
3. **Fetch failures stop being silent** in the affected flows: show the error and offer
   retry alongside the picker, rather than an unannounced jump to free-text.

## Non-Goals (scope B)

- **Not** broadening `extractModelIds` to more response shapes (LiteLLM/Bedrock) — scope C.
- **Not** standardizing the fetch trigger across flows (base-url vs api-key submit) — scope C.
- **Not** adding an `AbortController` timeout to the loading spinner — scope C (noted as a
  follow-up; the loading step is rare in practice since fetch is fast or fails fast).
- **Not** integration tests against live host responses — scope C.

These remain documented gaps but are deferred to keep this change focused on the user's
stated request.

## Architecture

### Component: `ModelSearchPicker` (new)

A thin, typed wrapper around `FuzzyPicker<string>` that bakes in the model-list domain:

```
src/commands/provider/ModelSearchPicker.tsx
```

**Responsibility:** render a searchable, windowed list of model IDs; call `onSelect(id)`
on Enter, `onCancel()` on Esc. Owns the multi-word substring filter (caller just passes
the raw `models: string[]`).

**Props:**
```ts
type Props = {
  models: string[]                 // full fetched list (unfiltered)
  title?: string                   // default "Select Model"
  onSelect: (modelId: string) => void
  onCancel: () => void
  emptyMessage?: string            // shown when filtered list is empty
  // matchLabel passed to FuzzyPicker must be a string; wrapper computes it
  // from (filtered.length, models.length), e.g. "12 / 240 models".
}
```

**Filter algorithm (multi-word substring):** split `query.trim()` on whitespace into
tokens; an id matches iff every token appears as a case-insensitive substring of the id.
Empty query → show all. Result order is the input order (already sorted alphabetically
by `fetchModelsFromBaseUrl`). No scoring/ranking needed.

**Internal state:** `const [query, setQuery] = useState('')`, `const filtered = useMemo(
() => filterModels(models, query), [models, query])`. The `FuzzyPicker`'s
`onQueryChange` drives `setQuery`; `items={filtered.map(id => ({ id }))}` (or pass
strings directly since `getKey` is the identity).

> `FuzzyPicker` is **caller-owned filtering** — it calls `onQueryChange(query)` on each
> keystroke and the caller re-filters and passes new `items`. This wrapper owns that
> filtering so the four call sites don't repeat it.

**Rendering:** `renderItem={(id, isFocused) => <Text color={isFocused ? 'suggestion' : undefined}>{id}</Text>}`,
`getKey={id => id}`, `onSelect={item => onSelect(item)}`, `onCancel={onCancel}`,
`visibleCount` left to FuzzyPicker default (8, capped to terminal height).

### Wiring into the four `/provider` flows

Replace the plain `<Select options={models.map(m => ({ label: m.id, value: m.id }))} .../>`
at the `model-select` step of each component with `<ModelSearchPicker .../>`:

| Component | Line (current) | Change |
|---|---|---|
| `OpenAIApiKeySetup` | `provider.tsx:455-458` | `Select` → `ModelSearchPicker` |
| `OpenAICompatSetup` | `provider.tsx:590-594` | `Select` → `ModelSearchPicker` |
| `OpenRouterApiKeySetup` | `provider.tsx:724-727` | `Select` → `ModelSearchPicker` (this flow benefits most — 200+ models) |
| `AnthropicCompatApiKeySetup` | `provider.tsx:983-987` | `Select` → `ModelSearchPicker` |

The `onChange={(modelId) => saveAndDone(modelId)}` wiring becomes
`onSelect={(modelId) => saveAndDone(modelId)}`; the `onCancel={() => setStep('api-key')}`
wiring becomes `onCancel={() => setStep('api-key')}` (same behaviour).

### Fetch-failure visibility (scope-B subset)

Current state machine (from `useProviderSetupWizard.ts`): on fetch success → `model-select`
step (shows the list); on fetch error → **`model` step** (free-text `TextInput`, a
different step from `model-select`). So the two compat flows never show a picker AND an
error at the same time today.

The minimal scope-B change keeps that step split but makes the **`model` (manual) step**
clearer: the error text already shows there (`provider.tsx:996-1000`), so we only (a)
expand the message to state **which paths were tried and their HTTP status** (the
`lastError` string already carries this — it is just rendered tersely), and (b) keep the
existing Esc-back-to-`api-key` path as the explicit "retry" affordance. **No new step, no
picker-with-error.**

The `ModelSearchPicker` therefore only renders on the **`model-select`** step (fetch
succeeded). The user's *perception* of "no fetch" is addressed by the onboarding step
fixing the literal no-fetch case, plus the searchable picker fixing the "fetched but
unusable" case. Making the manual-fallback message clearer is a small textual improvement
that helps the "fetched but failed" case.

> Why not a bigger change: turning the error path into a picker-with-retry would require
> restructuring the state machine (`applyFetchError` would need to land somewhere that also
> shows the picker), which is scope C. Scope B keeps the state machine intact.

OpenAI-direct and OpenRouter already call `saveAndDone(undefined)` on error — left as-is
(non-goal).

### Onboarding: new provider/model step

`Onboarding.tsx` gains a conditional step that re-uses the existing wizard. The wizard
components (`AnthropicCompatApiKeySetup`, `OpenAIApiKeySetup`, …, via
`ProviderPickerWrapper`) take `onDone: LocalJSXCommandOnDone` = `(result?, options?) => void`
and `context: LocalJSXCommandContext`. Onboarding passes only `onDone(): void` (see
`interactiveHelpers.tsx:117`). These signatures do **not** line up directly.

**Decision (resolved):** introduce a thin adapter component
`src/commands/provider/OnboardingProviderStep.tsx` that:

1. Renders `ProviderPickerWrapper` with a synthesized `LocalJSXCommandContext` (the real
   one is built in `commands.ts`; onboarding needs only `onChangeAPIKey: () => {}` no-op and
   whatever minimal fields the wrapper reads — confirm the exact shape at implementation
   time, but the wrapper's `context` usage is limited to `onChangeAPIKey`).
2. Adapts the wizard's `onDone(result, options)` → onboarding's `onDone()` by ignoring the
   message/options args (the provider switch already printed its own message and persisted
   config via `applyProviderSwitch`).

This avoids refactoring the wizard's callback signatures (which would ripple through the
`/provider` command path) and keeps the re-use seam in one new file. The step calls
onboarding's advance callback once the user has selected (or skipped).

**Visibility condition (per user choice "only when not configured"):** the step appears
iff **all** of:
- no `ANTHROPIC_API_KEY` env var, **and**
- no valid OAuth token (use existing `isAnthropicAuthEnabled()` / auth status check), **and**
- no existing custom provider config in `GlobalConfig` (`openaiApiKey`, `openaiBaseUrl`,
  `anthropicCompatApiKey`, `anthropicCompatBaseUrl`, `openrouterApiKey` all unset).

This mirrors how `apiKeyNeedingApproval` and `shouldOfferTerminalSetup()` gate their steps.
A user who already has *any* provider set up skips the step entirely.

**Step ordering:** inserted **after `theme`**, **before `security`** (and before
`terminal-setup`). Provider selection is more fundamental than terminal niceties, so it
sits early; it stays after theme because theme is the first "welcome" beat. (Confirmable
during implementation — low cost to move.)

> **Note:** `Onboarding.tsx` is React Compiler output. Per `CLAUDE.md`, adding a new step
> is done by defining a `const providerStep = <.../>` node and `steps.push({...})` — the
> same pattern as `themeStep`, `securityStep`. This does **not** touch compiled
> `useCallback`/`useMemo` internals, so it's safe.

## Data flow

```
[onboarding, no config detected]
  → push provider step
  → render shared provider picker (re-used from /provider)
  → user picks Anthropic-compat → base URL → API key
  → fetchModelsFromBaseUrl(/models, /v1/models)   ← EXISTING, unchanged
  → onSuccess: applyFetchedModels(sortedIds)
  → model-select step
  → ModelSearchPicker(models)
       ├─ user types query → setQuery → useMemo re-filter → FuzzyPicker shows filtered
       └─ Enter → onSelect(id) → applyProviderSwitch(...) → onboarding advance
  → (fallback) fetchError shown above picker → user enters model manually or Esc to retry
```

## Components affected

| File | Change |
|---|---|
| `src/commands/provider/ModelSearchPicker.tsx` | **NEW** — `FuzzyPicker<string>` wrapper + multi-word filter |
| `src/commands/provider/ModelSearchPicker.test.ts` | **NEW** — unit tests for the filter (pure function) |
| `src/commands/provider/provider.tsx` | Replace 4× `<Select>` with `<ModelSearchPicker>` at each `model-select` step; expand the error message on the 2 compat flows' `model` (manual) step to name tried paths + statuses |
| `src/components/Onboarding.tsx` | Add conditional `provider` step re-using the wizard via a thin adapter; visibility gate |
| `src/commands/provider/OnboardingProviderStep.tsx` | **NEW** — adapter mapping onboarding's `onDone(): void` to the wizard's `LocalJSXCommandOnDone` callback shape |

## Error handling

- **Fetch fails (existing `onError` → `model` manual step):** transport behaviour
  unchanged; the manual-fallback step keeps the free-text `TextInput`. The only change is
  the error message is expanded to name the paths tried + HTTP statuses (the `lastError`
  string already carries these — just rendered more verbosely). No new error states, no
  restructured state machine.
- **Empty query / no matches:** `ModelSearchPicker` shows `emptyMessage` (default
  "No models match") via `FuzzyPicker`'s `emptyMessage` prop; `matchLabel` shows
  "N / M models" so the user knows the full list size.
- **Esc at picker:** `onCancel` → back to `api-key` step (same as today); from onboarding
  provider step → skip step (treated as "configure later via /provider").

## Testing

- **Unit (pure, fast):** `filterModels(models, query)` — multi-word substring:
  - empty query → all models
  - single token → case-insensitive substring
  - multiple tokens → AND
  - tokens with no match → empty array
  - hyphenated / slash model ids (`anthropic/claude-sonnet-4-6`)
- **Existing tests stay green:** `fetchModels.test.ts` (9 tests), `planProviderSwitch.test.ts`
  (15 tests) — neither file changes.
- **Manual smoke (not automated in scope B):** onboarding with no config → provider step
  appears; pick Anthropic-compat → enter a real base URL + key → searchable list appears.

## Open questions for implementation

1. ~~Exact re-use seam~~ → **RESOLVED**: thin adapter `OnboardingProviderStep.tsx` rendering
   `ProviderPickerWrapper` (see Onboarding section). Implementation must confirm the exact
   `LocalJSXCommandContext` fields the wrapper reads beyond `onChangeAPIKey`.
2. Step ordering (after theme, before security) — confirmable cheaply during implementation.
3. Whether OpenAI-direct and OpenRouter's `saveAndDone(undefined)` error path should also
   gain visibility in a follow-up (out of scope B; flagged).

## Follow-ups (scope C, deferred)

- Broaden `extractModelIds` for LiteLLM / Bedrock / proxy shapes.
- Standardize fetch trigger (single "detect models" action) across the 4 flows.
- `AbortController` timeout + Esc on the loading spinner.
- Integration tests: representative host response → populated picker.
