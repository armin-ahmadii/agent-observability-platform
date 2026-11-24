// MCP servers: every server this session used. Ones in use now at full strength, the rest greyed with when they were last used.
import { useDeck } from '../data/store'
import { Icon, AppIcon } from '../icons/Icon'
import { tok, clock, MINUTE } from '../lib/format'
import { serverColor, serverIcon, serverLabel } from '../lib/servers'
import type { Model } from '../lib/tree'
import { Appear, Fold, Rows } from './motion'
import { Logo } from './common'

// A server counts as in use (full strength, share bar) when this session called it within this long.
const IN_USE_MS = 30 * MINUTE

function ServerIcon({ name }: { name: string }) {
  const i = serverIcon(name)
  if ('claude' in i) return <Logo r={{ model: 'claude' }} />
  return 'app' in i ? <AppIcon app={i.app} /> : <Icon name={i.icon} />
}

export function McpServers({ m, show }: { m: Model; show: boolean }) {
  const deck = useDeck()
  const snap = m.snap
  const now = snap.updatedAt ?? Date.now()
  const calls: Record<string, number> = {}
  for (const r of m.runs) for (const [name, n] of Object.entries(r.mcp ?? {})) calls[name] = (calls[name] ?? 0) + n
  const tokens = (name: string) => snap.serverTokens?.[name] ?? 0
  const allTok = Math.max(1, m.runs.reduce((a, r) => a + (r.tokens ?? 0), 0))
  // Calls count the whole session (from its records).
  const hist = deck.mcpRows
  const byName = new Map(hist.map(x => [x.server, x]))
  const names = [...new Set([...Object.keys(snap.serverTokens ?? {}), ...Object.keys(calls)])]
  names.sort((a, b) => tokens(b) - tokens(a) || (calls[b] ?? 0) - (calls[a] ?? 0))
  const all = [...new Set([...names, ...hist.map(x => x.server)])]
  const isActive = (name: string) => (calls[name] ?? 0) > 0 && (byName.get(name)?.lastAt ?? now) > now - IN_USE_MS
  const totalCalls = (name: string) => Math.max(calls[name] ?? 0, byName.get(name)?.calls ?? 0)
  all.sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || tokens(b) - tokens(a) || totalCalls(b) - totalCalls(a))
  return <Appear>{show && all.length > 0 && (
    <section className="sec">
      <div className="head"><h2>MCP servers</h2><span className="c-share">Share of tokens</span><span className="c-calls">Calls</span><span className="c-tok">Tokens</span></div>
      <div id="servers"><Rows key={snap.sessionId}>
        {all.map(name => {
          const h = byName.get(name), on = isActive(name), t = tokens(name)
          return (
            <Fold key={name}><div className={'srv' + (on ? '' : ' past')}>
              <div className="who"><ServerIcon name={name} /><b>{serverLabel(name)}</b>{on || !h ? null : <span className="when">{clock(h.lastAt)}</span>}</div>
              <div className="share">{on && t ? <i style={{ '--c': serverColor(name), width: `${Math.min(100, t / allTok * 100).toFixed(1)}%` } as React.CSSProperties} /> : null}</div>
              <div className="num c-pct">{t ? (t / allTok * 100 < 1 ? '<1%' : Math.round(t / allTok * 100) + '%') : '—'}</div>
              <div className="num c-calls">{totalCalls(name).toLocaleString('en-US')}</div>
              <div className="num c-tok">{t ? tok(t) : '—'}</div>
            </div></Fold>
          )
        })}
      </Rows></div>
    </section>
  )}</Appear>
}
