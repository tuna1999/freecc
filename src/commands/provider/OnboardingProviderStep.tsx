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
 *    onAdvance(), dropping the args: the provider switch already persisted
 *    config and printed its own message via applyProviderSwitch.
 *
 * Why an adapter instead of refactoring the wizard's signature: changing
 * onDone's type would ripple through the /provider command path and its
 * tests. Keeping the seam in one new file isolates the change.
 */
import * as React from 'react'
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
