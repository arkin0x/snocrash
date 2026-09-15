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
 * cyberspace.nostr1.com is where the objects this format was written for
 * already live, so it goes first; primal and nos.lol are general relays, and
 * they are what makes somebody's first published object findable by people who
 * have never heard of any of this.
 */
export const DEFAULT_RELAYS = [
  'wss://cyberspace.nostr1.com',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

const STORAGE = 'snocrash:relays'

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

function load(): string[] {
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
