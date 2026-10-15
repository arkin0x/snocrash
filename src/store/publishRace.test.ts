/**
 * publishRace.test.ts - what happens between the signature and the send
 * (review of parity #35). The relays' sign-in (authAll) comes after the
 * signature and can take a while; a key change or a sign-out in that window
 * must not let the old key's event go out, and the PUBLISHING chip must call
 * the publish off at once rather than after the sign-in. authAll and the
 * pool's publish are stand-ins here, so nothing reaches a relay.
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
  /** Finishes the relays' sign-in in flight. */
  signedIn: null as null | (() => void),
  sent: [] as unknown[],
  /** What the store said about sending at the moment the event went out. */
  sendingThen: [] as boolean[],
}))

vi.mock('../lib/pool', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/pool')>()
  return {
    ...real,
    authAll: () => new Promise<void>((resolve) => { relays.signedIn = resolve }),
  }
})

import { newShard } from 'sno-core/shards'
import { pool } from '../lib/pool'
import { useNostr } from './useNostr'
import { useRelays } from './useRelays'

const n = () => useNostr.getState()
const shard = { ...newShard('probe'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
const KEY_CHANGED = 'Not published: the key changed while it was being signed. Publish again to sign it with the current key.'

describe('between the signature and the send', () => {
  beforeEach(() => {
    relays.signedIn = null
    relays.sent = []
    relays.sendingThen = []
    vi.spyOn(pool, 'publish').mockImplementation((_urls, ev) => { relays.sendingThen.push(n().sending); relays.sent.push(ev); return [Promise.resolve('ok')] })
    // A publish that goes out reloads the feed, which would open real sockets.
    useNostr.setState({ loadFeed: async () => {} })
    useRelays.setState({ relays: ['wss://relay.test'] } as never)
    n().useNewKey()
  })

  /** Start a publish and wait until it is in the relays' sign-in (wrapped: an async function would await it). */
  async function inSignIn(): Promise<{ publishing: Promise<boolean> }> {
    const publishing = n().publish(shard)
    await vi.waitFor(() => expect(relays.signedIn).not.toBeNull())
    return { publishing }
  }

  it('a key change during the sign-in sends nothing, and says the key changed', async () => {
    const { publishing } = await inSignIn()
    n().useNewKey()
    relays.signedIn!()
    expect(await publishing).toBe(false)
    expect(relays.sent).toHaveLength(0)
    expect(n().notice).toBe(KEY_CHANGED)
  })

  it('a sign-out during the sign-in sends nothing, and says only that', async () => {
    const { publishing } = await inSignIn()
    n().signOut()
    relays.signedIn!()
    expect(await publishing).toBe(false)
    expect(relays.sent).toHaveLength(0)
    expect(n().notice).toBe('Signed out, so nothing was published.')
  })

  it('the chip calls it off at once, without waiting for the sign-in', async () => {
    const { publishing } = await inSignIn()
    n().cancelPublish()
    expect(await publishing).toBe(false)
    expect(n().notice).toBe('Publishing cancelled. Nothing went out.')
    expect(n().publishing).toBe(false)
    relays.signedIn!()
    expect(relays.sent).toHaveLength(0)
  })

  it('once it is going out, the chip says so (sending), and it goes', async () => {
    const { publishing } = await inSignIn()
    relays.signedIn!()
    await vi.waitFor(() => expect(relays.sent).toHaveLength(1))
    expect(relays.sendingThen).toEqual([true])
    expect(await publishing).toBe(true)
    expect(n().sending).toBe(false)
  })
})
