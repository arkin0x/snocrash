/**
 * nip46Abort.test.ts - a bunker handshake that is given up, or fails, closes
 * the bunker (review of parity #35). BunkerSigner.connect has no deadline of
 * its own and waits on somebody's phone; without this, the ✕ on a WORKING
 * key left its subscription open on the bunker's relay for good. The bunker
 * is a stand-in whose connect answers only when the test says, so nothing
 * reaches a relay.
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

const fake = vi.hoisted(() => {
  const state = {
    close: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    answer: null as null | ((err?: Error) => void),
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
        connect: () => new Promise<void>((resolve, reject) => { fake.answer = (err) => (err ? reject(err) : resolve()) }),
        getPublicKey: async () => 'c'.repeat(64),
        close: fake.close,
      }),
    },
  }
})

import { GIVEN_UP, nip46Signer } from './signers'
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
