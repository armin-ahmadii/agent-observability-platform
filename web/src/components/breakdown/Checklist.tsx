// The agent's list (see listOf): your requests (each opening to its steps), to-do items with their state, finished
// items (all checked), planned steps (hollow), or the background helper's jobs.
// When the agent ended in an error or was stopped, its unfinished items are marked failed.
import { Icon } from '../../icons/Icon'
import { clock } from '../../lib/format'
import type { AgentList } from '../../lib/agents'
import { AskList } from './AskList'

export function Checklist({ list, failed, planDone, planNow, runKey, runDone }: { list: NonNullable<AgentList>; failed: boolean; planDone?: number[]; planNow?: number; runKey: string; runDone: boolean }) {
  if (list.kind === 'asks') return <AskList asks={list.items} runKey={runKey} runDone={runDone} failed={failed} />
  if (list.kind === 'jobs') return <ul className="tasks jobs">{list.items.map((j, i) => (
    <li key={i} className={'tk ' + (j.ok === false ? 'failed' : 'done')}>
      <span className="tk-m"><Icon name={j.ok === false ? 'task_fail' : 'task_ok'} /></span><span className="tk-t">{j.what}</span><span className="tk-n">{clock(j.at)}</span>
    </li>))}</ul>
  if (list.kind === 'tasks') {
    const done = list.items.filter(t => t.status === 'done').length
    return <ul className="tasks">{list.items.map((t, i) => {
      const st = t.status !== 'done' && failed ? 'failed' : t.status
      return <li key={t.id ?? i} className={'tk ' + st}>
        <span className="tk-m"><Icon name={st === 'done' ? 'task_ok' : st === 'failed' ? 'task_fail' : 'progress'} /></span>
        <span className="tk-t">{t.text}</span>
        {i === 0 && <span className="tk-n">{done}/{list.items.length}</span>}
      </li>
    })}</ul>
  }
  // Planned steps tick as the agent reports them done (planDone) or in progress (planNow); "3/6" once any is done.
  const doneSet = new Set(list.kind === 'plan' && Array.isArray(planDone) ? planDone : [])
  const items = list.items
  const cls = (i: number) => list.kind === 'done' || doneSet.has(i) ? 'done' : list.kind === 'plan' && planNow === i ? 'in_progress' : 'planned'
  const count = items.filter((_, i) => doneSet.has(i)).length
  return <ul className={'tasks ' + list.kind}>{items.map((t, i) => (
    <li key={i} className={'tk ' + cls(i)}><span className="tk-m"><Icon name={cls(i) === 'done' ? 'task_ok' : 'progress'} /></span><span className="tk-t">{t}</span>
      {i === 0 && count > 0 && <span className="tk-n">{count}/{items.length}</span>}</li>
  ))}</ul>
}
