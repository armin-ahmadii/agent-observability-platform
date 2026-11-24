import { createRoot } from 'react-dom/client'
import { App } from './App'
import { deck } from './data/store'
import { darkQuery, applyTheme } from './lib/theme'
// Plain global CSS. The order matters for the cascade; responsive.css goes last so it wins.
// Geist and Geist Mono (OFL), bundled into the page so it needs no network.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/base.css'
import './styles/topbar.css'
import './styles/stats.css'
import './styles/sections.css'
import './styles/memory.css'
import './styles/mcp.css'
import './styles/agents.css'
import './styles/skeleton.css'
import './styles/breakdown.css'
import './styles/requests.css'
import './styles/helpers.css'
import './styles/tooltip.css'
import './styles/settings.css'
import './styles/responsive.css'

createRoot(document.getElementById('root')!).render(<App />)
applyTheme()
darkQuery.addEventListener('change', () => { applyTheme(); deck.render() })
deck.start()
