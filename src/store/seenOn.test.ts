/**
 * seenOn.test.ts - where an event was seen, for the relay hints made from it
 * (review of parity #35): an object's link, a deep-linked object's credit, a
 * palette's pointer. The relays come from the read itself (readEach hands
 * each event over with its relay; queryAny keeps them), and the pool keeps no
 * map of its own: nostr-tools' trackRelays held every relay message whole for
 * the session. The real pool, readEach, fetchObject and fetchPalette run here
 * against relays that live in memory: the pool's WebSocket is swapped for one
 * that answers a REQ itself, so nothing leaves the process.
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

import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools'
import { pool, queryAny } from '../lib/pool'
import { decodeObjectAddress, objectAddress, useNostr } from './useNostr'
import { useRelays } from './useRelays'

const ONE = 'wss://one.memory.test/'
const TWO = 'wss://two.memory.test/'
const sk = generateSecretKey()
const pubkey = getPublicKey(sk)
const LAMP: Event = finalizeEvent({
  kind: 33331, created_at: 1_800_000_000, tags: [['d', 'lamp'], ['name', 'lamp']],
  content: JSON.stringify({ v: 2, name: 'lamp', unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] }),
}, sk)
const PALETTE: Event = finalizeEvent({
  kind: 3367, created_at: 1_800_000_000, tags: [['c', '#FF0000'], ['c', '#00FF00'], ['name', 'two']], content: '',
}, sk)
/** What each relay in memory holds: the lamp on both, the palette on the second only. */
const HELD: Record<string, Event[]> = { [ONE]: [LAMP], [TWO]: [LAMP, PALETTE] }

type Filter = { ids?: string[]; kinds?: number[]; authors?: string[]; '#d'?: string[] }
const matches = (f: Filter, ev: Event): boolean =>
  (!f.ids || f.ids.includes(ev.id)) && (!f.kinds || f.kinds.includes(ev.kind))
  && (!f.authors || f.authors.includes(ev.pubkey))
  && (!f['#d'] || ev.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1])))

/** A relay in memory: answers each REQ with the events it holds that match, then EOSE. */
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
    if (msg[0] !== 'REQ') return
    const sub = msg[1] as string
    const filters = msg.slice(2) as Filter[]
    const held = HELD[this.url] ?? []
    setTimeout(() => {
      for (const ev of held) if (filters.some((f) => matches(f, ev))) this.onmessage?.({ data: JSON.stringify(['EVENT', sub, ev]) })
      this.onmessage?.({ data: JSON.stringify(['EOSE', sub]) })
    }, 0)
  }
  close(): void {
    this.readyState = MemoryRelay.CLOSED
    this.onclose?.({ code: 1000, reason: '' })
  }
}

describe('where an event was seen', () => {
  beforeAll(() => {
    ;(pool as unknown as { _WebSocket: unknown })._WebSocket = MemoryRelay
    useRelays.setState({ relays: [ONE, TWO] } as never)
  })

  it('a read keeps every relay that sent each event', async () => {
    const found = await queryAny([ONE, TWO], { kinds: [33331], authors: [pubkey] })
    expect(found).toHaveLength(1)
    expect(found[0].event.id).toBe(LAMP.id)
    expect([...found[0].relays].sort()).toEqual([ONE, TWO])
  })

  it('an object fetched by its link says which relays had it, and its own link names them', async () => {
    const link = nip19.naddrEncode({ kind: 33331, pubkey, identifier: 'lamp', relays: [] })
    const o = await useNostr.getState().fetchObject(link)
    expect(o?.id).toBe(LAMP.id)
    expect([...(o?.seen ?? [])].sort()).toEqual([ONE, TWO])
    // The link to it, and so the relay a credit to it names, come from there.
    expect([...(decodeObjectAddress(objectAddress(o!))?.relays ?? [])].sort()).toEqual([ONE, TWO])
  })

  it("a palette fetched by its pointer names the relay that had it", async () => {
    const got = await useNostr.getState().fetchPalette(nip19.neventEncode({ id: PALETTE.id }))
    expect(got?.event.relays).toEqual([TWO])
  })

  it('the pool keeps no map of which relay sent which event', () => {
    // nostr-tools' own trackRelays: it held each relay message whole for the session.
    expect(pool.trackRelays).toBe(false)
    expect(pool.seenOn.size).toBe(0)
  })
})
