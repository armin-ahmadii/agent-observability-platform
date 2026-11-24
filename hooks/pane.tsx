// The Subagents pane inside Claude Code: totals, a timeline row per run, and saved helpers.
import type { On } from 'claude-code'

import type { Run } from '../types'
import { saveRun, toggleHelper } from './helpers'
import { ACTIVITY_SVG, serverIcon, VERB } from './icons'
import { MAIN, getRuns, getHelpers } from './state'
import { count, modelName, money } from './text'

export const PANE = 'subagents'
export const PANE_TITLE = 'Subagents'

/** Pane width (columns) from which the name sits beside its timeline. */
const WIDE_COLUMNS = 72
/** The timeline never spans less than this. */
const MIN_SPAN_MS = 30_000
/** A stretch is drawn at least this share of the timeline wide, so its label fits. */
const MIN_SEGMENT_SHARE = 0.06
const ICON_PX = 14

function ago(ms: number): string {
  return ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`
}

/** The time axis, from the oldest run to now: what the pane draws that moves with the clock. */
function timeAxis(list: Run[], now: number) {
  const windowStart = list.length ? Math.min(...list.map(r => r.startedAt)) : now
  const span = Math.max(MIN_SPAN_MS, now - windowStart)
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / span) * 100)).toFixed(0)}%`
  return {
    span,
    lead: (run: Run) => (run.segments[0] ? pct(run.segments[0].start - windowStart) : ''),
    segmentWidth: (start: number, end: number) => pct(Math.max(end - start, span * MIN_SEGMENT_SHARE)),
    doneFor: (run: Run) => ago((run.segments[run.segments.length - 1]?.end ?? now) - run.startedAt),
  }
}

/**
 * Everything the pane shows that changes with the clock alone, as one string.
 * The 2s tick redraws the pane only when this differs (state changes redraw it
 * on their own), so an idle pane isn't rebuilt every tick for an identical picture.
 */
export function paneClockKey(list: Run[], now: number): string {
  const axis = timeAxis(list, now)
  const parts = [ago(axis.span), ago(axis.span / 2)]
  for (const run of list) {
    parts.push(axis.lead(run), run.now === 'done' ? axis.doneFor(run) : '')
    for (const seg of run.segments) parts.push(axis.segmentWidth(seg.start, seg.end))
  }
  return parts.join('|')
}

export function registerPane(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await getRuns($)
    const saved = await getHelpers($)
    const now = await $.clock.now()
    const isWide = (e.props.bodyColumns ?? 40) >= WIDE_COLUMNS

    // A Central icon where the surface draws SVG; nothing in the terminal.
    const svg = (source: string, alt: string) => {
      if (e.surface === 'terminal') return null
      const { Svg } = $.ui.resolve(e)
      return <Svg source={source} alt={alt} width={ICON_PX} height={ICON_PX} />
    }
    const pill = (key: string, label: string, source?: string) => (
      <Box key={key} flexDirection="row" gap={1} borderStyle="round" borderDimColor paddingX={1} flexShrink={0}>
        {source ? svg(source, label) : null}
        <Text wrap="truncate-end">{label}</Text>
      </Box>
    )

    // ---- totals ----
    const totalUsd = list.reduce((n, r) => n + r.usd, 0)
    const totalTokens = list.reduce((n, r) => n + r.tokens, 0)
    const subagents = list.filter(r => r.id !== MAIN).length
    const servers = new Map<string, number>()
    for (const run of list) for (const [name, n] of Object.entries(run.mcp)) servers.set(name, (servers.get(name) ?? 0) + n)

    const { span, lead: leadWidth, segmentWidth, doneFor } = timeAxis(list, now)

    const track = (run: Run) => {
      const lead = () => (run.segments[0] ? <Box width={leadWidth(run)} flexShrink={0} /> : null)
      return (
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" width="100%">
            {lead()}
            {run.segments.map((seg, i) => (
              <Box key={`seg-${run.id}-${i}`} width={segmentWidth(seg.start, seg.end)} flexShrink={1} flexDirection="row" gap={1} borderStyle="round" borderDimColor paddingX={1}>
                {seg.server ? svg(serverIcon(seg.server), seg.server) : null}
                <Text wrap="truncate-end">{seg.label}</Text>
              </Box>
            ))}
          </Box>
          <Box flexDirection="row" width="100%">
            {lead()}
            {run.segments.map((seg, i) => (
              <Box key={`tok-${run.id}-${i}`} width={segmentWidth(seg.start, seg.end)} flexShrink={1}>
                <Text dimColor wrap="truncate-end">
                  {count(seg.tokens)} tokens
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    const doing = (run: Run) =>
      run.now === 'done'
        ? `Done · ${doneFor(run)}`
        : `${VERB[run.now]}${run.nowServer ? ` in ${run.nowServer}` : ''}…`

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="column" gap={1}>
          <Text bold>Total used</Text>
          <Text>
            ≈ {money(totalUsd)} · {count(totalTokens)} tokens · {subagents} subagent{subagents === 1 ? '' : 's'}
          </Text>
          {servers.size > 0 && (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {[...servers.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => pill(`srv-${name}`, `${name} ×${n}`, serverIcon(name)))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>{ago(span)} ago</Text>
            <Text dimColor>{ago(span / 2)} ago</Text>
            <Text dimColor>now</Text>
          </Box>
          {list.length === 0 && <Text dimColor>No agents yet.</Text>}
          {list.map(run => (
            <Box key={`run-${run.id}`} flexDirection={isWide ? 'row' : 'column'} gap={1}>
              <Box flexDirection="column" width={isWide ? '30%' : '100%'} flexShrink={0}>
                <Box flexDirection="row" gap={1}>
                  {svg(ACTIVITY_SVG[run.now], VERB[run.now])}
                  <Text bold wrap="truncate-end">
                    {run.helper ?? run.label}
                  </Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {doing(run)} · ≈{money(run.usd)}
                </Text>
                {run.now === 'done' && run.id !== MAIN && !run.helper && !run.savedAs ? (
                  <Button key={`save-${run.id}`} plain label="Save as helper" onPress={() => saveRun($, run.id)} />
                ) : null}
              </Box>
              {track(run)}
            </Box>
          ))}
        </Box>

        {saved.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text bold>Saved helpers</Text>
            {saved.map(helper => (
              <Box key={`helper-${helper.name}`} flexDirection="row" gap={1} alignItems="center">
                <Box flexGrow={1} flexDirection="column">
                  <Text bold dimColor={!helper.isOn} wrap="truncate-end">
                    {helper.name}
                  </Text>
                </Box>
                {helper.swarm ? pill(`sw-${helper.name}`, helper.swarm) : null}
                {helper.model ? pill(`md-${helper.name}`, modelName(helper.model)) : null}
                <Button
                  key={`toggle-${helper.name}`}
                  label={helper.isOn ? 'On' : 'Off'}
                  variant={helper.isOn ? 'primary' : 'secondary'}
                  onPress={() => toggleHelper($, helper.name)}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
