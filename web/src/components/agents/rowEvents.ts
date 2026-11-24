// One click and one key handler per list of rows (Agents, Earlier agents, Previous orchestrators).
// Buttons inside a row say what they do with data attributes; anything else on a row opens its breakdown.
import { deck } from '../../data/store'

export function onRowClick(e: React.MouseEvent) {
  const t = e.target as Element
  const save = t.closest<HTMLElement>('[data-save]')
  if (save) return deck.save(save.dataset.save!)
  const resolve = t.closest<HTMLElement>('[data-resolve]')
  if (resolve) return deck.resolve(resolve.dataset.resolveSession!, resolve.dataset.resolve!)
  if (t.closest('.act') || t.closest('[data-vote]') || t.closest('.ball')) return
  const view = t.closest<HTMLElement>('[data-view]')
  if (view) return deck.view(view.dataset.view!)
  const more = t.closest<HTMLElement>('[data-more]')
  if (more) return deck.toggleBrief(more.dataset.more!)
  const fold = t.closest<HTMLElement>('[data-toggle]')
  if (fold) return deck.toggleFold(fold.dataset.toggle!)
  const row = t.closest<HTMLElement>('[data-run]')
  if (row && row.dataset.run!.startsWith('project:')) return deck.toggleFold(row.dataset.run!)
  if (row) deck.toggleDetail(row.dataset.run!)
}

// Enter/Space open a row, arrows move between rows, Right/Left unfold/fold a parent.
export function onRowKey(e: React.KeyboardEvent) {
  const row = e.target as HTMLElement
  if (!row.matches?.('[data-run]')) return // keys on the buttons inside a row keep their own job
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-run]')]
  const i = rows.indexOf(row)
  if (e.key === 'Enter' || e.key === ' ') deck.toggleDetail(row.dataset.run!)
  else if (e.key === 'ArrowDown') rows[i + 1]?.focus()
  else if (e.key === 'ArrowUp') rows[i - 1]?.focus()
  else if (e.key === 'ArrowRight' && row.classList.contains('parent')) deck.toggleFold(row.dataset.run!, true)
  else if (e.key === 'ArrowLeft' && row.classList.contains('parent')) deck.toggleFold(row.dataset.run!, false)
  else return
  e.preventDefault()
}
