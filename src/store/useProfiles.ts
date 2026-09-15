/**
 * useProfiles.ts - who a pubkey is, cached.
 *
 * A pubkey on its own is unintelligible. Its kind:0 carries a name and a
 * picture, and that is what turns a wall of objects into a wall of objects
 * somebody made. Components ask by pubkey; this batches the misses into one
 * query, caches what comes back, and keeps the cache in localStorage so a
 * reload does not fetch the world again.
 *
 * The whole cache is one reactive record, so a tile that reads one profile
 * re-renders when that profile lands without every tile holding a
 * subscription of its own.
 *
 * This is ONOSENDAI's profile cache, smaller. It asks the relays this app is
 * configured for and no others: there is no auth-gated world relay here to
 * work around, and a relay somebody added for objects is as good a place to
 * find their kind:0 as any.
 */

import { create } from 'zustand'
import type { Event } from 'nostr-tools'
import { queryAny } from '../lib/pool'
import { relaySet } from './useRelays'

export interface Profile {
  pubkey: string
  name: string | null
  picture: string | null
  /** created_at of the kind:0 this came from, so a newer one wins. */
  at: number
}

const STORAGE = 'snocrash:profiles'
const HEX = /^[0-9a-f]{64}$/
/** Refetch a cached profile after a day, in case it changed. */
const TTL_MS = 24 * 60 * 60 * 1000
/** Authors per query. */
const CHUNK = 100
/** How long to gather asks before sending one query for all of them. */
const FLUSH_MS = 250
const PROFILE_WAIT_MS = 5000

function loadCache(): Record<string, Profile | null> {
  try {
    const raw = localStorage.getItem(STORAGE)
    const data = raw ? JSON.parse(raw) : {}
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch { return {} }
}

let saveHandle: number | null = null
function saveCacheSoon(cache: Record<string, Profile | null>): void {
  if (saveHandle !== null) return
  saveHandle = window.setTimeout(() => {
    saveHandle = null
    try {
      // Only real profiles are worth keeping; a miss can be retried for free.
      const keep: Record<string, Profile> = {}
      for (const [pk, p] of Object.entries(cache)) if (p) keep[pk] = p
      localStorage.setItem(STORAGE, JSON.stringify(keep))
    } catch { /* quota or private mode */ }
  }, 1000)
}

/** A kind:0 as a Profile, or null when its content is not usable JSON. */
export function parseProfile(ev: Event): Profile | null {
  try {
    const meta = JSON.parse(ev.content) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      pubkey: ev.pubkey,
      name: str(meta.display_name) ?? str(meta.name),
      picture: str(meta.picture),
      at: ev.created_at,
    }
  } catch { return null }
}

interface ProfilesState {
  /** null = asked, nothing found; undefined = never asked. */
  profiles: Record<string, Profile | null>
  /** Ask for one. A miss joins the next batch; a fresh hit costs nothing. */
  request: (pubkey: string) => void
}

const pending = new Set<string>()
let flushHandle: number | null = null

export const useProfiles = create<ProfilesState>((set, get) => {
  async function flush(): Promise<void> {
    flushHandle = null
    const want = [...pending]
    pending.clear()
    if (want.length === 0) return

    for (let i = 0; i < want.length; i += CHUNK) {
      const authors = want.slice(i, i + CHUNK)
      let events: Event[] = []
      try { events = await queryAny(relaySet(), { kinds: [0], authors }, PROFILE_WAIT_MS) } catch { /* relays down */ }

      const newest = new Map<string, Profile>()
      for (const ev of events) {
        const p = parseProfile(ev)
        if (p && (!newest.has(p.pubkey) || p.at > (newest.get(p.pubkey) as Profile).at)) newest.set(p.pubkey, p)
      }
      const next = { ...get().profiles }
      // Every author asked for gets an answer, a miss included, so the same
      // pubkey is not asked again on every render.
      for (const pk of authors) next[pk] = newest.get(pk) ?? null
      set({ profiles: next })
      saveCacheSoon(next)
    }
  }

  return {
    profiles: loadCache(),

    request: (pubkey) => {
      if (!HEX.test(pubkey)) return
      const have = get().profiles[pubkey]
      const stamp = fetchedAt.get(pubkey)
      const fresh = have !== undefined && stamp !== undefined && Date.now() - stamp < TTL_MS
      if (fresh || pending.has(pubkey)) return
      pending.add(pubkey)
      if (flushHandle === null) flushHandle = window.setTimeout(() => void flush(), FLUSH_MS)
    },
  }
})

/**
 * When each profile was answered, so the TTL can refetch a stale one.
 *
 * Outside the store on purpose: it is not state anything renders, and putting
 * it in would make every profile that arrives re-render every component that
 * reads any profile.
 */
const fetchedAt = new Map<string, number>()
useProfiles.subscribe((s, prev) => {
  if (s.profiles === prev.profiles) return
  const now = Date.now()
  for (const pk of Object.keys(s.profiles)) if (s.profiles[pk] !== prev.profiles[pk]) fetchedAt.set(pk, now)
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __profiles?: unknown }).__profiles = useProfiles
}
