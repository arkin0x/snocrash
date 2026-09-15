/**
 * What these prove: an identity survives a reload, whatever kind it is.
 *
 * The bug these were written for: the preference kept only the word "local",
 * "nip07" or "nip46". That is enough to bring back a key held in this browser
 * and nothing at all for one that is not, so a bunker connected and was then
 * forgotten on the next load: there was nothing kept that could reach it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import {
  forgetSignerPref, loadSignerPref, localSigner, prefOf, saveSignerPref,
  signerFromPref, deferredReconnect, type Signer, type SignerPref,
} from './signers'

function stubStorage(): void {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
  }
}

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const BUNKER = 'bunker://abc?relay=wss://relay.example.com'

describe('what is kept', () => {
  beforeEach(stubStorage)

  it('keeps a local key as an nsec, and brings back the same key', async () => {
    saveSignerPref(prefOf(localSigner(sk)))
    const back = await signerFromPref(loadSignerPref() as SignerPref)
    expect(back.kind).toBe('local')
    expect(back.pubkey).toBe(pk)
    expect(back.secretKey).toEqual(sk)
  })

  it('keeps a bunker by its URI and the client key it connected with', () => {
    // Both, because the URI alone would mean a new client asking the bunker
    // for permission again on every reload.
    const clientSk = generateSecretKey()
    const bunker: Signer = {
      kind: 'nip46', pubkey: pk, bunkerUri: BUNKER, clientSecretKey: clientSk,
      signEvent: () => { throw new Error('not called') },
    }
    saveSignerPref(prefOf(bunker))
    const pref = loadSignerPref() as SignerPref
    expect(pref.kind).toBe('nip46')
    expect(pref.pubkey).toBe(pk)
    expect(pref.bunkerUri).toBe(BUNKER)
    expect(nip19.decode(pref.clientNsec as string).data).toEqual(clientSk)
  })

  it('keeps an extension by its pubkey, which is all there is to keep', () => {
    const ext: Signer = { kind: 'nip07', pubkey: pk, signEvent: () => { throw new Error('not called') } }
    saveSignerPref(prefOf(ext))
    const pref = loadSignerPref() as SignerPref
    expect(pref).toEqual({ kind: 'nip07', pubkey: pk })
  })

  it('never writes a secret key for a signer that does not hold one', () => {
    const ext: Signer = { kind: 'nip07', pubkey: pk, signEvent: () => { throw new Error('not called') } }
    expect(JSON.stringify(prefOf(ext))).not.toContain('nsec')
  })

  it('forgets everything on sign out', () => {
    saveSignerPref(prefOf(localSigner(sk)))
    forgetSignerPref()
    expect(loadSignerPref()).toBeNull()
  })

  it('is nothing when nobody has been here', () => {
    expect(loadSignerPref()).toBeNull()
  })

  it('refuses a stored value that is not a preference', () => {
    localStorage.setItem('snocrash:signer', '{"kind":"local"}')
    expect(loadSignerPref()).toBeNull()
  })
})

describe('the key kept by the first version of this app', () => {
  beforeEach(stubStorage)

  it('becomes a preference rather than being lost', () => {
    // Without this a browser holding one would be told nobody had been here
    // and handed a new key, taking everything published under the old one out
    // of reach.
    const hex = [...sk].map((b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('snocrash:sk', hex)
    localStorage.setItem('snocrash:signer', 'local')
    const pref = loadSignerPref() as SignerPref
    expect(pref.kind).toBe('local')
    expect(pref.pubkey).toBe(pk)
    expect(nip19.decode(pref.nsec as string).data).toEqual(sk)
    // Moved, not copied: the old place is cleared and the new one stands.
    expect(localStorage.getItem('snocrash:sk')).toBeNull()
    expect(loadSignerPref()?.pubkey).toBe(pk)
  })

  it('ignores a stored key that is not one', () => {
    localStorage.setItem('snocrash:sk', 'not a key')
    localStorage.setItem('snocrash:signer', 'local')
    expect(loadSignerPref()).toBeNull()
  })
})

describe('deferredReconnect', () => {
  beforeEach(stubStorage)

  it('knows who you are before it has connected to anything', async () => {
    // This is what makes a reload quiet: the app can say who you are without
    // waiting on somebody's phone.
    const pref: SignerPref = { kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }
    let handed: Signer | null = null
    const lazy = deferredReconnect(pref, (s) => { handed = s })
    expect(lazy.pubkey).toBe(pk)
    expect(lazy.kind).toBe('local')
    expect(handed).toBeNull()
    await lazy.reconnect?.()
    expect((handed as Signer | null)?.pubkey).toBe(pk)
  })

  it('connects once, however many times it is asked', async () => {
    const pref: SignerPref = { kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }
    let made = 0
    const lazy = deferredReconnect(pref, () => { made++ })
    await Promise.all([lazy.reconnect?.(), lazy.reconnect?.(), lazy.reconnect?.()])
    expect(made).toBe(1)
  })
})
