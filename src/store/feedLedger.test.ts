/**
 * feedLedger.test.ts - what a feed load writes in the ledger (review of
 * parity #36). An object of yours that comes back from a relay is noted as
 * published, with the event id a retraction will name; and only the newest
 * load writes, so an older one finishing late cannot put back a record a
 * retraction just forgot. createFeed is a stand-in whose loads finish when the
 * test says; nothing reaches a relay.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const loads = vi.hoisted(() => ({
  /** Each load: what it shows, and how to let it finish. */
  open: [] as Array<{ show: (objects: unknown[]) => void; finish: () => void }>,
}))

vi.mock('sno-core/feed', async (importOriginal) => {
  const real = await importOriginal<typeof import('sno-core/feed')>()
  return {
    ...real,
    createFeed: (opts: { onChange: (st: { objects: unknown[] }) => void }) => {
      let finish!: () => void
      const done = new Promise<void>((resolve) => { finish = resolve })
      loads.open.push({ show: (objects) => opts.onChange({ objects }), finish })
      return { more: () => done, close: () => {} }
    },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { objectFromEvent } from 'sno-core/feed'
import { useNostr } from './useNostr'

const n = () => useNostr.getState()
const sk = generateSecretKey()
const me = getPublicKey(sk)
const LAMP = objectFromEvent(finalizeEvent({
  kind: 33331, created_at: 1_800_000_000, tags: [['d', 'lamp-d'], ['name', 'lamp']],
  content: JSON.stringify({ v: 2, name: 'lamp', unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] }),
}, sk))!

beforeEach(() => {
  loads.open = []
  useNostr.setState({ pubkey: me, published: {}, scope: 'global' })
})

describe('a feed load and the ledger', () => {
  it('notes your object as published, with the event id a retraction will name', async () => {
    const loading = n().loadFeed()
    loads.open[0].show([LAMP])
    loads.open[0].finish()
    await loading
    expect(n().published['lamp-d']).toEqual({ at: LAMP.createdAt, fp: '', pubkey: me, id: LAMP.id })
  })

  it('an older load finishing late does not put back a record a retraction forgot', async () => {
    const older = n().loadFeed()
    const newer = n().loadFeed()
    loads.open[1].show([LAMP])
    loads.open[1].finish()
    await newer
    expect(n().published['lamp-d']).toBeDefined()
    // RETRACT forgets it...
    useNostr.setState({ published: {} })
    // ...and the older load, which saw it too, finishes after.
    loads.open[0].finish()
    await older
    expect(n().published['lamp-d']).toBeUndefined()
  })
})
