/**
 * wakeSigner.test.ts - the tab coming back from another app (review of
 * parity #35). A saved bunker that has not connected yet is left alone: a
 * wake does not start its connect, which would ask the phone for an approval
 * nobody wanted. Once connected, a wake drops the bunker's relay sockets, as
 * before, so the next request goes out over live ones. The page's document
 * is a stand-in that hands over its visibility listener, and the bunker
 * answers only when the test says; nothing reaches a relay.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const page = vi.hoisted(() => {
  const state = { wake: null as null | (() => void) }
  // Before useNostr loads: it listens for the tab coming back at import.
  ;(globalThis as { document?: unknown }).document = {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') state.wake = fn },
  }
  return state
})

const fake = vi.hoisted(() => ({
  connects: 0,
  pubkey: '',
  answer: null as null | (() => void),
  sign: null as null | ((t: unknown) => Promise<unknown>),
}))

vi.mock('nostr-tools/nip46', async (importOriginal) => {
  const real = await importOriginal<typeof import('nostr-tools/nip46')>()
  return {
    ...real,
    parseBunkerInput: async () => ({ pubkey: fake.pubkey, relays: ['wss://bunker.invalid'], secret: null }),
    BunkerSigner: {
      fromBunker: () => ({
        connect: () => { fake.connects++; return new Promise<void>((resolve) => { fake.answer = resolve }) },
        getPublicKey: async () => fake.pubkey,
        signEvent: (t: unknown) => fake.sign!(t),
        close: async () => {},
      }),
    },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type EventTemplate } from 'nostr-tools'
import { newShard } from 'sno-core/shards'
import { pool } from '../lib/pool'
import { saveSignerPref } from '../lib/signers'
import { useNostr } from './useNostr'
import { useRelays } from './useRelays'

const sk = generateSecretKey()
const shard = { ...newShard('probe'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }

describe('the tab coming back', () => {
  beforeAll(async () => {
    fake.pubkey = getPublicKey(sk)
    fake.sign = async (t) => finalizeEvent(t as EventTemplate, sk)
    useRelays.setState({ relays: [] } as never)
    saveSignerPref({ kind: 'nip46', pubkey: fake.pubkey, bunkerUri: 'bunker://x', clientNsec: nip19.nsecEncode(generateSecretKey()) })
    await useNostr.getState().init()
    expect(page.wake).not.toBeNull()
  })

  it('leaves a saved bunker that has not connected yet alone: no connect before the first signature', async () => {
    page.wake!()
    await new Promise((r) => setTimeout(r, 20))
    expect(fake.connects).toBe(0)
  })

  it("once it is connected, drops the bunker's relay sockets", async () => {
    const publishing = useNostr.getState().publish(shard)
    await vi.waitFor(() => expect(fake.connects).toBe(1))
    fake.answer!()
    await publishing
    expect(useNostr.getState().notice).toBe('No relay took it.')
    const close = vi.spyOn(pool, 'close')
    page.wake!()
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(['wss://bunker.invalid']))
    expect(fake.connects).toBe(1)
  })
})
