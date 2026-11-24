// Show/hide sections. Remembered in localStorage.
import { useDeck, PREF_LABELS } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { Pop } from '../motion'

export function SettingsMenu() {
  const deck = useDeck()
  const open = deck.settingsOpen
  return <>
    <button className="setb" id="setb" aria-haspopup="menu" aria-expanded={open} aria-label="Show or hide sections"
      onClick={() => { deck.setMenu(false); deck.setSettings(!open) }}><Icon name="settings" /></button>
    <Pop open={open} className="menu smenu" role="menu">
      {PREF_LABELS.map(([k, label]) => (
        <button key={k} role="menuitemcheckbox" aria-checked={deck.prefs[k]} onClick={() => deck.setPref(k, !deck.prefs[k])}>
          <span className="name">{label}</span><span className="tog" aria-hidden="true" data-on={deck.prefs[k]} />
        </button>
      ))}
    </Pop>
  </>
}
