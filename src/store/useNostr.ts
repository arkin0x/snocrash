/**
 * useNostr.ts - the identity, the relays, and the two things this app does
 * with them: publish an object and read the ones other people published.
 *
 * DECK-0004 §3.1: a standalone object is a `kind 33331` event, addressable, so
 * relays keep the newest per (pubkey, kind, d). The `d` is the object's own id,
 * stable across edits, which is what lets someone fix a mistake in an object
 * without publishing a second copy of it. The payload in `content` is exactly
 * what the workshop already writes, and it goes out as `v: 2`, the published
 * frame, which any glTF-minded tool can read without a special case.
 *
 * Keys: a browser extension when there is one (NIP-07), and otherwise a key
 * this app generates and keeps in localStorage. The second is a real key with
 * real consequences, so it says so in the UI rather than pretending to be a
 * login. Nothing here touches Cyberspace: an object has no coordinate and this
 * app never computes one.
 */

import { create } from 'zustand'
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools'
import { fromPayload, toPayload, type ShardModel } from '../lib/shards'

/** DECK-0004 §3.1. Addressable: the newest event per (pubkey, kind, d) stands. */
export const SNO_KIND = 33331

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
]

const SK_KEY = 'snocrash:sk'

/** An object someone published, with the event it came from. */
export interface FeedObject {
  id: string
  pubkey: string
  createdAt: number
  /** The `d` tag: this object's identity, stable across its edits. */
  d: string
  shard: ShardModel
}

export type SignerKind = 'none' | 'local' | 'extension'

interface Nip07 {
  getPublicKey: () => Promise<string>
  signEvent: (e: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Event>
}

function extension(): Nip07 | null {
  const w = window as unknown as { nostr?: Nip07 }
  return w.nostr ?? null
}

function loadSecret(): Uint8Array | null {
  try {
    const hex = localStorage.getItem(SK_KEY)
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null
    return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))
  } catch { return null }
}

function saveSecret(sk: Uint8Array): void {
  try { localStorage.setItem(SK_KEY, [...sk].map((b) => b.toString(16).padStart(2, '0')).join('')) } catch { /* private mode */ }
}

interface NostrState {
  pubkey: string | null
  signer: SignerKind
  relays: string[]
  feed: FeedObject[]
  loading: boolean
  publishing: boolean
  notice: string | null
  /** Pick up whatever identity is already available, without prompting. */
  init: () => Promise<void>
  /** Make a key in this browser and keep it. */
  useLocalKey: () => void
  /** Ask the extension for its key, which is the only prompt this app makes. */
  useExtension: () => Promise<void>
  npub: () => string | null
  publish: (shard: ShardModel) => Promise<boolean>
  loadFeed: () => Promise<void>
  say: (note: string | null) => void
}

const pool = new SimplePool()

/** The event an object goes out as. Pure, so the shape is testable without a relay. */
export function objectTemplate(shard: ShardModel, createdAt: number): { kind: number; created_at: number; tags: string[][]; content: string } {
  const payload = toPayload(shard)
  return {
    kind: SNO_KIND,
    created_at: createdAt,
    tags: [
      // The object's own id: addressable means the author can fix it in place.
      ['d', shard.id],
      ['name', shard.name],
      // What a client that cannot draw it should say instead (NIP-31).
      ['alt', `a 3D object: ${shard.name}, ${shard.vertices.length} vertices`],
    ],
    content: JSON.stringify(payload),
  }
}

/** The object an event carries, or null when it is not one or is malformed. */
export function objectFromEvent(ev: Event): FeedObject | null {
  if (ev.kind !== SNO_KIND) return null
  const d = ev.tags.find((t) => t[0] === 'd')?.[1]
  if (!d) return null
  let shard: ShardModel | null = null
  try { shard = fromPayload(JSON.parse(ev.content), `${ev.pubkey}:${d}`) } catch { return null }
  if (!shard || shard.vertices.length === 0) return null
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, d, shard }
}

export const useNostr = create<NostrState>((set, get) => ({
  pubkey: null,
  signer: 'none',
  relays: DEFAULT_RELAYS,
  feed: [],
  loading: false,
  publishing: false,
  notice: null,

  init: async () => {
    const sk = loadSecret()
    if (sk) { set({ pubkey: getPublicKey(sk), signer: 'local' }); return }
    // An extension that is already unlocked answers without a prompt; one that
    // is not will ask, so this is only tried when the user asks for it.
  },

  useLocalKey: () => {
    const sk = loadSecret() ?? generateSecretKey()
    saveSecret(sk)
    set({ pubkey: getPublicKey(sk), signer: 'local', notice: 'A key was made in this browser. It lives here and nowhere else.' })
  },

  useExtension: async () => {
    const ext = extension()
    if (!ext) { set({ notice: 'No nostr extension found in this browser.' }); return }
    try {
      const pk = await ext.getPublicKey()
      set({ pubkey: pk, signer: 'extension', notice: null })
    } catch {
      set({ notice: 'The extension refused.' })
    }
  },

  npub: () => {
    const pk = get().pubkey
    try { return pk ? nip19.npubEncode(pk) : null } catch { return null }
  },

  publish: async (shard) => {
    const { signer, relays } = get()
    if (signer === 'none') { set({ notice: 'Pick a key first.' }); return false }
    if (shard.vertices.length === 0) { set({ notice: 'An empty object has nothing to publish.' }); return false }
    set({ publishing: true, notice: null })
    const template = objectTemplate(shard, Math.floor(Date.now() / 1000))
    try {
      let signed: Event
      if (signer === 'extension') {
        const ext = extension()
        if (!ext) throw new Error('the extension went away')
        signed = await ext.signEvent(template)
      } else {
        const sk = loadSecret()
        if (!sk) throw new Error('no key in this browser')
        signed = finalizeEvent(template, sk)
      }
      const results = await Promise.allSettled(pool.publish(relays, signed))
      const took = results.filter((r) => r.status === 'fulfilled').length
      set({
        publishing: false,
        notice: took > 0 ? `"${shard.name}" is published to ${took} of ${relays.length} relays.` : 'No relay took it.',
      })
      if (took > 0) void get().loadFeed()
      return took > 0
    } catch (err) {
      set({ publishing: false, notice: `Could not publish: ${err instanceof Error ? err.message : String(err)}` })
      return false
    }
  },

  loadFeed: async () => {
    set({ loading: true })
    try {
      const events = await pool.querySync(get().relays, { kinds: [SNO_KIND], limit: 100 }, { maxWait: 8000 })
      // Addressable: one object per (pubkey, d), the newest of them.
      const newest = new Map<string, Event>()
      for (const ev of events) {
        const d = ev.tags.find((t) => t[0] === 'd')?.[1]
        if (!d) continue
        const key = `${ev.pubkey}:${d}`
        const prev = newest.get(key)
        if (!prev || ev.created_at > prev.created_at) newest.set(key, ev)
      }
      const feed = [...newest.values()]
        .map(objectFromEvent)
        .filter((o): o is FeedObject => o !== null)
        .sort((a, b) => b.createdAt - a.createdAt)
      set({ feed, loading: false })
    } catch {
      set({ loading: false, notice: 'Could not reach the relays.' })
    }
  },

  say: (note) => set({ notice: note }),
}))
