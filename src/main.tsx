import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { hydrateWorkshop, useWorkshop } from './store/useWorkshop'
import { useNostr } from './store/useNostr'
import { primeRef } from './lib/parts'

// The house pattern: the stores on the window in dev, so a headless harness
// can drive the app without clicking its way through the UI.
if (import.meta.env.DEV) {
  const w = window as unknown as { __workshop?: unknown; __nostr?: unknown; __parts?: unknown }
  w.__workshop = useWorkshop
  w.__nostr = useNostr
  w.__parts = { primeRef }
}

/**
 * The workshop's shards are read from IndexedDB before the app draws
 * (store/workshopStorage.ts), so everything that reads the list finds it
 * whole, as it did when the list was in localStorage. A database that does
 * not answer cannot hold the page: past this, the app draws anyway and the
 * list fills in when the read lands, with any change made meanwhile kept.
 */
const HYDRATE_WAIT_MS = 10_000

let drawn = false
function draw(): void {
  if (drawn) return
  drawn = true
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
setTimeout(draw, HYDRATE_WAIT_MS)
hydrateWorkshop().then(draw, draw)
