// Top bar: back button (inside a helper's session), session switcher + menu, settings menu, weekly ring.
import { useEffect, useRef } from 'react'
import { useDeck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { sessionName } from '../../lib/sessions'
import type { Session } from '../../lib/types'
import { Fold, Pop, Rows } from '../motion'
import { SessionLimit, UsageRings } from './Limits'
import { SettingsMenu } from './SettingsMenu'

// A session is Working (something is running), Idle (open, waiting on you) or Closed: [dot class, word].
const stateOf = (s?: Session | null): [string, string] => !s ? ['idle', ''] : !s.isLive ? ['idle', 'Closed'] : (s.working ?? 0) > 0 ? ['working', 'Working'] : ['live', 'Idle']
// Share of the weekly limit, e.g. "1.2%"; tokens include re-reads. A session's share includes the T3 helpers it started.
const weekOf = (s?: Session) => { const p = s?.weekPctAll ?? s?.weekPct; return p == null ? '' : (p < 0.1 ? '<0.1' : p.toFixed(1)) + '%' }
// The menu and the page title name a session by its title, project, or (last resort) id.
const nameOf = (x?: Session | null) => sessionName(x) || x?.id || ''

export function TopBar() {
  const deck = useDeck()
  const { snap, sessions } = deck
  const sw = useRef<HTMLButtonElement>(null)
  const curSess = snap ? sessions.find(x => x.id === snap.sessionId) : undefined
  const parentSess = curSess?.parentId ? sessions.find(x => x.id === curSess.parentId) : undefined
  const waitingFor = deck.loadingFor && deck.loadingFor !== 'first' ? sessions.find(x => x.id === deck.loadingFor) : undefined
  const name = waitingFor ? sessionName(waitingFor) : snap ? nameOf(curSess) || snap.project || snap.sessionId : 'No sessions'

  useEffect(() => { document.title = snap ? 'Agents · ' + (nameOf(curSess) || snap.project || '') : 'Agents' })
  // Click outside the top bar closes its menus; Escape closes and returns focus to the button.
  useEffect(() => {
    const click = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.top')) { deck.setMenu(false); deck.setSettings(false) } }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (deck.menuOpen) { deck.setMenu(false); sw.current?.focus() }
      if (deck.settingsOpen) { deck.setSettings(false); document.getElementById('setb')?.focus() }
    }
    document.addEventListener('click', click)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key) }
  }, [deck])

  return (
    <div className="top">
      <button className="back" hidden={!parentSess} aria-label={parentSess ? 'Back to ' + (sessionName(parentSess) || 'parent') : undefined} onClick={() => deck.back()}>
        {parentSess && <><Icon name="chev" /><span>{sessionName(parentSess) || 'Back'}</span></>}
      </button>
      <button ref={sw} className="switch" aria-haspopup="menu" aria-expanded={deck.menuOpen}
        onClick={() => { if (sessions.length) { deck.setSettings(false); deck.setMenu(!deck.menuOpen) } }}>
        <span className={'dot ' + stateOf(curSess)[0]} />
        <span className="name">{name}</span>
        <span className="num" id="sw-usd">{snap ? stateOf(curSess)[1] : ''}</span>
        <span className="grab">{sessions.length ? <Icon name="grabber" /> : null}</span>
      </button>
      <Pop open={deck.menuOpen} className="menu" role="menu">
        <SessionLimit limits={deck.limits} />
        <Rows>{sessions.filter(s => !s.parentId || s.id === snap?.sessionId).map(s => (
          <Fold key={s.id}><div className="mrow">
            <button role="menuitem" data-sid={s.id} onClick={() => deck.choose(s.id)}>
              <span className={'dot ' + stateOf(s)[0]} />
              <span className="name">{nameOf(s)}</span><span className="st-l">{stateOf(s)[1]}</span>
              <span className="num">{weekOf(s) ? <>{weekOf(s)}<span className="ofw"> of week</span></> : '—'}</span>
              <span className="tick">{s.id === snap?.sessionId ? <Icon name="check" /> : null}</span>
            </button>
            {/* Hide from the dashboard (files are kept); shows on hover or focus, in place of the week share. */}
            {s.id !== 'all' && <button className="mhide" aria-label={'Hide ' + nameOf(s)} onClick={e => { e.stopPropagation(); deck.hide(s.id) }}><Icon name="hide" /></button>}
          </div></Fold>
        ))}</Rows>
      </Pop>
      <SettingsMenu />
      <UsageRings />
    </div>
  )
}
