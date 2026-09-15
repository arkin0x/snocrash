/**
 * signers.ts - who holds the key, and how that survives a reload.
 *
 * Four ways in, which are the four ways nostr has: a key this app makes and
 * keeps in the browser, an nsec pasted in, an encrypted ncryptsec unlocked
 * with its password, or a signer that is not this app at all, a browser
 * extension (NIP-07) or a remote bunker (NIP-46). They differ only in how
 * signEvent works and whether the pubkey is known at once, so the rest of the
 * app talks to one shape and awaits every signature.
 *
 * The part that matters on a reload is the preference. It used to be the word
 * "local", "nip07" or "nip46", which is enough to remember a key that is in
 * this browser and nothing at all for one that is not: a bunker connected and
 * then forgotten on the next load, because nothing had been kept that could
 * bring it back. A preference now carries the pubkey, and for a bunker its URI
 * and the client key the connection was made with, so the same connection is
 * re-made rather than a new one negotiated.
 *
 * The pubkey being in there is what makes the reload quiet. An identity whose
 * pubkey is known can be shown at once (`deferredReconnect`) while the
 * handshake waits for the first thing that actually needs a signature, so
 * opening the app never costs a round trip to somebody's phone.
 *
 * The distinction that matters elsewhere is whether the key is here. Only a
 * local signer has a `secretKey`, and only a local signer can be exported
 * (lib/keyExport): an extension and a bunker hold their own key and it is
 * theirs to give, not this app's.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19, type EventTemplate, type Event as NostrEvent } from 'nostr-tools'
import * as nip46 from 'nostr-tools/nip46'
import * as nip49 from 'nostr-tools/nip49'
import { pool } from './pool'

export type SignerKind = 'local' | 'nip07' | 'nip46'
export { SIGN_PATIENCE_MS, SignerTimeout, signWithin } from './signWithin'

export interface Signer {
  kind: SignerKind
  pubkey: string
  /** Present only for a local key: what an export encrypts, and what is persisted. */
  secretKey?: Uint8Array
  /** For a bunker: what to persist so the same connection can be re-made. */
  bunkerUri?: string
  clientSecretKey?: Uint8Array
  signEvent: (template: EventTemplate) => Promise<NostrEvent>
  close?: () => Promise<void>
  /** Drop the sockets and come back with a working signer. */
  reconnect?: () => Promise<Signer>
}

interface Nip07 {
  getPublicKey: () => Promise<string>
  signEvent: (e: EventTemplate) => Promise<NostrEvent>
}
function windowNostr(): Nip07 | null {
  return (window as unknown as { nostr?: Nip07 }).nostr ?? null
}

/** Whether a browser extension is offering to sign. */
export function hasNip07(): boolean {
  return typeof window !== 'undefined' && !!windowNostr()
}

export function localSigner(secretKey: Uint8Array): Signer {
  return {
    kind: 'local',
    pubkey: getPublicKey(secretKey),
    secretKey,
    signEvent: (template) => Promise.resolve(finalizeEvent(template, secretKey) as NostrEvent),
  }
}

/** A fresh random key, which is how someone with no nostr identity starts. */
export function randomSigner(): Signer {
  return localSigner(generateSecretKey())
}

/** An nsec pasted in. Throws something a person can read if it is not one. */
export function signerFromNsec(nsec: string): Signer {
  let decoded
  try { decoded = nip19.decode(nsec.trim()) } catch { throw new Error('That is not a valid nsec. Check you copied the whole key.') }
  if (decoded.type !== 'nsec') throw new Error(`That is a ${decoded.type}, not an nsec.`)
  return localSigner(decoded.data as Uint8Array)
}

/** An encrypted key and its password (NIP-49). */
export function signerFromNcryptsec(ncryptsec: string, password: string): Signer {
  let sk
  try { sk = nip49.decrypt(ncryptsec.trim(), password) } catch {
    throw new Error('Could not decrypt. Wrong password, or not a valid ncryptsec.')
  }
  return localSigner(sk)
}

/** The browser extension, which keeps its own key and prompts for each signature. */
export async function nip07Signer(): Promise<Signer> {
  const ext = windowNostr()
  if (!ext) throw new Error('No nostr extension found in this browser.')
  const pubkey = await ext.getPublicKey()
  return { kind: 'nip07', pubkey, signEvent: (t) => ext.signEvent(t) }
}

/**
 * A remote bunker (NIP-46): the key is on another machine entirely.
 *
 * The client key is handed in on a reconnect so the bunker sees the same
 * client it already approved, rather than a stranger asking for permission
 * again. It signs nothing of yours; it is only how this app is recognised
 * across the relay.
 */
