/**
 * MenuOverlay.tsx - the whole app in one screen: who you are, and the two
 * places you can be.
 *
 * ONOSENDAI puts its instruments on the world and its panels behind a
 * hamburger, so the screen belongs to the thing you are looking at until you
 * ask for the machinery. This is the same idea with far less to hold: an
 * identity, a feed, and a workshop. The overlay is where those three live, and
 * the chips along the top of the workshop stay what they are, the tools for
 * the object on the bench.
 *
 * The workshop panel lists objects with where each one stands with the relays
 * (lib/published), which is the one thing the bench itself cannot show you: an
 * object on the bench looks identical whether it has been published, published
 * and then edited, or never sent anywhere at all.
 */

import { useEffect, useState } from 'react'
import { Boxes, Wrench } from 'lucide-react'
import { useNostr } from '../store/useNostr'
import { DEFAULT_RELAYS, useRelays } from '../store/useRelays'
import { pool } from '../lib/pool'
import { useWorkshop } from '../store/useWorkshop'
import { Explanation } from './Explanation'
import { STATE_HELP, STATE_LABEL, STATE_TAG, publishState, shardFingerprint } from '../lib/published'
import { keyColor } from '../lib/keyColor'

/** How long a relay gets to accept a connection before the dot calls it dead. */
const PROBE_MS = 4000

const SIGNER_LABEL: Record<string, string> = {
  local: 'LOCAL KEY',
  nip07: 'EXTENSION',
  nip46: 'BUNKER',
}

const SIGNER_NOTE: Record<string, string> = {
  local: 'A key in this browser, and nowhere else.',
  nip07: 'Your browser extension signs, and keeps the key.',
  nip46: 'A bunker signs, on another machine, and keeps the key.',
}

/**
 * The mark. A placeholder on purpose: three points and the triangle they span,
 * which is the smallest thing SNO can say, drawn as one. Swap the SVG for the
 * real logomark when there is one; nothing else here depends on its shape.
 */
function Logomark(): JSX.Element {
  return (
    <svg className="brand__mark" viewBox="0 0 64 64" role="img" aria-label="snocrash">
      <polygon points="32,10 54,50 10,50" fill="rgba(0,229,255,0.10)" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx="32" cy="10" r="4.5" fill="var(--accent)" />
      <circle cx="54" cy="50" r="4.5" fill="var(--warn)" />
      <circle cx="10" cy="50" r="4.5" fill="var(--fg)" />
    </svg>
  )
}


/**
 * Which relays this app reads from and publishes to.
 *
 * ONOSENDAI's panel, with its one pinned relay taken out: that client has a
 * world everyone has to meet in, and this one does not. An object lives
 * wherever somebody put it, so every relay here is as removable as the next,
 * down to the last, which stays because a client with no relays fails at
 * everything for a reason nothing on screen would explain.
 *
 * The dot is whether the relay will take a connection, tested while this panel
 * is open. Asking the pool what it has open instead would show grey for
 * everything: a read closes its subscription the moment every relay is
 * finished, and the pool drops idle sockets after that, so by the time anyone
 * opens this panel nothing is connected and the dots would say so truthfully
 * and uselessly. What somebody wants to know here is whether a relay they
 * typed in actually answers.
 */
