/**
 * retract.test.ts - RETRACT (NIP-09), ONOSENDAI's, in snocrash's store.
 *
 * A retraction is a kind 5 naming the object's address, its event id when
 * known, and the kind it was (`k`), exactly as ONOSENDAI's retractionTemplate
 * writes it. It goes through the same path as PUBLISH: signed with the
 * signer's patience, cancellable from the chip, and checked against the
 * current key once signed and again right before sending. The relays'
 * sign-in and the pool's send are stand-ins here: nothing reaches a relay.
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

const relays = vi.hoisted(() => ({
  /** When set, the relays' sign-in waits until the test finishes it. */
  hold: false,
  signedIn: null as null | (() => void),
  sent: [] as Array<{ kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; id: string }>,
  sendingThen: [] as boolean[],
  /** What each send answers: true for a relay that took it. */
  takes: true,
}))

vi.mock('../lib/pool', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/pool')>()
  return {
    ...real,
    authAll: () => (relays.hold ? new Promise<void>((resolve) => { relays.signedIn = resolve }) : Promise.resolve()),
  }
})

import { newShard } from 'sno-core/shards'
import { pool } from '../lib/pool'
import { retractionTemplate, useNostr } from './useNostr'
import { useRelays } from './useRelays'

const n = () => useNostr.getState()
const shard = { ...newShard('lamp'), id: 'lamp-d', vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }

beforeEach(() => {
  relays.hold = false
  relays.signedIn = null
  relays.sent = []
  relays.sendingThen = []
  relays.takes = true
  vi.spyOn(pool, 'publish').mockImplementation((_urls, ev) => {
    relays.sendingThen.push(n().sending)
    relays.sent.push(ev as (typeof relays.sent)[number])
    return [relays.takes ? Promise.resolve('ok') : Promise.reject(new Error('blocked: no'))]
  })
  // A send that goes out reloads the feed, which would open real sockets.
  useNostr.setState({ loadFeed: async () => {}, published: {} })
  useRelays.setState({ relays: ['wss://relay.test'] } as never)
  n().useNewKey()
})

/** Publish the lamp, as PUBLISH does, and hand back the event that went out. */
async function published(): Promise<(typeof relays.sent)[number]> {
  expect(await n().publish(shard)).toBe(true)
  return relays.sent[relays.sent.length - 1]
}

describe('the retraction event (NIP-09, ONOSENDAI retractionTemplate)', () => {
  it('names the address, the event id and the kind, with the reason as content', () => {
    const pk = 'a'.repeat(64)
    expect(retractionTemplate(pk, 'lamp-d', 'e'.repeat(64), 1_800_000_000, 'object retracted')).toEqual({
      kind: 5,
      created_at: 1_800_000_000,
      content: 'object retracted',
      tags: [['a', `33331:${pk}:lamp-d`], ['e', 'e'.repeat(64)], ['k', '33331']],
    })
  })

  it('by address alone when the event id is not known', () => {
    expect(retractionTemplate('a'.repeat(64), 'lamp-d', undefined, 1, 'object retracted').tags).toEqual([['a', `33331:${'a'.repeat(64)}:lamp-d`], ['k', '33331']])
  })
})

describe('RETRACT', () => {
  it('sends a deletion of your published object, signed by you, and forgets it', async () => {
    const object = await published()
    expect(n().published[shard.id]?.id).toBe(object.id)
    expect(await n().retract(shard)).toBe(true)
    const del = relays.sent[relays.sent.length - 1]
    expect(del.kind).toBe(5)
    expect(del.pubkey).toBe(n().pubkey)
    expect(del.tags).toEqual([['a', `33331:${n().pubkey}:lamp-d`], ['e', object.id], ['k', '33331'], ...del.tags.filter((t) => t[0] === 'client')])
    expect(del.content).toBe('object retracted')
    expect(n().published[shard.id]).toBeUndefined()
    expect(n().notice).toBe('"lamp" is retracted: the deletion went to 1 of 1 relays. Relays that honor it drop the object. PUBLISH puts it back.')
    expect(relays.sendingThen[relays.sendingThen.length - 1]).toBe(true)
    expect(n().retracting).toBe(false)
  })

  it('is newer than the publish before it, and the publish after it newer still, inside one second', async () => {
    const first = await published()
    await n().retract(shard)
    const del = relays.sent[relays.sent.length - 1]
    const again = await published()
    expect(del.created_at).toBeGreaterThan(first.created_at)
    expect(again.created_at).toBeGreaterThan(del.created_at)
  })

  it('refuses an object published under another key, and sends nothing', async () => {
    useNostr.setState({ published: { [shard.id]: { at: 1, fp: '', pubkey: 'b'.repeat(64) } } })
    expect(await n().retract(shard)).toBe(false)
    expect(relays.sent).toHaveLength(0)
    expect(n().notice).toBe('This object was published under another key; only that key can retract it.')
  })

  it('keeps the record when no relay takes the deletion', async () => {
    await published()
    relays.takes = false
    expect(await n().retract(shard)).toBe(false)
    expect(n().published[shard.id]).toBeDefined()
    expect(n().notice).toBe('No relay took the retraction of "lamp".')
  })

  describe('during the relays\' sign-in', () => {
    async function retractingInSignIn(): Promise<{ retracting: Promise<boolean>; before: number }> {
      await published()
      relays.hold = true
      const before = relays.sent.length
      const retracting = n().retract(shard)
      await vi.waitFor(() => expect(relays.signedIn).not.toBeNull())
      return { retracting, before }
    }

    it('a key change sends nothing, and says only the publishing key can retract it', async () => {
      const { retracting, before } = await retractingInSignIn()
      n().useNewKey()
      relays.signedIn!()
      expect(await retracting).toBe(false)
      expect(relays.sent).toHaveLength(before)
      expect(n().notice).toBe('Not retracted: the key changed while the deletion was being signed. Only the key that published "lamp" can retract it.')
    })

    it('a sign-out sends nothing, and says only that', async () => {
      const { retracting, before } = await retractingInSignIn()
      n().signOut()
      relays.signedIn!()
      expect(await retracting).toBe(false)
      expect(relays.sent).toHaveLength(before)
      expect(n().notice).toBe('Signed out, so nothing was retracted.')
    })

    it('the chip calls it off at once, and the record stays', async () => {
      const { retracting, before } = await retractingInSignIn()
      n().cancelPublish()
      expect(await retracting).toBe(false)
      expect(n().notice).toBe('Retraction cancelled. Nothing went out.')
      expect(n().retracting).toBe(false)
      relays.signedIn!()
      expect(relays.sent).toHaveLength(before)
      expect(n().published[shard.id]).toBeDefined()
    })

    it('a publish waits its turn: refused while the retraction is out', async () => {
      const { retracting } = await retractingInSignIn()
      expect(await n().publish(shard)).toBe(false)
      relays.signedIn!()
      expect(await retracting).toBe(true)
    })
  })
})
