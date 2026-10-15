/**
 * deferredSwap.test.ts - a saved bunker identity reconnects on the first
 * signature, and the live signer its handshake brings back replaces the
 * deferred one only while that is still who signs (review of parity #35).
 * An identity chosen while the handshake was in flight stays chosen; the
 * late live signer is closed. deferredReconnect is mocked so the handshake
 * resolves exactly when the test says; nothing reaches a relay (the relay
 * list is empty, so publish signs and sends nowhere).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const bunker = vi.hoisted(() => ({
  pubkey: 'c'.repeat(64),
  onReady: null as ((s: unknown) => void) | null,
  /** When set, the deferred signer's handshake: what ready(), signEvent and reconnect wait on, as the real one's do. */
  handshake: null as Promise<{ signEvent: (t: unknown) => Promise<unknown> }> | null,
}))

vi.mock('../lib/signers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/signers')>()
  return {
    ...real,
    loadSignerPref: () => ({ kind: 'nip46', pubkey: bunker.pubkey, bunkerUri: 'bunker://x', clientNsec: 'nsec1x' }),
    // The handshake starts with the first signature and finishes when the test calls onReady.
    deferredReconnect: (pref: { kind: 'nip46'; pubkey: string }, onReady: (s: unknown) => void) => {
      bunker.onReady = onReady
      const h = bunker.handshake
      if (h) {
        return {
          kind: pref.kind, pubkey: pref.pubkey, close: vi.fn(async () => {}),
          ready: () => h, reconnect: () => h,
          signEvent: (t: unknown) => h.then((live) => live.signEvent(t)),
        }
      }
      return { kind: pref.kind, pubkey: pref.pubkey, signEvent: () => new Promise(() => { /* waits on the phone */ }), close: vi.fn(async () => {}) }
    },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { newShard } from 'sno-core/shards'
import { useNostr } from './useNostr'
import { useRelays } from './useRelays'

/** The bunker's own key: what the saved identity names, and what its live signer signs with. */
const BUNKER_SK = generateSecretKey()
bunker.pubkey = getPublicKey(BUNKER_SK)

/** A live bunker signer, as a finished handshake hands over. */
function liveBunker(): { kind: 'nip46'; pubkey: string; signEvent: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const sk = BUNKER_SK
  return { kind: 'nip46', pubkey: bunker.pubkey, signEvent: vi.fn(async (t) => finalizeEvent(t, sk)), close: vi.fn(async () => {}) }
}

const shard = { ...newShard('probe'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }

describe('a saved bunker identity, reconnecting late', () => {
  beforeEach(async () => {
    bunker.handshake = null
    useRelays.setState({ relays: [] } as never)
    await useNostr.getState().init()
    expect(useNostr.getState().pubkey).toBe(bunker.pubkey)
  })

  it('a new key chosen before the handshake answers stays the signer; the late live bunker is closed', async () => {
    useNostr.getState().useNewKey()
    const mine = useNostr.getState().pubkey
    expect(mine).not.toBe(bunker.pubkey)
    const late = liveBunker()
    bunker.onReady!(late)
    expect(late.close).toHaveBeenCalled()
    // Who signs now: the new key, not the bunker that answered late. (With
    // no relays the publish goes nowhere; the signature is what is asked.)
    await useNostr.getState().publish(shard)
    expect(late.signEvent).not.toHaveBeenCalled()
    expect(useNostr.getState().notice).toBe('No relay took it.')
    expect(useNostr.getState().pubkey).toBe(mine)
  })

  it('with nothing chosen in between, the live bunker takes over from the deferred one', async () => {
    const live = liveBunker()
    bunker.onReady!(live)
    expect(live.close).not.toHaveBeenCalled()
    await useNostr.getState().publish(shard)
    expect(live.signEvent).toHaveBeenCalled()
  })
})

describe("a signature's patience (review of parity #35)", () => {
  afterEach(() => { vi.useRealTimers(); bunker.handshake = null })

  it('starts after a slow handshake, so the phone is asked to sign once', async () => {
    let answer!: (live: ReturnType<typeof liveBunker>) => void
    bunker.handshake = new Promise((resolve) => { answer = resolve })
    useRelays.setState({ relays: [] } as never)
    await useNostr.getState().init()
    vi.useFakeTimers()
    const publishing = useNostr.getState().publish(shard)
    // Somebody takes 20 s to approve the connection: longer than the 15 s patience.
    await vi.advanceTimersByTimeAsync(20_000)
    const live = liveBunker()
    answer(live)
    bunker.onReady!(live)
    await vi.advanceTimersByTimeAsync(0)
    await publishing
    expect(live.signEvent).toHaveBeenCalledTimes(1)
    expect(useNostr.getState().notice).toBe('No relay took it.')
  })
})

describe('a signature that lands after the key changed (review of parity #35)', () => {
  afterEach(() => { bunker.handshake = null })

  it('is not sent: the publish says the key changed', async () => {
    // Connected, and asked to sign; the person switches keys before approving.
    let approve!: () => void
    const live = liveBunker()
    live.signEvent.mockImplementation((t) => new Promise((resolve) => { approve = () => resolve(finalizeEvent(t, BUNKER_SK)) }))
    bunker.handshake = Promise.resolve(live)
    useRelays.setState({ relays: [] } as never)
    await useNostr.getState().init()
    const publishing = useNostr.getState().publish(shard)
    await vi.waitFor(() => expect(live.signEvent).toHaveBeenCalled())
    useNostr.getState().useNewKey()
    approve()
    expect(await publishing).toBe(false)
    expect(useNostr.getState().notice).toBe('Not published: the key changed while it was being signed. Publish again to sign it with the current key.')
  })

  it('a signature that fails after the key changed says the key changed, not the failure', async () => {
    let refuse!: () => void
    const live = liveBunker()
    live.signEvent.mockImplementation(() => new Promise((_, reject) => { refuse = () => reject(new Error('the bunker went away')) }))
    bunker.handshake = Promise.resolve(live)
    useRelays.setState({ relays: [] } as never)
    await useNostr.getState().init()
    const publishing = useNostr.getState().publish(shard)
    await vi.waitFor(() => expect(live.signEvent).toHaveBeenCalled())
    useNostr.getState().useNewKey()
    refuse()
    expect(await publishing).toBe(false)
    expect(useNostr.getState().notice).toBe('Not published: the key changed while it was being signed. Publish again to sign it with the current key.')
  })
})
