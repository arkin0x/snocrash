/**
 * listings.test.ts - an object for sale on Fanfares comes back from the feed
 * read as a listing, apart from the objects: never in `feed`, where opening,
 * remixing and stamping read from, and never one hidden at a place. The real
 * pool and sno-core's feed run against a relay in memory (as seenOn.test.ts
 * does): nothing leaves the process, and the fixture is never published.
 */

import { beforeAll, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// The read path keeps its timers on window, which the test environment has not.
if (typeof window === 'undefined') (globalThis as { window?: unknown }).window = globalThis

import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools'
import { pool } from '../lib/pool'
import { useNostr } from './useNostr'
import { useRelays } from './useRelays'
import { LISTING } from './fixtures/listing'

const ONE = 'wss://one.memory.test/'
const sk = generateSecretKey()
const LAMP: Event = finalizeEvent({
  kind: 33331, created_at: 1_792_000_100, tags: [['d', 'lamp'], ['name', 'lamp']],
  content: JSON.stringify({ v: 2, name: 'lamp', unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] }),
}, sk)
const HIDDEN: Event = finalizeEvent({
  kind: 33331, created_at: 1_792_000_050, tags: [['d', 'hid'], ['encrypted', 'aes-256-gcm', 'eA==', 'cyberspace:region']], content: 'something is hidden here',
}, sk)
const HELD: Event[] = [LAMP, LISTING, HIDDEN]

type Filter = { ids?: string[]; kinds?: number[]; authors?: string[] }
const matches = (f: Filter, ev: Event): boolean =>
  (!f.ids || f.ids.includes(ev.id)) && (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey))

/** A relay in memory: answers each REQ with what it holds that matches, then EOSE. */
class MemoryRelay {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = MemoryRelay.CONNECTING
  url: string
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(url: string) {
    this.url = url
    setTimeout(() => { this.readyState = MemoryRelay.OPEN; this.onopen?.({}) }, 0)
  }
  send(raw: string): void {
    const msg = JSON.parse(raw) as unknown[]
    // Only reads are answered; nothing is ever published to it.
    if (msg[0] !== 'REQ') return
    const sub = msg[1] as string
    const filters = msg.slice(2) as Filter[]
    setTimeout(() => {
      for (const ev of HELD) if (filters.some((f) => matches(f, ev))) this.onmessage?.({ data: JSON.stringify(['EVENT', sub, ev]) })
      this.onmessage?.({ data: JSON.stringify(['EOSE', sub]) })
    }, 0)
  }
  close(): void {
    this.readyState = MemoryRelay.CLOSED
    this.onclose?.({ code: 1000, reason: '' })
  }
}

describe('objects for sale in the feed', () => {
  beforeAll(() => {
    ;(pool as unknown as { _WebSocket: unknown })._WebSocket = MemoryRelay
    useRelays.setState({ relays: [ONE] } as never)
  })

  it('a listing is a listing, the object an object, and one hidden at a place neither', async () => {
    await useNostr.getState().loadFeed()
    const s = useNostr.getState()
    expect(s.feed.map((o) => o.d)).toEqual(['lamp'])
    expect(s.listings.map((l) => [l.title, l.priceSats, l.keyService])).toEqual([['Brass Orrery', 2100, 'https://keys.example.com/request-key']])
    expect(s.listings[0].seen).toEqual([ONE])
  })

  it('a fresh read clears the listings before it reads, as it clears the objects', async () => {
    expect(useNostr.getState().listings).toHaveLength(1)
    const reading = useNostr.getState().loadFeed()
    expect(useNostr.getState().listings).toEqual([])
    expect(useNostr.getState().feed).toEqual([])
    await reading
    expect(useNostr.getState().listings).toHaveLength(1)
  })
})
