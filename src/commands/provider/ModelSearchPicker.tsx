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
