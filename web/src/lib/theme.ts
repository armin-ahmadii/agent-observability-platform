// The colour theme. It follows the OS until you pick one in Settings (remembered in localStorage as 'deck-theme').
// The CSS reads only <html data-theme>; index.html sets it before first paint with the same rule as applyTheme().
// main.tsx re-renders when it flips, because server colours are picked per theme (lib/servers.ts).
export const darkQuery = matchMedia('(prefers-color-scheme: dark)')
const KEY = 'deck-theme'
type Theme = 'light' | 'dark'

function saved(): Theme | null {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null } catch { return null }
}
export const isDark = () => document.documentElement.dataset.theme === 'dark'
export function applyTheme() { document.documentElement.dataset.theme = saved() ?? (darkQuery.matches ? 'dark' : 'light') }
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t) } catch {}
  applyTheme()
  if (saved() !== t) document.documentElement.dataset.theme = t // storage blocked: still switch for this visit
}
