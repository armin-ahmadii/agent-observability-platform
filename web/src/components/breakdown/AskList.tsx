// Your requests to an agent, one line each (state, title, steps done), opening to the steps it took for that request.
// Only the current request(s) show in the opened agent (part="current"); finished ones fold under "Past requests"
// (closed by default), which sits inside the agent's "More details" (part="past").
// Every request starts closed; click one to see its steps.
// Opening or closing one is remembered for this page load.
import { useDeck } from '../../data/store'
import { Icon } from '../../icons/Icon'
import type { AgentAsk } from '../../lib/types'

type State = 'done' | 'in_progress' | 'failed'

// A request is finished once it has an end time, or the agent itself finished (stopped or failed: the latest one failed).
function stateOf(a: AgentAsk, last: boolean, runDone: boolean, failed: boolean): State {
  if (a.finishedAt) return 'done'
  if (runDone) return failed && last ? 'failed' : 'done'
  return 'in_progress'
}

export function AskList({ asks, runKey, runDone, failed, part = 'current' }: { asks: AgentAsk[]; runKey: string; runDone: boolean; failed: boolean; part?: 'current' | 'past' }) {
  const deck = useDeck()
  const states = asks.map((a, i) => stateOf(a, i === asks.length - 1, runDone, failed))
  // Current = not finished yet; when all are finished, the latest one stays in view.
  let current = asks.map((_, i) => i).filter(i => states[i] !== 'done')
  if (!current.length) current = [asks.length - 1]
  const past = asks.map((_, i) => i).filter(i => !current.includes(i))
  const pastKey = `${runKey}:ask:past`
  const pastOpen = deck.askOpen.get(pastKey) ?? false
  const shown = part === 'current' ? current : pastOpen ? past : []
  if (part === 'past' && !past.length) return null
  return <>
    {part === 'past' && <button className={'tk ask-h ask-past' + (pastOpen ? ' open' : '')} aria-expanded={pastOpen} onClick={() => deck.toggleAsk(pastKey, pastOpen)}>
      <span className="tk-t">Past requests</span><span className="tk-n">{past.length}</span>
      <span className="dchev" aria-hidden="true"><Icon name="dchev" /></span>
    </button>}
    {shown.length > 0 && <ul className="tasks asks">{shown.map(i => {
    const a = asks[i]
    const state = states[i]
    const key = `${runKey}:ask:${a.at}`
    const open = deck.askOpen.get(key) ?? false
    const done = new Set(a.done.filter(d => d >= 0 && d < a.steps.length))
    // The finished request of an agent that stopped: its unticked steps failed.
    const stepCls = (j: number) => done.has(j) ? 'done' : state === 'in_progress' && a.now === j ? 'in_progress' : state === 'failed' ? 'failed' : 'planned'
    return <li key={a.at} className={'ask' + (open ? ' open' : '')}>
      <button className={'tk ask-h ' + state} aria-expanded={a.steps.length ? open : undefined} disabled={!a.steps.length}
        onClick={() => deck.toggleAsk(key, open)}>
        <span className="tk-m"><Icon name={state === 'done' ? 'task_ok' : state === 'failed' ? 'task_fail' : 'progress'} /></span>
        <span className="tk-t">{a.title}</span>
        {a.steps.length > 0 && <span className="tk-n">{done.size}/{a.steps.length}</span>}
        {a.steps.length > 0 && <span className="dchev" aria-hidden="true"><Icon name="dchev" /></span>}
      </button>
      {open && a.steps.length > 0 && <ul className="tasks steps">{a.steps.map((t, j) => {
        const c = stepCls(j)
        return <li key={j} className={'tk ' + c}>
          <span className="tk-m"><Icon name={c === 'done' ? 'task_ok' : c === 'failed' ? 'task_fail' : 'progress'} /></span><span className="tk-t">{t}</span>
        </li>
      })}</ul>}
    </li>
  })}</ul>}
  </>
}
