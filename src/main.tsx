import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { useWorkshop } from './store/useWorkshop'
import { useNostr } from './store/useNostr'

// The house pattern: the stores on the window in dev, so a headless harness
// can drive the app without clicking its way through the UI.
if (import.meta.env.DEV) {
  const w = window as unknown as { __workshop?: unknown; __nostr?: unknown }
  w.__workshop = useWorkshop
  w.__nostr = useNostr
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
