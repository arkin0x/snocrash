/**
 * nip46Abort.test.ts - a bunker handshake that is given up, or fails, closes
 * the bunker (review of parity #35). BunkerSigner.connect has no deadline of
 * its own and waits on somebody's phone; without this, the ✕ on a WORKING
 * key left its subscription open on the bunker's relay for good. The bunker
 * is a stand-in whose connect answers only when the test says, so nothing
 * reaches a relay.
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

const fake = vi.hoisted(() => {
  const state = {
    close: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    answer: null as null | ((err?: Error) => void),
    /** How many handshakes were started. */
    connects: 0,
    pubkey: 'c'.repeat(64),
    sign: null as null | ((t: unknown) => Promise<unknown>),
  }
  return state
})

vi.mock('nostr-tools/nip46', async (importOriginal) => {
  const real = await importOriginal<typeof import('nostr-tools/nip46')>()
  return {
    ...real,
    parseBunkerInput: async () => ({ pubkey: 'c'.repeat(64), relays: ['wss://bunker.invalid'], secret: null }),
    BunkerSigner: {
      fromBunker: () => ({
        connect: () => { fake.connects++; return new Promise<void>((resolve, reject) => { fake.answer = (err) => (err ? reject(err) : resolve()) }) },
        getPublicKey: async () => fake.pubkey,
        signEvent: (t: unknown) => fake.sign!(t),
        close: fake.close,
      }),
    },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type EventTemplate } from 'nostr-tools'
import { newShard } from 'sno-core/shards'
import { CANCELLED, GIVEN_UP, HANDSHAKE_LATE, HANDSHAKE_PATIENCE_MS, OTHER_KEY, deferredReconnect, nip46Signer, saveSignerPref, type Signer, type SignerPref } from './signers'
import { useRelays } from '../store/useRelays'
import { useNostr } from '../store/useNostr'

describe('a bunker handshake', () => {
  beforeEach(() => {
    fake.close = vi.fn(async () => {})
    fake.answer = null
  })

  it('given up, rejects at once and closes the bunker', async () => {
    const abort = new AbortController()
    const attempt = nip46Signer('bunker://x', undefined, abort.signal)
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    abort.abort()
    await expect(attempt).rejects.toThrow(GIVEN_UP)
    expect(fake.close).toHaveBeenCalled()
  })

  it('failing, closes the bunker and says why', async () => {
    const attempt = nip46Signer('bunker://x')
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    fake.answer!(new Error('the bunker said no'))
    await expect(attempt).rejects.toThrow('the bunker said no')
    expect(fake.close).toHaveBeenCalled()
  })

  it('answered, keeps the bunker open as the signer', async () => {
    const attempt = nip46Signer('bunker://x')
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    fake.answer!()
    expect((await attempt).pubkey).toBe('c'.repeat(64))
    expect(fake.close).not.toHaveBeenCalled()
  })

  it("the key modal's ✕ (cancelLogin) on a WORKING bunker closes it, and leaves no error", async () => {
    const working = useNostr.getState().useBunker('bunker://x')
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    expect(useNostr.getState().loggingIn).toBe(true)
    useNostr.getState().cancelLogin()
    await working
    expect(fake.close).toHaveBeenCalled()
    expect(useNostr.getState().loggingIn).toBe(false)
    expect(useNostr.getState().loginError).toBeNull()
  })
})

describe('a saved bunker identity, reconnected later (the real deferredReconnect)', () => {
  const pref: SignerPref = { kind: 'nip46', pubkey: 'c'.repeat(64), bunkerUri: 'bunker://x', clientNsec: nip19.nsecEncode(generateSecretKey()) }

  beforeEach(() => {
    fake.close = vi.fn(async () => {})
    fake.answer = null
  })

  it('let go after the handover, closes the live bunker it handed over', async () => {
    let handed: Signer | null = null
    const lazy = deferredReconnect(pref, (s) => { handed = s })
    const ready = lazy.ready!()
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    fake.answer!()
    await ready
    expect(handed).not.toBeNull()
    expect(fake.close).not.toHaveBeenCalled()
    await lazy.close!()
    expect(fake.close).toHaveBeenCalled()
  })

  it('let go mid-handshake, gives the handshake up: the bunker is closed at once and nothing is handed over', async () => {
    let handed: Signer | null = null
    const lazy = deferredReconnect(pref, (s) => { handed = s })
    const ready = lazy.ready!()
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    await lazy.close!()
    await expect(ready).rejects.toThrow(GIVEN_UP)
    expect(fake.close).toHaveBeenCalled()
    expect(handed).toBeNull()
  })

  it('a handshake that failed is not remembered: the next signature tries again', async () => {
    const lazy = deferredReconnect(pref, () => {})
    const first = lazy.ready!()
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    fake.answer!(new Error('the phone was off'))
    await expect(first).rejects.toThrow('the phone was off')
    fake.answer = null
    const second = lazy.ready!()
    await vi.waitFor(() => expect(fake.answer).not.toBeNull())
    fake.answer!()
    expect((await second).pubkey).toBe('c'.repeat(64))
  })
})

describe('publishing while a saved bunker reconnects (review of parity #35)', () => {
  const sk = generateSecretKey()
  const shard = { ...newShard('probe'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
  const n = () => useNostr.getState()
  /** Let the microtasks and any timers due run. */
  const tick = (ms = 10): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined)

  beforeEach(async () => {
    fake.close = vi.fn(async () => {})
    fake.answer = null
    fake.pubkey = getPublicKey(sk)
    fake.sign = async (t) => finalizeEvent(t as EventTemplate, sk)
    useRelays.setState({ relays: [] } as never)
    saveSignerPref({ kind: 'nip46', pubkey: fake.pubkey, bunkerUri: 'bunker://x', clientNsec: nip19.nsecEncode(generateSecretKey()) })
    await n().init()
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers(); fake.pubkey = 'c'.repeat(64) })

  it('a bunker that never answers gives the publish up after a minute, closes its connect, and the next publish starts exactly one new one', async () => {
    const before = fake.connects
    const first = n().publish(shard)
    await tick()
    expect(fake.connects).toBe(before + 1)
    expect(n().publishing).toBe(true)
    await tick(HANDSHAKE_PATIENCE_MS)
    expect(await first).toBe(false)
    expect(n().notice).toBe(HANDSHAKE_LATE)
    expect(n().publishing).toBe(false)
    expect(fake.close).toHaveBeenCalled()
    // Again: one fresh connect, which this time is answered.
    const second = n().publish(shard)
    await tick()
    expect(fake.connects).toBe(before + 2)
    fake.answer!()
    await tick()
    await second
    expect(n().notice).toBe('No relay took it.')
    expect(fake.connects).toBe(before + 2)
  })

  it('a publish that began 30 s into the connect gets the reconnect message, not a key change', async () => {
    const before = fake.connects
    const first = n().publish(shard)
    await tick(30_000)
    const palette = n().publishPalette('two', [[255, 0, 0], [0, 255, 0]])
    await tick(HANDSHAKE_PATIENCE_MS - 30_000)
    expect(await first).toBe(false)
    expect(await palette).toBeNull()
    expect(n().notice).toBe(HANDSHAKE_LATE)
    expect(fake.connects).toBe(before + 1)
  })

  it('the PUBLISHING chip calls the publish off, and closes the connect it was waiting on', async () => {
    const before = fake.connects
    const publishing = n().publish(shard)
    await tick()
    n().cancelPublish()
    await tick(0)
    expect(await publishing).toBe(false)
    expect(n().notice).toBe('Publishing cancelled. Nothing went out.')
    expect(n().publishing).toBe(false)
    expect(fake.close).toHaveBeenCalled()
    void n().publish(shard)
    await tick()
    expect(fake.connects).toBe(before + 2)
    n().cancelPublish()
    await tick(0)
  })

  it('a new key chosen while it waits: the publish says the key changed', async () => {
    const publishing = n().publish(shard)
    await tick()
    n().useNewKey()
    await tick(0)
    expect(await publishing).toBe(false)
    expect(n().notice).toBe('Not published: the key changed while it was going out. Publish again to sign it with the current key.')
  })

  it('signed out while it waits: the publish says only that', async () => {
    const publishing = n().publish(shard)
    await tick()
    n().signOut()
    await tick(0)
    expect(await publishing).toBe(false)
    expect(n().notice).toBe('Signed out, so nothing was published.')
  })
})

describe('one connect, several waiting on it (review of parity #35)', () => {
  const pref = (): SignerPref => ({ kind: 'nip46', pubkey: fake.pubkey, bunkerUri: 'bunker://x', clientNsec: nip19.nsecEncode(generateSecretKey()) })
  const tick = (ms = 10): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined)

  beforeEach(() => {
    fake.close = vi.fn(async () => {})
    fake.answer = null
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers(); fake.pubkey = 'c'.repeat(64) })

  it('the minute is the connect\'s, not each waiter\'s: one that came later is told the same thing at the same time', async () => {
    const lazy = deferredReconnect(pref(), () => {})
    const before = fake.connects
    const signIn = lazy.ready!()
    await tick(30_000)
    const publish = lazy.ready!()
    const told: string[] = []
    signIn.catch((e: Error) => told.push(`sign-in: ${e.message}`))
    publish.catch((e: Error) => told.push(`publish: ${e.message}`))
    await tick(HANDSHAKE_PATIENCE_MS - 30_000)
    expect(told.sort()).toEqual([`publish: ${HANDSHAKE_LATE}`, `sign-in: ${HANDSHAKE_LATE}`])
    expect(fake.connects).toBe(before + 1)
    expect(fake.close).toHaveBeenCalled()
  })

  it('a waiter that cancels leaves; the connect goes on for the other, which gets the signer', async () => {
    const lazy = deferredReconnect(pref(), () => {})
    const one = new AbortController()
    const leaving = lazy.ready!(one.signal)
    const staying = lazy.ready!()
    await tick()
    one.abort()
    await expect(leaving).rejects.toThrow(CANCELLED)
    expect(fake.close).not.toHaveBeenCalled()
    fake.answer!()
    await tick()
    expect((await staying).pubkey).toBe(fake.pubkey)
  })

  it('the last waiter to cancel gives the connect up', async () => {
    const lazy = deferredReconnect(pref(), () => {})
    const one = new AbortController()
    const two = new AbortController()
    const a = lazy.ready!(one.signal)
    const b = lazy.ready!(two.signal)
    await tick()
    one.abort()
    await expect(a).rejects.toThrow(CANCELLED)
    expect(fake.close).not.toHaveBeenCalled()
    two.abort()
    await expect(b).rejects.toThrow(CANCELLED)
    await tick(0)
    expect(fake.close).toHaveBeenCalled()
  })

  it('a signer that comes back as another key is let go, says so, and asks nothing more from then on', async () => {
    const lazy = deferredReconnect({ ...pref(), pubkey: 'd'.repeat(64) }, () => {})
    const waiting = lazy.ready!()
    await tick()
    fake.answer!()
    await expect(waiting).rejects.toThrow(OTHER_KEY)
    expect(fake.close).toHaveBeenCalled()
    // Every later signature is told at once, without another approval request.
    const before = fake.connects
    await expect(lazy.ready!()).rejects.toThrow(OTHER_KEY)
    await expect(lazy.signEvent({ kind: 1, created_at: 1, tags: [], content: '' })).rejects.toThrow(OTHER_KEY)
    expect(fake.connects).toBe(before)
  })

  it('an extension that answers after its last waiter cancelled is let go: nothing handed over, and the next wait connects afresh', async () => {
    // An extension cannot be aborted: its answer arrives anyway.
    let answer!: (pk: string) => void
    let asked = 0
    const extension = { getPublicKey: () => { asked++; return new Promise<string>((resolve) => { answer = resolve }) }, signEvent: async () => { throw new Error('unused') } }
    ;(globalThis as { window?: unknown }).window = { nostr: extension }
    try {
      let handed = 0
      const lazy = deferredReconnect({ kind: 'nip07', pubkey: fake.pubkey }, () => { handed++ })
      const leaving = new AbortController()
      const wait = lazy.ready!(leaving.signal)
      await tick()
      leaving.abort()
      await expect(wait).rejects.toThrow(CANCELLED)
      answer(fake.pubkey)
      await tick()
      expect(handed).toBe(0)
      // The next wait starts its own connect, and that one is handed over.
      const next = lazy.ready!()
      await tick()
      expect(asked).toBe(2)
      answer(fake.pubkey)
      await tick()
      expect((await next).pubkey).toBe(fake.pubkey)
      expect(handed).toBe(1)
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  })
})