export async function nip46Signer(bunkerUri: string, clientSecretKey?: Uint8Array): Promise<Signer> {
  const clientSk = clientSecretKey ?? generateSecretKey()
  const bp = await nip46.parseBunkerInput(bunkerUri.trim())
  if (!bp) throw new Error('That is not a bunker:// URI or a NIP-05 that points at one.')
  const bunker = nip46.BunkerSigner.fromBunker(clientSk, bp, { pool: pool as never })
  await bunker.connect()
  const pubkey = await bunker.getPublicKey()
  const signer: Signer = {
    kind: 'nip46',
    pubkey,
    bunkerUri,
    clientSecretKey: clientSk,
    signEvent: (t) => bunker.signEvent(t) as Promise<NostrEvent>,
    close: () => bunker.close(),
    // A phone that suspends the tab leaves its relay sockets half-open: the
    // browser still calls them connected, so the pool reuses them and a
    // request goes into the void, to be answered never. Closing the bunker's
    // relays in the pool drops those sockets; the same signer opens fresh ones
    // on its next request, so nothing is rebuilt and the bunker sees no new
    // connect handshake.
    reconnect: async () => {
      pool.close([...bp.relays])
      return signer
    },
  }
  return signer
}

/** What is kept so a signer can come back on reload. */
export interface SignerPref {
  kind: SignerKind
  pubkey: string
  /** local only. */
  nsec?: string
  /** nip46 only. */
  bunkerUri?: string
  clientNsec?: string
}

export function prefOf(signer: Signer): SignerPref {
  const base: SignerPref = { kind: signer.kind, pubkey: signer.pubkey }
  if (signer.kind === 'local' && signer.secretKey) base.nsec = nip19.nsecEncode(signer.secretKey)
  if (signer.kind === 'nip46') {
    base.bunkerUri = signer.bunkerUri
    if (signer.clientSecretKey) base.clientNsec = nip19.nsecEncode(signer.clientSecretKey)
  }
  return base
}

/** Rebuild a signer from a kept preference. Local is instant; the others reconnect. */
export async function signerFromPref(pref: SignerPref): Promise<Signer> {
  if (pref.kind === 'local' && pref.nsec) return signerFromNsec(pref.nsec)
  if (pref.kind === 'nip07') return nip07Signer()
  if (pref.kind === 'nip46' && pref.bunkerUri) {
    const clientSk = pref.clientNsec ? (nip19.decode(pref.clientNsec).data as Uint8Array) : undefined
    return nip46Signer(pref.bunkerUri, clientSk)
  }
  throw new Error('That stored identity cannot be rebuilt.')
}

const PREF_KEY = 'snocrash:signer'
/** The first shape this app stored: a bare hex key, with the kind beside it. */
const OLD_SK_KEY = 'snocrash:sk'

/**
 * The key kept by the first version of this file, moved into a preference.
 *
 * Without this, a browser holding a key from before would parse the old value,
 * fail, be told nobody had ever been here, and be handed a brand new key,
 * taking everything published under the old one out of reach.
 */
function migrateOldLocalKey(): SignerPref | null {
  try {
    const hex = localStorage.getItem(OLD_SK_KEY)
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null
    const sk = Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))
    const pref: SignerPref = { kind: 'local', pubkey: getPublicKey(sk), nsec: nip19.nsecEncode(sk) }
    saveSignerPref(pref)
    localStorage.removeItem(OLD_SK_KEY)
    return pref
  } catch { return null }
}

export function loadSignerPref(): SignerPref | null {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (raw) {
      // The old value here was the bare word "local" and is not JSON, so this
      // throws and falls through to the migration below, which is the point.
      const parsed = JSON.parse(raw) as unknown
      const pref = parsed as SignerPref
      if (parsed && typeof parsed === 'object' && typeof pref.pubkey === 'string' && /^[0-9a-f]{64}$/.test(pref.pubkey)) return pref
    }
  } catch { /* the first format; the migration handles it */ }
  return migrateOldLocalKey()
}

export function saveSignerPref(pref: SignerPref): void {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)) } catch { /* private mode: this session only */ }
}

export function forgetSignerPref(): void {
  try { localStorage.removeItem(PREF_KEY); localStorage.removeItem(OLD_SK_KEY) } catch { /* ignore */ }
}

/**
 * An identity whose pubkey is already known but whose signer has not been
 * reconnected yet.
 *
 * The pubkey is available at once, so the app can say who you are the moment
 * it opens. The first signature, or an explicit reconnect, does the real
 * handshake, once, and hands the live signer to `onReady` so the store can
 * swap it in. Without this, opening the app with a bunker identity would mean
 * waiting on somebody's phone before anything could be drawn.
 */
export function deferredReconnect(pref: SignerPref, onReady: (s: Signer) => void): Signer {
  let pending: Promise<Signer> | null = null
  const ensure = (): Promise<Signer> => {
    if (!pending) pending = signerFromPref(pref).then((s) => { onReady(s); return s })
    return pending
  }
  return {
    kind: pref.kind,
    pubkey: pref.pubkey,
    signEvent: (template) => ensure().then((s) => s.signEvent(template)),
    reconnect: ensure,
  }
}
