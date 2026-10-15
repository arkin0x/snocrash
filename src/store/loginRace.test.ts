/**
 * loginRace.test.ts - a login that finishes late never undoes a newer
 * choice, and one the user is making is not dropped because the signer
 * changed in the background for the same identity. ONOSENDAI's
 * lateLoginSwap, lateSignerSwap and loginDuringReconnect (review of
 * ONOSENDAI #353), on snocrash's attempt counter. The saved identity is an
 * extension that appears in `window` when the test says; the QR sessions
 * are stand-ins that answer when the test says. Nothing reaches a relay.
 */

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type EventTemplate } from 'nostr-tools'
import * as nip49 from 'nostr-tools/nip49'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// A saved extension identity A. No extension is on the page yet.
const skA = generateSecretKey()
const pkA = getPublicKey(skA)
const saveA = (): void => localStorage.setItem('snocrash:signer', JSON.stringify({ kind: 'nip07', pubkey: pkA }))
const win = globalThis as { window?: { nostr?: unknown } }
win.window = {}

const { currentSigner, useNostr } = await import('./useNostr')
const { signerFromNsec } = await import('../lib/signers')
const n = () => useNostr.getState()
const template = (at: number): EventTemplate => ({ kind: 1, created_at: at, tags: [], content: 'x' })
const extensionA = { getPublicKey: async () => pkA, signEvent: async (t: EventTemplate) => finalizeEvent(t, skA) }
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))
const pref = (): { pubkey?: string; kind?: string } => JSON.parse(localStorage.getItem('snocrash:signer') ?? '{}')

/** A QR session whose signer answers with `signer` when the test calls answer(). */
function heldSession(make: () => ReturnType<typeof signerFromNsec>): { session: never; answer: () => void; signal: () => AbortSignal | undefined } {
  let answer: () => void = () => {}
  let given: AbortSignal | undefined
  const session = {
    uri: 'nostrconnect://x', relay: 'wss://relay.example.com',
    connect: (signal?: AbortSignal) => { given = signal; return new Promise((r) => { answer = () => r(make()) }) },
  }
  return { session: session as never, answer: () => answer(), signal: () => given }
}

describe('a late login never undoes a newer one', () => {
  it('a switch made while the saved identity reconnects wins', async () => {
    saveA()
    win.window = {}
    await n().init()
    expect(n().pubkey).toBe(pkA)
    // A signature as A starts the reconnect, which waits for the extension.
    const pending = currentSigner()!.signEvent(template(1)).catch(() => null)
    const skB = generateSecretKey()
    await n().useNsec(nip19.nsecEncode(skB))
    // Now A's extension appears and the reconnect answers, late.
    win.window!.nostr = extensionA
    await pending
    await settle()
    expect(n().pubkey).toBe(getPublicKey(skB))
    expect((await currentSigner()!.signEvent(template(2))).pubkey).toBe(getPublicKey(skB))
    expect(pref().pubkey).toBe(getPublicKey(skB))
  }, 15_000)

  it('a login given up for another does not switch when it finally answers', async () => {
    // An extension whose account prompt the user leaves open.
    let answer: (pk: string) => void = () => {}
    win.window = { nostr: { ...extensionA, getPublicKey: () => new Promise<string>((r) => { answer = r }) } }
    const extension = n().useExtension()
    const skC = generateSecretKey()
    await n().useNsec(nip19.nsecEncode(skC))
    answer(pkA)
    await extension
    await settle()
    expect(n().pubkey).toBe(getPublicKey(skC))
    expect(n().loginError).toBeNull()
  }, 15_000)

  it('a QR signer that answers after the QR screen was left is closed, not switched to', async () => {
    const before = n().pubkey
    const skD = generateSecretKey()
    const close = vi.fn(async () => {})
    const qr = heldSession(() => ({ ...signerFromNsec(nip19.nsecEncode(skD)), close }))
    const working = n().useNostrConnect(qr.session)
    await settle()
    n().cancelLogin()
    expect(qr.signal()?.aborted).toBe(true)
    qr.answer()
    await working
    expect(n().pubkey).toBe(before)
    expect(n().loginError).toBeNull()
    expect(close).toHaveBeenCalled()
  })
})

describe('a login made while the saved identity reconnects', () => {
  it('switches to the new identity even though the old one went live first', async () => {
    saveA()
    win.window = {}
    await n().init()
    expect(n().pubkey).toBe(pkA)
    // The user starts a QR login as B; the session answers when we say.
    const skB = generateSecretKey()
    const qr = heldSession(() => signerFromNsec(nip19.nsecEncode(skB)))
    const working = n().useNostrConnect(qr.session)
    // A's extension appears: the stand-in goes live, same identity A.
    win.window!.nostr = extensionA
    await currentSigner()!.ready!()
    await settle()
    expect(n().pubkey).toBe(pkA)
    // Then B answers.
    qr.answer()
    await working
    await settle()
    expect(n().pubkey).toBe(getPublicKey(skB))
    expect(n().loginError).toBeNull()
  }, 15_000)
})

describe('the one login field', () => {
  it('takes an nsec', async () => {
    const sk = generateSecretKey()
    await n().useLogin(`  ${nip19.nsecEncode(sk)} `)
    expect(n().pubkey).toBe(getPublicKey(sk))
    expect(n().loginError).toBeNull()
  })

  it('takes an ncryptsec with its password, and asks for the password without one', async () => {
    const sk = generateSecretKey()
    const ncryptsec = nip49.encrypt(sk, 'correct horse', 4)
    const before = n().pubkey
    await n().useLogin(ncryptsec)
    expect(n().loginError).toMatch(/password/)
    expect(n().pubkey).toBe(before)
    await n().useLogin(ncryptsec, 'wrong')
    expect(n().loginError).toMatch(/Could not decrypt/)
    await n().useLogin(ncryptsec, 'correct horse')
    expect(n().pubkey).toBe(getPublicKey(sk))
    expect(n().loginError).toBeNull()
  })

  it('does not guess at anything else', async () => {
    const before = n().pubkey
    await n().useLogin(nip19.npubEncode(getPublicKey(generateSecretKey())))
    expect(n().loginError).toMatch(/Paste an nsec, ncryptsec, or bunker/)
    expect(n().pubkey).toBe(before)
  })
})
