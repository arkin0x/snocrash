/**
 * signersReconnect.test.ts - an extension login survives a reload
 * (ONOSENDAI #321, signersReconnect.test.ts there). Extensions inject
 * `window.nostr` some time after the page starts, so a saved extension
 * identity waits for it (NIP07_WAIT_MS), a reconnect that failed is tried
 * again on the next signature, and an extension now on another account is
 * refused. The extension is a stand-in in `window`; nothing reaches a relay.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools'
import { OTHER_KEY, deferredReconnect, signerFromPref } from './signers'

const sk = generateSecretKey()
const pubkey = getPublicKey(sk)
const template: EventTemplate = { kind: 22242, created_at: 1, tags: [['relay', 'wss://r.example'], ['challenge', 'c']], content: '' }
const extension = (key: Uint8Array) => ({
  getPublicKey: async () => getPublicKey(key),
  signEvent: async (t: EventTemplate) => finalizeEvent(t, key),
})
const win = globalThis as { window?: { nostr?: unknown } }

describe('deferredReconnect with an extension', () => {
  afterEach(() => { delete win.window })

  it('waits for an extension injected after the page started, and signs', async () => {
    win.window = {}
    setTimeout(() => { win.window!.nostr = extension(sk) }, 300)
    const signer = deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    const signed = await signer.signEvent(template)
    expect(signed.pubkey).toBe(pubkey)
  })

  it('does not keep a failed reconnect: the next signature tries again', async () => {
    win.window = { nostr: { getPublicKey: async () => { throw new Error('locked') }, signEvent: async () => { throw new Error('locked') } } }
    const signer = deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    await expect(signer.signEvent(template)).rejects.toThrow('locked')
    win.window = { nostr: extension(sk) }
    const signed = await signer.signEvent(template)
    expect(signed.pubkey).toBe(pubkey)
  })

  it('refuses an extension now on another account, and asks it nothing more', async () => {
    let asked = 0
    const other = extension(generateSecretKey())
    win.window = { nostr: { ...other, getPublicKey: () => { asked++; return other.getPublicKey() } } }
    const signer = deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    await expect(signer.signEvent(template)).rejects.toThrow(OTHER_KEY)
    await expect(signer.signEvent(template)).rejects.toThrow(OTHER_KEY)
    expect(asked).toBe(1)
  })

  it('signerFromPref refuses it too, for any caller', async () => {
    win.window = { nostr: extension(generateSecretKey()) }
    await expect(signerFromPref({ kind: 'nip07', pubkey })).rejects.toThrow(OTHER_KEY)
  })

  it('a wait given up stops waiting at once', async () => {
    win.window = {}
    const abort = new AbortController()
    const started = Date.now()
    const waiting = signerFromPref({ kind: 'nip07', pubkey }, abort.signal)
    setTimeout(() => abort.abort(), 150)
    await expect(waiting).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
