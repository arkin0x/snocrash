/**
 * useRelays.ts - which relays this client reads from and publishes to.
 *
 * An object lives wherever somebody put it, so the list is the whole of this
 * app's reach: publishing fans out across every relay in it, and the feed is
 * whatever they hand back. There is no home relay to pin, the way ONOSENDAI
 * pins the one its world lives on, so any of these can go. The list may not be
 * emptied, because a client with no relays is a client that cannot do
 * anything, and the reason would not be obvious from the screen.
 *
 * Persisted, so a relay you added survives a reload. What is stored is the
 * whole list rather than the additions, so removing a default sticks.
 */

import { create } from 'zustand'

/**
 * Where a new arrival reads from, until they say otherwise.
 *
 * relay.onosendai.tech is the cyberspace relay since 2026-11-05: the owner's
 * own relay, holding everything copied from cyberspace.nostr1.com, so it goes
 * first. cyberspace.nostr1.com, where the objects this format was written for
 * first lived, stays second for about two weeks after the switch. The others
 * are general relays, and they are what makes somebody's first published
 * object findable by people who have never heard of any of this.
 *
 * relay.damus.io keeps kind 33331 and is the second relay that actually does
 * (measured 2026-09-28). relay.primal.net answers but returned no kind 33331
 * at all, not even an author's own, and nos.lol hung on connect; they stay
 * because they may recover, and a relay that has nothing costs a read
 * nothing now that each relay is read on its own (lib/pool stream).
 */
export const DEFAULT_RELAYS = [
  'wss://relay.onosendai.tech',
  'wss://cyberspace.nostr1.com',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

const STORAGE = 'snocrash:relays'

/**
 * Defaults that arrived after somebody may already have saved a list. A saved
 * list is the whole list, so without this a returning visitor would never see
 * them. Each is put at the front of a saved list once, and a flag records that
 * it was offered, so removing it afterwards sticks like removing any default.
 */
const LATER_DEFAULTS: readonly { url: string; flag: string }[] = [
  { url: 'wss://relay.onosendai.tech', flag: 'snocrash:relays:offered:relay.onosendai.tech' },
]

/** The list with each later default offered once; the same array when nothing changed. */
export function addLaterDefaults(list: string[]): string[] {
  let out = list
  for (const { url, flag } of LATER_DEFAULTS) {
    let offered = false
    try { offered = localStorage.getItem(flag) !== null } catch { /* private mode */ }
    if (offered) continue
    if (!out.includes(url)) out = [url, ...out]
    try { localStorage.setItem(flag, '1') } catch { /* private mode */ }
  }
  return out
}

/** ws:// or wss:// with a real host; null for anything else. */
export function normalizeRelay(input: string): string | null {
  const s = input.trim()
  // A relay URL has no spaces; a "host" with one is a typo, not an address.
  if (!s || /\s/.test(s)) return null
  const withScheme = /^wss?:\/\//i.test(s) ? s : `wss://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null
    if (!/^[a-z0-9.-]+$/i.test(u.hostname)) return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.protocol}//${u.host}${path}`.replace(/\/$/, '')
  } catch {
    return null
  }
}

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw === null) return [...DEFAULT_RELAYS]
    const list = JSON.parse(raw) as unknown
    const urls = Array.isArray(list)
      ? [...new Set(list.map((x) => (typeof x === 'string' ? normalizeRelay(x) : null)).filter((x): x is string => !!x))]
      : []
    return urls.length ? urls : [...DEFAULT_RELAYS]
  } catch {
    return [...DEFAULT_RELAYS]
  }
}

function save(relays: string[]): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(relays)) } catch { /* private mode */ }
}

/** The saved list (or the defaults), with any later default offered once and the result saved if it changed. */
export function load(): string[] {
  const saved = loadSaved()
  const relays = addLaterDefaults(saved)
  if (relays !== saved) save(relays)
  return relays
}

interface RelaysState {
  relays: string[]
  /** The normalized URL that was added or already present, or null if it is not one. */
  add: (url: string) => string | null
  /** Remove a relay, unless it is the last one. */
  remove: (url: string) => void
  reset: () => void
}

export const useRelays = create<RelaysState>((set, get) => ({
  relays: load(),

  add: (url) => {
    const norm = normalizeRelay(url)
    if (!norm) return null
    if (get().relays.includes(norm)) return norm
    const relays = [...get().relays, norm]
    set({ relays })
    save(relays)
    return norm
  },

  remove: (url) => {
    const relays = get().relays.filter((r) => r !== url)
    if (relays.length === 0) return
    set({ relays })
    save(relays)
  },

  reset: () => {
    const relays = [...DEFAULT_RELAYS]
    set({ relays })
    save(relays)
  },
}))

/** The list, for the code that is not a React component. */
export const relaySet = (): string[] => useRelays.getState().relays
