// MCP server names, colours and icons.
import { deck } from '../data/store'
import { darkQuery } from './theme'

const BRANDS = ['figma', 'github', 'notion', 'linear', 'google', 'chrome'] as const
export const serverLabel = (name: string) => deck.snap?.servers?.[name]?.label ?? name

// Brand colours that would vanish on the current theme (near-black on dark, near-white on light) use the text colour.
const TOO_DARK = 0.2
const TOO_LIGHT = 0.85
export function serverColor(name: string) {
  const hex = deck.snap?.servers?.[name]?.color
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    // No brand colour: a muted hue picked from the name, so it stays the same across reloads.
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
    return `hsl(${h} 18% 55%)`
  }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (darkQuery.matches ? lum < TOO_DARK : lum > TOO_LIGHT) return 'var(--fg)'
  return hex
}

export type AppName = 't3' | 'paper' | 'figma' | 'mobbin' | 'muse'
// Servers whose app we have a real icon for use it; others fall back to a brand or plug icon.
const APPS: [RegExp, AppName][] = [[/^t3/, 't3'], [/paper/, 'paper'], [/figma/, 'figma'], [/mobbin/, 'mobbin']]
// Claude's own servers (claude.ai connectors have id-style names; the MCP registry and ccd_* servers ship with Claude) get the Claude logo.
const CLAUDE = /^[0-9a-f]{8}-[0-9a-f]{4}-|^claude|^ccd_|^mcp-registry$/i
export function serverIcon(name: string): { app: AppName } | { icon: string } | { claude: true } {
  if (CLAUDE.test(name)) return { claude: true }
  const key = (name + ' ' + serverLabel(name)).toLowerCase()
  const app = APPS.find(([re]) => re.test(key))?.[1]
  if (app) return { app }
  return { icon: BRANDS.find(b => key.includes(b)) ?? 'plugin' }
}
