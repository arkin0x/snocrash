/**
 * nostrConnect.test.ts - the QR login (ONOSENDAI #196), end to end without a
 * relay. BunkerSigner is a stand-in: fromURI answers when the test says (the
 * signer app scanning the QR), and fromBunker (a reload) records what it was
 * asked, so the tests can prove a restored session asks the signer nothing.
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

const fake = vi.hoisted(() => ({
  remote: 'e'.repeat(64),
  /** What the signer app says its key is, once asked; null leaves it silent. */
  pubkey: null as string | null,
  /** Answer the QR: the signer app scanned it. */
  scan: null as null | (() => void),
  /** The signal fromURI was given. */
  signal: null as AbortSignal | null,
  close: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  asked: 0,
  connects: 0,
  /** How the signer app signs; by default it is never asked. */
  sign: null as null | ((t: unknown) => Promise<unknown>),
  restoredWith: null as null | { clientSecretKey: Uint8Array; relays: string[] },
}))

vi.mock('nostr-tools/nip46', async (importOriginal) => {
  const real = await importOriginal<typeof import('nostr-tools/nip46')>()
  const bunker = (relays: string[]) => ({
    bp: { pubkey: fake.remote, relays, secret: 'one-time' },
    connect: async () => { fake.connects++ },
    getPublicKey: () => { fake.asked++; return fake.pubkey ? Promise.resolve(fake.pubkey) : new Promise<string>(() => { /* silent */ }) },
    signEvent: (t: unknown) => (fake.sign ? fake.sign(t) : Promise.reject(new Error('unused'))),
    close: fake.close,
  })
  return {
    ...real,
    BunkerSigner: {
      fromURI: (_sk: Uint8Array, uri: string, _params: unknown, signal: AbortSignal) => {
        fake.signal = signal
        return new Promise((resolve, reject) => {
          fake.scan = () => resolve(bunker(new URL(uri).searchParams.getAll('relay')))
          signal?.addEventListener('abort', () => reject(new Error('subscription closed before connection was established.')))
        })
      },
      fromBunker: (clientSecretKey: Uint8Array, bp: { relays: string[] }) => {
        fake.restoredWith = { clientSecretKey, relays: bp.relays }
        return bunker(bp.relays)
      },
    },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event, type EventTemplate } from 'nostr-tools'
import { newShard } from 'sno-core/shards'
import { GIVEN_UP, OTHER_KEY, PUBLIC_KEY_WAIT_MS, createNostrConnectSession, loadSignerPref, prefOf, saveSignerPref, signerFromPref } from './signers'
import { pool } from './pool'
import { currentSigner, useNostr } from '../store/useNostr'
import { useRelays } from '../store/useRelays'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  fake.close = vi.fn(async () => {})
  fake.scan = null
  fake.signal = null
  fake.asked = 0
  fake.connects = 0
  fake.sign = null
  fake.restoredWith = null
  fake.pubkey = getPublicKey(generateSecretKey())
})

describe('a QR session', () => {
  it('answered, is a remote signer with the key the app named, kept without the one-time secret', async () => {
    const session = createNostrConnectSession()
    const connecting = session.connect(new AbortController().signal)
    await tick()
    fake.scan!()
    const signer = await connecting
    expect(signer.kind).toBe('nip46')
    expect(signer.pubkey).toBe(fake.pubkey)
    expect(signer.nostrConnectSession).toBe(true)
    const pref = prefOf(signer)
    expect(pref.nostrConnectSession).toBe(true)
    expect(pref.bunkerUri).toMatch(/^bunker:\/\//)
    expect(pref.bunkerUri).not.toContain('secret')
    expect(new URL(pref.bunkerUri!).searchParams.getAll('relay').length).toBe(2)
    expect(nip19.decode(pref.clientNsec!).type).toBe('nsec')
  })

  it('says when the signer has answered, before its key arrives', async () => {
    fake.pubkey = null
    let connected = false
    const abort = new AbortController()
    const connecting = createNostrConnectSession().connect(abort.signal, () => { connected = true })
    await tick()
    expect(connected).toBe(false)
    fake.scan!()
    await tick()
    expect(connected).toBe(true)
    abort.abort()
    await expect(connecting).rejects.toThrow(GIVEN_UP)
  })

  it('given up while the signer is answering, rejects and closes the bunker', async () => {
    fake.pubkey = null
    const abort = new AbortController()
    const connecting = createNostrConnectSession().connect(abort.signal)
    await tick()
    fake.scan!()
    await tick()
    abort.abort()
    await expect(connecting).rejects.toThrow(GIVEN_UP)
    expect(fake.close).toHaveBeenCalled()
  })

  describe('a signer that never says its key', () => {
    afterEach(() => { vi.useRealTimers() })
    it('is given up after PUBLIC_KEY_WAIT_MS, and closed', async () => {
      fake.pubkey = null
      const connecting = createNostrConnectSession().connect(new AbortController().signal)
      const verdict = connecting.catch((err: Error) => err)
      await tick()
      vi.useFakeTimers()
      fake.scan!()
      await vi.advanceTimersByTimeAsync(PUBLIC_KEY_WAIT_MS + 10)
      expect((await verdict as Error).message).toMatch(/did not return its public key/)
      expect(fake.close).toHaveBeenCalled()
    })
  })
})

describe('restoring a QR session', () => {
  it('uses the pubkey saved at login and asks the signer nothing', async () => {
    const saved = getPublicKey(generateSecretKey())
    const clientSk = generateSecretKey()
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: saved,
      bunkerUri: `bunker://${fake.remote}?relay=wss://relay.example.com`,
      clientNsec: nip19.nsecEncode(clientSk),
      nostrConnectSession: true,
    })
    expect(signer.pubkey).toBe(saved)
    expect(signer.nostrConnectSession).toBe(true)
    expect(fake.asked).toBe(0)
    expect(fake.connects).toBe(0)
    expect(fake.restoredWith?.clientSecretKey).toEqual(clientSk)
    expect(fake.restoredWith?.relays).toEqual(['wss://relay.example.com'])
  })
})

