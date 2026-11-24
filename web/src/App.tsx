// The page: top bar, then (once a session is loaded) stats, agents, tasks, MCP servers, project memory and saved helpers.
import { useEffect, useLayoutEffect, useState } from 'react'
import { AnimatePresence, LazyMotion, domAnimation, m } from 'motion/react'
import { EASE } from './components/motion'
import { useDeck } from './data/store'
import { buildModel } from './lib/tree'
import { TopBar } from './components/topbar/TopBar'
import { Stats } from './components/stats/Stats'
import { costSplit } from './components/stats/costCard'
import { Agents } from './components/agents/Agents'
import { Requests } from './components/Requests'
import { McpServers } from './components/McpServers'
import { ProjectMemory } from './components/ProjectMemory'
import { Helpers } from './components/Helpers'
import { Skeleton } from './components/Skeleton'
import { Tooltip, refreshTooltip } from './components/Tooltip'
import { RetryOnPoll } from './components/RetryOnPoll'

// Long enough for the last block's rise (0.32s + 4 × 30ms delay) to finish.
const INTRO_MS = 700

function Body() {
  const deck = useDeck()
  // While the body fades out because the data went away, it keeps drawing the last good data.
  // First paint of a session: the blocks rise in, 30ms apart. After that the class is gone and nothing replays.
  const [intro, setIntro] = useState(true)
  useEffect(() => { const t = setTimeout(() => setIntro(false), INTRO_MS); return () => clearTimeout(t) }, [])
  const snap = deck.snap ?? deck.lastSnap
  if (!snap) return null
  const model = buildModel(snap)
  const { mainUsd } = costSplit(model, snap.totalUsd ?? 0)
  const p = deck.prefs
  return (
    <div id="body" className={intro ? 'intro' : undefined}>
      <Stats m={model} show={p.stats} />
      <Agents m={model} mainUsd={mainUsd} showAgents={p.agents} showChats={p.chats} />
      <Requests m={model} show={p.tasks} />
      <McpServers m={model} show={p.mcp} />
      <ProjectMemory m={model} show={p.memory} />
      <Helpers />
    </div>
  )
}

export function App() {
  const deck = useDeck()
  const waiting = deck.waiting
  useLayoutEffect(refreshTooltip)
  // Skeleton and content crossfade: the one leaving is lifted out of the flow, so the page never jumps.
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15, ease: EASE } }
  return <LazyMotion features={domAnimation} strict>
    <div className="page">
      <TopBar />
      <div className="empty" id="blank" hidden={!!deck.snap || waiting}>No sessions in the last 24 hours</div>
      <div className="stage">
        <AnimatePresence initial={false} mode="popLayout">
          {waiting ? <m.div key="skel" {...fade} exit={{ opacity: 0, transition: { duration: 0.2, ease: EASE } }}><Skeleton /></m.div>
            : deck.snap ? <m.div key="body" exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE } }}><RetryOnPoll><Body /></RetryOnPoll></m.div> : null}
        </AnimatePresence>
      </div>
    </div>
    <Tooltip />
  </LazyMotion>
}
