// Agents: the tree of live rows, the background helper row, Earlier agents, and (All sessions) Previous orchestrators.
import { useEffect } from 'react'
import { useDeck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import { Appear, Rows } from '../motion'
import { isMainRow, lastActivity } from '../../lib/agents'
import { plural } from '../../lib/format'
import { askDone, askGrades, askTitles } from '../../lib/modAsks'
import { earlierAgents, visibleTree, type Model } from '../../lib/tree'
import type { Run } from '../../lib/types'
import { chatRowItems, chatRun, earlierRowItems, liveRowItems, triageRowItems } from './rowItems'
import { onRowClick, onRowKey } from './rowEvents'
import { useReveal } from './useReveal'

// A folded "Earlier agents" list with its own toggle.
function EarlierToggle({ open, n, onToggle }: { open: boolean; n: number; onToggle: (e: React.MouseEvent) => void }) {
  return <button className="hist-h" aria-expanded={open} onClick={onToggle}>
    <span className="cv"><Icon name="chev" /></span>Earlier agents <em>{n}</em></button>
}

export function Agents({ m, mainUsd, showAgents, showChats }: { m: Model; mainUsd: number; showAgents: boolean; showChats: boolean }) {
  const deck = useDeck()
  const snap = m.snap
  const sid = snap.sessionId
  const isAll = sid === 'all'
  const now = snap.updatedAt ?? Date.now()
  const v = visibleTree(m, isAll)
  const past = earlierAgents(m, v, deck.agentRows, isAll, deck.win)

  // All sessions: each orchestrator's finished agents, kept inside it (a folded "Earlier agents" at the end of its breakdown).
  const pastBy = new Map<string, Run[]>()
  if (isAll) for (const h of past) { const k = String(h.sessionOf ?? ''); (pastBy.get(k) ?? pastBy.set(k, []).get(k)!).push(h) }
  const earlierFor = (sessionId: string) => {
    const list = pastBy.get(sessionId) ?? []
    if (!list.length) return null
    const key = 'earlier:' + sessionId, open = deck.isOpen(key)
    return <div>
      <EarlierToggle open={open} n={list.length} onToggle={e => { e.stopPropagation(); deck.toggleFold(key) }} />
      <Appear>{open && <div className="rows hist"><Rows key={key}>{earlierRowItems(list)}</Rows></div>}</Appear>
    </div>
  }

  const items = liveRowItems({ m, v, isAll, now, mainUsd, earlierFor })
  if (m.triage) items.push(...triageRowItems(m.triage, now))

  // All sessions: the chats working now go with "Active" to the server; every other chat used in the timeframe
  // is a Previous orchestrator (newest first, its amounts for the timeframe). Clicking opens it while its session is listed.
  if (isAll) deck.activeIds = [...v.active]
  const idle = isAll && deck.win !== 'active' && deck.chats?.win === deck.win ? deck.chats.rows.filter(c => !v.active.has(c.id)) : []
  const prevShown = isAll && showChats && idle.length > 0
  const chatItems = prevShown ? chatRowItems(idle, id => pastBy.get(id)?.length ?? 0, earlierFor) : []

  useReveal(m, v, past, showAgents)

  // Ask the mod for short titles, done lists and grades it doesn't have yet (after paint, never during it).
  useEffect(() => {
    askTitles([...m.tree, ...past, ...idle.map(chatRun)])
    askDone(past.map(h => ({ ...h, now: 'done' })))
    askGrades([
      ...m.tree.filter(r => !isMainRow(r) && r.now === 'done').map(r => ({ id: r.id, label: r.label, brief: r.brief, result: r.result, usd: r.usd ?? 0, ms: lastActivity(r) - (r.startedAt ?? lastActivity(r)), errors: r.errors ?? 0, endedAt: lastActivity(r) })),
      ...past.map(h => ({ id: h.id, label: h.label, brief: h.brief, result: h.result, usd: h.usd ?? 0, ms: (h.endedAt ?? h.startedAt!) - h.startedAt!, errors: h.errors ?? 0, endedAt: h.endedAt, startedAt: h.startedAt })),
    ])
  })

  const tops = m.roots.length, subs = m.tree.length - tops
  const colHeads = <><span className="c-tok">Tokens</span><span className="c-usd">Cost</span><span className="c-dchev" /></>
  // Rows are keyed by agent id inside <Rows>: a new agent unfolds once, a leaving one folds away, the rest stay still.
  // Earlier agents sit at the end of the Agents section (All sessions keeps them inside each orchestrator instead).
  const earlier = <Appear>{past.length > 0 && <div>
    <EarlierToggle open={deck.histOpen} n={past.length} onToggle={() => deck.toggleHist()} />
    <Appear>{deck.histOpen && <div className="rows hist" id="hist" onClick={onRowClick} onKeyDown={onRowKey}><Rows key={sid}>{earlierRowItems(past)}</Rows></div>}</Appear>
  </div>}</Appear>
  return <>
    <Appear>{(showAgents || (!isAll && past.length > 0)) && (
      <section className="sec">
        <Appear>{showAgents && <div><div className="head"><h2>{isAll ? 'Session orchestrators' : 'Agents'} <em>{isAll ? `${v.active.size}` : `${m.tree.length} · ${tops} main, ${plural(subs, 'subagent', 'subagents')}`}</em></h2>
          {colHeads}</div>
        <div className="empty" hidden={items.length > 0}>{isAll ? 'No agents working' : 'No agents yet'}</div>
        <div className="rows" id="agents" onClick={onRowClick} onKeyDown={onRowKey}><Rows key={sid}>{items}</Rows></div></div>}</Appear>
        {!isAll && earlier}
      </section>
    )}</Appear>
    <Appear>{prevShown && (
      <section className="sec" id="sec-chats">
        <div className="head"><h2>Previous orchestrators <em>{idle.length}</em></h2>{colHeads}</div>
        <div className="rows" id="chats" onClick={onRowClick} onKeyDown={onRowKey}><Rows key={sid}>{chatItems}</Rows></div>
      </section>
    )}</Appear>
  </>
}
