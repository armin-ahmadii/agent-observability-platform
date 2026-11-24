// Project memory: every agent you reacted to, ranked (praise moves it up, frustration down), and the rules learned.
import { useEffect } from 'react'
import { useDeck } from '../data/store'
import { Icon } from '../icons/Icon'
import { Logo, ShowMore, Title } from './common'
import { ago, plural } from '../lib/format'
import { modelInfo } from '../lib/models'
import { isMainRow, memId, shortOf } from '../lib/agents'
import { askTitles } from '../lib/modAsks'
import { sessionName } from '../lib/sessions'
import type { Model } from '../lib/tree'
import type { MemAgent, MemEvent, Reaction } from '../lib/types'
import { Appear, Fold, Rows } from './motion'

const kindName: Record<string, string> = { main: 'Main chat', subagent: 'Subagent', delegated: 'T3 helper' }
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n)
const dirOf = (n: number) => n > 0 ? 'up' : n < 0 ? 'down' : 'even'
// Agents and rules (and Previous orchestrators) shown before "+N more".
export const MEM_TOP = 3

function NameCell({ a }: { a: MemAgent }) {
  const t = shortOf(a)
  return t !== a.label ? <Title t={t} /> : <>{a.label}</>
}

export function ProjectMemory({ m, show }: { m: Model; show: boolean }) {
  const deck = useDeck()
  const snap = m.snap
  const mem = deck.memory?.id === snap.sessionId ? deck.memory : null
  const hist = deck.agentRows
  // A main conversation shows as "Main chat" under its session's name.
  const asMain = <T extends { id: string; kind?: string; label?: string }>(a: T): T => {
    const sid = String(a.id).startsWith('main:') ? String(a.id).slice(5) : null
    if (!sid && a.kind !== 'main') return a
    const s = deck.sessions.find(x => x.id === (sid ?? snap.sessionId))
    return { ...a, kind: 'main', label: sessionName(s) || a.label }
  }
  let memRows: MemAgent[] = []
  if (mem) {
    // Every agent this session ran is listed; ones you haven't reacted to sit at 0, greyed.
    // One session: its own main conversation is left out. All sessions: each chat's main conversation is listed too.
    const rated = new Set(mem.agents.map(a => a.id))
    const ran = [
      ...m.runs.filter(r => (!!r.sessionOf || !isMainRow(r)) && r.type !== 'triage' && r.type !== 'project').map(r => { const k = memId(r); return { id: k.id, label: r.label, model: r.model, kind: k.kind, sessionOf: r.sessionOf, short: r.short, brief: r.brief, result: r.now === 'done' ? r.result : null } }),
      ...hist.map(h => ({ id: h.id, label: h.label, model: h.model, kind: 'subagent', brief: h.brief, result: h.result })),
    ].filter((a, i, all) => !rated.has(a.id) && all.findIndex(b => b.id === a.id) === i)
      .map(a => ({ ...a, score: 0, ups: 0, downs: 0, last: null, unrated: true }) as MemAgent)
    memRows = [...mem.agents, ...ran].map(asMain)
  }
  useEffect(() => { askTitles(memRows) })
  if (!mem || !show) return <Appear>{null}</Appear>

  // What an agent handed back: from its live run, else from this session's history.
  const resultOf = (a: MemAgent) => {
    const r = m.runs.find(x => x.now === 'done' && x.result && memId(x).id === a.id)
    const h = hist.find(x => x.id === a.id && x.result)
    return String(a.result || r?.result || h?.result || '').trim()
  }
  const reactionsOf = (a: MemAgent) => mem.events.flatMap(e => (e.reactions ?? []).filter(r => r.id === a.id).map(r => ({ ...e, score: r.score })))
  const detail = (a: MemAgent) => {
    const res = resultOf(a), rx = reactionsOf(a)
    if (!res && !rx.length) return null
    return <>
      {res && <p className="brief res">{res}</p>}
      {rx.map((e, i) => {
        const q = e.source === 'thumb' ? (e.score > 0 ? 'Thumbs up' : 'Thumbs down') : e.quote ? `“${e.quote}”` : ''
        return <div className="reaction" key={i}>
          <div className="rl"><span className="rq">{q}</span><span className={'rs ' + dirOf(e.score)}>{signed(e.score)}</span><span className="rt">{ago(e.at)}</span></div>
          {e.lesson && <div className="rr">{e.lesson}</div>}
        </div>
      })}
    </>
  }
  const more = (which: string, total: number) =>
    <ShowMore open={!!deck.memMore[which]} hiddenCount={total - MEM_TOP} hidden={total <= MEM_TOP} onToggle={() => deck.toggleMemMore(which)} />
  const limit = (which: string) => deck.memMore[which] ? Infinity : MEM_TOP

  const n = mem.events.length
  const rows: JSX.Element[] = []
  for (const a of memRows.slice(0, limit('agents'))) {
    const dir = dirOf(a.score)
    const det = detail(a)
    const sel = !!det && deck.memOpen.has(a.id)
    const toggle = det ? {
      'data-mem': a.id, tabIndex: 0, role: 'button', 'aria-expanded': sel,
      onClick: () => deck.toggleMem(a.id),
      onKeyDown: (e: React.KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); deck.toggleMem(a.id) } },
    } : {}
    rows.push(
      <Fold key={a.id}><div className={'mem' + (a.unrated ? ' unrated' : '') + (sel ? ' sel' : '')} {...toggle}>
        <div className="lead"><Logo r={a} /></div>
        <div className="name"><NameCell a={a} /></div>
        <div className="kind">{[kindName[a.kind ?? ''], modelInfo(a.model).name].filter(Boolean).join(' · ')}</div>
        <div className="quote">{a.last?.quote ? <span>“{a.last.quote}”</span> : null}</div>
        <div className={'score ' + dir}><span>{dir === 'up' ? <Icon name="up" /> : dir === 'down' ? <Icon name="down" /> : null}{a.score > 0 ? '+' : ''}{a.score}</span></div>
        <div className="c-dchev">{det ? <span className="dchev" aria-hidden="true"><Icon name="dchev" /></span> : null}</div>
      </div></Fold>,
    )
    if (sel) rows.push(<Fold key={'det:' + a.id}><div className="mem-det"><div className="md">{det}</div></div></Fold>)
  }

  // Each rule shows who it came from: the latest reaction that taught it.
  const lessons = mem.lessons.map((l, i) => {
    const e: MemEvent | undefined = mem.events.find(x => x.lesson && x.lesson.toLowerCase() === l.text.toLowerCase())
    const r: Reaction | undefined = e?.reactions?.[0]
    const who = r && asMain(r)
    return <li key={i}><span>{l.text}</span>
      {who && <><span className="src"><Logo r={who} /><b>{isMainRow(who) ? who.label : <Title t={shortOf(who)} />}</b></span><span className={'rs ' + dirOf(r!.score)}>{signed(r!.score)}</span></>}
      {l.count > 1 && <em>×{l.count}</em>}</li>
  })

  const moreRules = !!deck.memMore.rules && lessons.length > MEM_TOP
  return <Appear>
    <section className="sec" id="sec-mem">
      <div className="head"><h2>Project memory <em>{n ? plural(n, 'reaction', 'reactions') : ''}</em></h2><span className="c-score">Score</span><span className="c-dchev" /></div>
      <div id="mem-agents"><Rows key={snap.sessionId}>{rows}</Rows></div>
      {more('agents', memRows.length)}
      <div className="mem-h" hidden={!mem.lessons.length}>Rules learned</div>
      <ul className="lessons">{lessons.slice(0, MEM_TOP)}</ul>
      <Appear>{moreRules && <ul className="lessons rest">{lessons.slice(MEM_TOP)}</ul>}</Appear>
      {more('rules', mem.lessons.length)}
    </section>
  </Appear>
}
