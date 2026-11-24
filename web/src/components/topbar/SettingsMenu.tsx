// Show/hide sections, folder rows in All sessions, and the light/dark switch; a hairline between each kind. Remembered in localStorage.
import { Fragment } from 'react'
import { useDeck, PREF_GROUPS } from '../../data/store'
import { isDark, setTheme } from '../../lib/theme'
import { Icon } from '../../icons/Icon'
import { Pop } from '../motion'

export function SettingsMenu() {
  const deck = useDeck()
  const open = deck.settingsOpen
  const dark = isDark()
  return <>
    <button className="setb" id="setb" aria-haspopup="menu" aria-expanded={open} aria-label="Show or hide sections"
      onClick={() => { deck.setMenu(false); deck.setSettings(!open) }}><Icon name="settings" /></button>
    <Pop open={open} className="menu smenu" role="menu">
      {PREF_GROUPS.map((group, i) => <Fragment key={i}>
        {group.map(([k, label]) => (
          <button key={k} role="menuitemcheckbox" aria-checked={deck.prefs[k]} onClick={() => deck.setPref(k, !deck.prefs[k])}>
            <span className="name">{label}</span><span className="tog" aria-hidden="true" data-on={deck.prefs[k]} />
          </button>
        ))}
        <div className="msep" role="separator" />
      </Fragment>)}
      <button role="menuitemcheckbox" aria-checked={!dark} onClick={() => { setTheme(dark ? 'light' : 'dark'); deck.render() }}>
        <span className="name">Light mode</span><span className="tog" aria-hidden="true" data-on={!dark} />
      </button>
    </Pop>
  </>
}
