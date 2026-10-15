/**
 * seenOn.test.ts - the pool remembers which relay each event came from
 * (review of parity #35). nostr-tools leaves that off by default, so every
 * relay hint read from pool.seenOn came out empty: an object's link, a
 * deep-linked object's credit, a palette's pointer. The real pool and the real
 * fetchObject run here against a relay that lives in memory: the pool's
 * WebSocket is swapped for one that answers a REQ itself, so nothing leaves
 * the process.
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
import { pool } from '../lib/pool'
import { decodeObjectAddress, objectAddress, useNostr } from './useNostr'
import { useRelays } from './useRelays'

const RELAY = 'wss://memory.relay.test/'
const sk = generateSecretKey()
const pubkey = getPublicKey(sk)
const LAMP: Event = finalizeEvent({
  kind: 33331, created_at: 1_800_000_000, tags: [['d', 'lamp'], ['name', 'lamp']],
  content: JSON.stringify({ v: 2, name: 'lamp', unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] }),
}, sk)

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
    const filters = msg.slice(2) as Array<{ kinds?: number[]; authors?: string[]; '#d'?: string[] }>
    const hit = (f: (typeof filters)[number]): boolean =>
      (!f.kinds || f.kinds.includes(LAMP.kind)) && (!f.authors || f.authors.includes(LAMP.pubkey))
      && (!f['#d'] || f['#d'].includes('lamp'))
    setTimeout(() => {
      if (filters.some(hit)) this.onmessage?.({ data: JSON.stringify(['EVENT', sub, LAMP]) })
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
    useRelays.setState({ relays: [RELAY] } as never)
  })

  it('an object fetched by its link says which relay had it, and its own link names that relay', async () => {
    const link = nip19.naddrEncode({ kind: 33331, pubkey, identifier: 'lamp', relays: [] })
    const o = await useNostr.getState().fetchObject(link)
    expect(o?.id).toBe(LAMP.id)
    expect(o?.seen).toEqual([RELAY])
    // The credit an edit of it carries, and the link to it, name the relay too.
    expect(o?.seen?.[0]).toBe(RELAY)
    expect(decodeObjectAddress(objectAddress(o!))?.relays).toEqual([RELAY])
  })
})