describe('the QR in the store', () => {
  const n = () => useNostr.getState()
  beforeEach(() => {
    n().useNewKey()
    useNostr.setState({ loginError: null, loggingIn: false })
  })

  it('answered, switches to the signer and keeps it as a QR session', async () => {
    const working = n().useNostrConnect(createNostrConnectSession())
    await tick()
    expect(n().loggingIn).toBe(true)
    fake.scan!()
    await working
    expect(n().pubkey).toBe(fake.pubkey)
    expect(n().signer).toBe('nip46')
    expect(n().loginError).toBeNull()
    expect(loadSignerPref()?.nostrConnectSession).toBe(true)
    expect(loadSignerPref()?.pubkey).toBe(fake.pubkey)
  })

  it('reloaded, comes back as the saved key without asking the signer', async () => {
    const saved = getPublicKey(generateSecretKey())
    saveSignerPref({
      kind: 'nip46', pubkey: saved, nostrConnectSession: true,
      bunkerUri: `bunker://${fake.remote}?relay=wss://relay.example.com`, clientNsec: nip19.nsecEncode(generateSecretKey()),
    })
    await n().init()
    expect(n().pubkey).toBe(saved)
    const live = await currentSigner()!.ready!()
    expect(live.pubkey).toBe(saved)
    expect(fake.asked).toBe(0)
    expect(fake.connects).toBe(0)
  })

  it('leaving the QR screen while the signer is answering switches nothing and leaves no error', async () => {
    fake.pubkey = null
    const before = n().pubkey
    const working = n().useNostrConnect(createNostrConnectSession())
    await tick()
    fake.scan!()
    await tick()
    n().cancelLogin()
    expect(fake.signal?.aborted).toBe(true)
    await working
    expect(n().pubkey).toBe(before)
    expect(n().loginError).toBeNull()
    expect(n().loggingIn).toBe(false)
    expect(fake.close).toHaveBeenCalled()
  })

  it('leaving before anyone scanned gives the wait on the relay up', async () => {
    const before = n().pubkey
    const working = n().useNostrConnect(createNostrConnectSession())
    await tick()
    n().cancelLogin()
    await working
    expect(fake.signal?.aborted).toBe(true)
    expect(n().pubkey).toBe(before)
    expect(n().loginError).toBeNull()
  })

  it('a signer that names something other than a key is refused', async () => {
    fake.pubkey = 'not-a-key'
    const before = n().pubkey
    const working = n().useNostrConnect(createNostrConnectSession())
    await tick()
    fake.scan!()
    await working
    expect(n().pubkey).toBe(before)
    expect(n().loginError).toMatch(/not a valid public key/)
    expect(fake.close).toHaveBeenCalled()
  })
})

describe('a restored QR session whose signer app has switched accounts (review of #37)', () => {
  const n = () => useNostr.getState()
  const saved = generateSecretKey()
  const shard = { ...newShard('probe'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
  /** The relay's NIP-42 challenge, answered the way the pool answers it. */
  const auth = (template: EventTemplate): Promise<Event> =>
    (pool as unknown as { automaticallyAuth: (url: string) => (t: EventTemplate) => Promise<Event> }).automaticallyAuth('wss://relay.example.com')(template)
  const challenge: EventTemplate = { kind: 22242, created_at: 1, tags: [['relay', 'wss://relay.example.com'], ['challenge', 'c']], content: '' }

  beforeEach(async () => {
    useRelays.setState({ relays: [] } as never)
    saveSignerPref({
      kind: 'nip46', pubkey: getPublicKey(saved), nostrConnectSession: true,
      bunkerUri: `bunker://${fake.remote}?relay=wss://relay.example.com`, clientNsec: nip19.nsecEncode(generateSecretKey()),
    })
    await n().init()
  })

  it('signing as the saved key, publishes and answers a relay as before', async () => {
    fake.sign = async (t) => finalizeEvent(t as EventTemplate, saved)
    expect(await n().publish(shard)).toBe(false)
    expect(n().notice).toBe('No relay took it.')
    expect((await auth(challenge)).pubkey).toBe(getPublicKey(saved))
  })

  it('signing as another key, publishes nothing and answers no relay as that key', async () => {
    const other = generateSecretKey()
    fake.sign = async (t) => finalizeEvent(t as EventTemplate, other)
    const sent = vi.spyOn(pool, 'publish')
    expect(await n().publish(shard)).toBe(false)
    expect(n().notice).toBe(OTHER_KEY)
    expect(sent).not.toHaveBeenCalled()
    await expect(auth(challenge)).rejects.toThrow(OTHER_KEY)
    expect(n().pubkey).toBe(getPublicKey(saved))
    sent.mockRestore()
  })
})
