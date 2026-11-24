// Central Icons as inline <svg> elements (generated into svgs.ts), plus the app PNGs for MCP servers.
// Unknown names fall back to the generic "running" icon.
import { SVGS, type IconName } from './svgs'
import t3 from '../../../live/app-icons/t3.png'
import paper from '../../../live/app-icons/paper.png'
import figma from '../../../live/app-icons/figma.png'
import mobbin from '../../../live/app-icons/mobbin.png'
import muse from '../../../live/app-icons/muse.png'
import type { AppName } from '../lib/servers'

export function Icon({ name }: { name: IconName | string }) {
  const s = (SVGS as Record<string, { viewBox: string; inner: string }>)[name] ?? SVGS.running
  return <svg width="16" height="16" viewBox={s.viewBox} fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: s.inner }} />
}
const APP_SRC: Record<AppName, string> = { t3, paper, figma, mobbin, muse }
// Icons drawn on white get a grey edge so they don't melt into the page.
export function AppIcon({ app }: { app: AppName }) {
  return <img className={'appic' + (app === 'mobbin' ? ' edge' : '')} alt="" src={APP_SRC[app]} />
}
