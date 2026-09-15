/**
 * App.tsx - SNOCRASH: make an object, publish it, see what other people made.
 *
 * Two views and nothing else. The scope is the point: there is no coordinate
 * system here, no movement, no encryption and no keys to compute. An object is
 * a shape in a nostr event (DECK-0004), and this app is the smallest thing
 * that can make one, send one, and show one.
 */

import { useEffect, useState } from 'react'
import { Boxes, KeyRound, Pencil } from 'lucide-react'
import { Make } from './ui/Make'
import { Feed } from './ui/Feed'
import { useNostr } from './store/useNostr'
import { useWorkshop } from './store/useWorkshop'

type View = 'make' | 'feed'

function Identity(): JSX.Element {
  const signer = useNostr((s) => s.signer)
  const npub = useNostr((s) => s.npub())
  if (signer === 'none') {
    return (
      <div className="who">
        <button className="btn" onClick={() => void useNostr.getState().useExtension()} title="Sign with a nostr browser extension">
          <KeyRound size={16} strokeWidth={2.25} /> EXTENSION
        </button>
        <button className="btn" onClick={() => useNostr.getState().useLocalKey()} title="Make a key that lives in this browser only">
          NEW KEY
        </button>
      </div>
    )
  }
  return (
    <div className="who">
      <span className="who__key" title={npub ?? ''}>{npub ? `${npub.slice(0, 12)}…${npub.slice(-4)}` : 'signed in'}</span>
      <span className="who__kind">{signer === 'extension' ? 'extension' : 'this browser'}</span>
    </div>
  )
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>('make')
  const notice = useNostr((s) => s.notice)
  const workshopNotice = useWorkshop((s) => s.notice)

  useEffect(() => { void useNostr.getState().init() }, [])
  // Always something to edit, so the editor is never an empty room.
  useEffect(() => {
    const w = useWorkshop.getState()
    if (w.shards.length === 0) w.select(w.create('first object'))
    else if (!w.currentId) w.select(w.shards[0].id)
  }, [])

  return (
    <div className="app">
      <header className="top">
        <h1 className="wordmark">SNOCRASH</h1>
        <nav className="views">
          <button className={`view ${view === 'make' ? 'is-on' : ''}`} aria-pressed={view === 'make'} onClick={() => setView('make')}>
            <Pencil size={16} strokeWidth={2.25} /> MAKE
          </button>
          <button className={`view ${view === 'feed' ? 'is-on' : ''}`} aria-pressed={view === 'feed'} onClick={() => setView('feed')}>
            <Boxes size={16} strokeWidth={2.25} /> FEED
          </button>
        </nav>
        <Identity />
      </header>

      {(notice ?? workshopNotice) && (
        <p className="notice" role="status" onClick={() => useNostr.getState().say(null)}>{notice ?? workshopNotice}</p>
      )}

      {view === 'make' ? <Make /> : <Feed onOpen={() => setView('make')} />}

      <footer className="foot">
        <span>Small 3D objects on nostr, as <code>kind 33331</code>.</span>
        <a href="https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0004-sno.md" target="_blank" rel="noreferrer">the format</a>
        <a href="https://github.com/arkin0x/snocrash" target="_blank" rel="noreferrer">the source</a>
      </footer>
    </div>
  )
}