function RelaysPanel(): JSX.Element {
  const relays = useRelays((s) => s.relays)
  const [input, setInput] = useState('')
  const [bad, setBad] = useState(false)
  const [live, setLive] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let gone = false
    const probe = async (): Promise<void> => {
      for (const r of relays) {
        let ok = false
        try { await pool.ensureRelay(r, { connectionTimeout: PROBE_MS }); ok = true } catch { ok = false }
        if (gone) return
        setLive((m) => (m[r] === ok ? m : { ...m, [r]: ok }))
      }
    }
    void probe()
    const t = window.setInterval(() => void probe(), 15000)
    return () => { gone = true; window.clearInterval(t) }
  }, [relays])

  const standard = relays.length === DEFAULT_RELAYS.length && relays.every((r) => DEFAULT_RELAYS.includes(r))

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (useRelays.getState().add(input)) { setInput(''); setBad(false) } else setBad(true)
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Relays</h2>
        <span className="tag tag--local">{relays.length}</span>
      </header>
      <ul className="menu__relays">
        {relays.map((r) => (
          <li key={r}>
            <span
              className={`relays__dot ${live[r] ? 'is-on' : live[r] === false ? 'is-off' : ''}`}
              title={live[r] ? 'Answers' : live[r] === false ? 'Does not answer' : 'Trying'}
            />
            <span className="relays__url" title={r}>{r.replace(/^wss?:\/\//, '')}</span>
            <button
              className="workshop__mini workshop__mini--danger workshop__mini--x"
              disabled={relays.length === 1}
              title={relays.length === 1 ? 'The last relay stays: with none, nothing works' : 'Remove this relay'}
              aria-label={`Remove ${r}`}
              onClick={() => useRelays.getState().remove(r)}
            >×</button>
          </li>
        ))}
      </ul>
      <form className="menu__addrelay" onSubmit={submit}>
        <input
          className="avatars__input login__input"
          value={input}
          onChange={(e) => { setInput(e.target.value); setBad(false) }}
          placeholder="wss://relay.example.com"
          spellCheck={false}
          autoComplete="off"
          aria-label="Relay to add"
        />
        <button className="workshop__btn" type="submit" disabled={!input.trim()}>ADD</button>
      </form>
      {bad && <p className="notice">Not a ws:// or wss:// address.</p>}
      {!standard && (
        <button className="workshop__btn menu__wide" onClick={() => useRelays.getState().reset()}>BACK TO THE DEFAULTS</button>
      )}
      <Explanation>
        An object is published to every relay on this list, and the feed is whatever they hand
        back, so the list is the whole of this app's reach. Add one a friend uses and their
        objects appear beside yours; publishing to a relay nobody else reads is how an object
        ends up findable by nobody. Profiles are read from these same relays, which is why
        somebody with no picture here may have one elsewhere.
      </Explanation>
    </section>
  )
}

export function MenuOverlay({ view, setView, onClose, onLogin }: {
  view: 'make' | 'feed'
  setView: (v: 'make' | 'feed') => void
  onClose: () => void
  onLogin: () => void
}): JSX.Element {
  const signedIn = useNostr((s) => s.signedIn)
  const signerKind = useNostr((s) => s.signer)
  const npub = useNostr((s) => s.npub())
  const pubkey = useNostr((s) => s.pubkey)
  const feed = useNostr((s) => s.feed)
  const loading = useNostr((s) => s.loading)
  const ledger = useNostr((s) => s.published)
  const shards = useWorkshop((s) => s.shards)
  const currentId = useWorkshop((s) => s.currentId)

  const go = (where: 'make' | 'feed'): void => { setView(where); onClose() }
  const open = (id: string): void => { useWorkshop.getState().select(id); go('make') }

  return (
    <div className="menu" role="dialog" aria-modal="true" aria-label="Menu">
      <button className="menu__scrim" aria-label="Close the menu" onClick={onClose} />
      <div className="menu__card">
        {/* Exactly where the hamburger is, wearing the same three bars turned
            into a cross: one control in one place, opening and shutting. */}
        <button className="chip ws__icon menu__close" onClick={onClose} aria-label="Close the menu">
          <span className="hamburger-icon hamburger-icon--open" aria-hidden><span /><span /><span /></span>
        </button>

        <header className="brand">
          <Logomark />
          <h1 className="brand__word">SNOCRASH</h1>
          <p>Simple Nostr Object (SNO) Explorer</p>
        </header>


        <div className="menu__go">
          <button className={`menu__big ${view === 'feed' ? 'is-on' : ''}`} onClick={() => go('feed')}>
            <Boxes size={22} strokeWidth={2} aria-hidden />
            <span className="menu__big-name">FEED</span>
            <span className="menu__big-note">objects other people published</span>
          </button>
          <button className={`menu__big ${view === 'make' ? 'is-on' : ''}`} onClick={() => go('make')}>
            <Wrench size={22} strokeWidth={2} aria-hidden />
            <span className="menu__big-name">WORKSHOP</span>
            <span className="menu__big-note">make an object, and publish it</span>
          </button>
        </div>

        <section className="panel">
          <header className="panel__head">
            <h2>Identity</h2>
            <span className={`tag ${signedIn ? 'tag--live' : 'tag--local'}`}>{signedIn ? SIGNER_LABEL[signerKind] ?? signerKind : 'NO KEY'}</span>
          </header>
          <div className="identity__who">
            {pubkey && <span className="identity__swatch" aria-hidden style={{ background: keyColor(pubkey) }} />}
            <div className="identity__who-text">
              <span className="identity__name">{signedIn ? (npub ? `${npub.slice(0, 14)}…${npub.slice(-8)}` : 'signed in') : 'Nobody yet'}</span>
              <span className="identity__signer">{signedIn ? SIGNER_NOTE[signerKind] ?? signerKind : 'Nothing you make can be published until a key signs it.'}</span>
            </div>
            <button className="identity__change" onClick={() => { onLogin(); onClose() }}>{signedIn ? 'CHANGE' : 'CHOOSE'}</button>
          </div>
          <Explanation>
            There is no account here and no server that knows you. There is a key, and whoever
            holds it is you: an object you publish is an event signed by that key, and the key
            plus the object's own id is its address on every relay. A key this app makes lives in
            this browser only, so export it (CHANGE, then EXPORT THIS KEY) before you clear your
            cache; an extension or a bunker keeps its own key and this app never sees it.
          </Explanation>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2>Feed</h2>
            <span className={`tag ${loading ? 'tag--scan' : 'tag--local'}`}>{loading ? 'READING' : `${feed.length}`}</span>
          </header>
          <p className="menu__line">
            {loading ? 'Reading the relays.' : feed.length > 0 ? `${feed.length} object${feed.length === 1 ? '' : 's'} from the relays, newest first.` : 'Nothing read yet.'}
          </p>
          <button className="workshop__btn menu__wide" onClick={() => go('feed')}>OPEN THE FEED</button>
          <Explanation>
            Every object on the feed is one event and nothing more, so the feed is a relay query
            and a wall of tiles. Any of them can be copied to the clipboard, saved as a PLY that
            Blender opens, or remixed, which opens a copy here under your own key. A remix is a
            copy and never a reference: it gets its own id, so publishing it writes a new object
            rather than touching theirs.
          </Explanation>
        </section>

        <section className="panel">
          <header className="panel__head">
            <h2>Workshop</h2>
            <span className="tag tag--local">{shards.length}</span>
          </header>
          {shards.length === 0 ? (
            <p className="menu__line">Nothing built yet.</p>
          ) : (
            <ul className="menu__list">
              {shards.map((s) => {
                const state = publishState(ledger[s.id], shardFingerprint(s), pubkey)
                return (
                  <li key={s.id} className={s.id === currentId ? 'is-current' : ''}>
                    <button className="menu__pick" onClick={() => open(s.id)} title={STATE_HELP[state]}>
                      <span className="menu__pick-name">{s.name}</span>
                      <span className="menu__pick-meta">{s.vertices.length} v · {s.faces.length} f · {s.mode}</span>
                    </button>
                    <span className={`tag ${STATE_TAG[state]} menu__state`} title={STATE_HELP[state]}>{STATE_LABEL[state]}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <button className="workshop__btn menu__wide" onClick={() => go('make')}>OPEN THE WORKSHOP</button>
          <Explanation>
            PUBLISHED means relays hold that object and it has not changed here since. EDITED means
            it went out and has been changed on the bench, so what the relays hold is the older one
            until you publish again. DRAFT means it has never left this browser. OTHER KEY means it
            went out under a different key: an object's address is the key plus its id, so
            publishing it now would write a second object rather than replace the first.
          </Explanation>
        </section>

        <RelaysPanel />

        {/* What this is, last: somebody arriving wants the two buttons and their
            key, and reads the description once. Each link sits under the
            sentence that gives a reason to follow it. */}
        <div className="menu__about explain__well">
          <p>
            SNO is a simple 3D object format made to travel with a nostr event. It is
            intentionally minimal and uses colored whole-unit vertices (with subdivision
            snapping) which can be connected with triangular faces. You can set a 2^X scale
            multiplier to control the output scale of the object.
          </p>
          <div className="menu__links">
            {/* TODO: DECK-0003-sno.md, once arkin0x/cyberspace#27 merges. SNO
                claims deck 3 in that pull request; on master it is still 4, and
                this has to be the file that exists or it is a dead link. */}
            <a className="menu__link" href="https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0004-sno.md" target="_blank" rel="noreferrer">THE SPECIFICATION</a>
            <a className="menu__link" href="https://github.com/arkin0x/snocrash" target="_blank" rel="noreferrer">THE SOURCE</a>
          </div>
          <p>
            SNO is similar to the PLY format (1994) which many 3D applications can load, so
            Snocrash exports a PLY file when you download an object.
          </p>
          <div className="menu__links">
            <a className="menu__link" href="https://paulbourke.net/dataformats/ply/" target="_blank" rel="noreferrer">THE PLY FORMAT</a>
          </div>
          <p>
            Having a 3D object format native to nostr enables remixing and collaborating in a
            whole new way!
          </p>
        </div>

        <div className="menu__version" title="The day of the commit this build came from, and its short hash">{__SNOCRASH_VERSION__}</div>
      </div>
    </div>
  )
}
