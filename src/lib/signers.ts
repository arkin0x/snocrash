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
import { attributed } from './client'

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
  /**
   * Only on a deferred identity (deferredReconnect): the live signer, once
   * its handshake is done, within HANDSHAKE_PATIENCE_MS. A signature's
   * patience starts after it, so a slow handshake is not taken for a dead
   * channel (review of parity #35). `signal` gives the wait, and the
   * handshake it started, up.
   */
  ready?: (signal?: AbortSignal) => Promise<Signer>
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
    signEvent: (template) => Promise.resolve(finalizeEvent(attributed(template), secretKey) as NostrEvent),
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
  return { kind: 'nip07', pubkey, signEvent: (t) => ext.signEvent(attributed(t)) }
}

/**
 * A remote bunker (NIP-46): the key is on another machine entirely.
 *
 * The client key is handed in on a reconnect so the bunker sees the same
 * client it already approved, rather than a stranger asking for permission
 * again. It signs nothing of yours; it is only how this app is recognised
 * across the relay.
 *
 * The handshake waits on somebody's phone and has no deadline of its own, so
 * `signal` gives it up: the bunker is closed and the promise rejects at once.
 * A handshake that fails closes it too, so a given-up or failed attempt
 * leaves no subscription waiting on the bunker's relay (review of parity #35).
 */
export async function nip46Signer(bunkerUri: string, clientSecretKey?: Uint8Array, signal?: AbortSignal): Promise<Signer> {
  const clientSk = clientSecretKey ?? generateSecretKey()
  const bp = await nip46.parseBunkerInput(bunkerUri.trim())
  if (!bp) throw new Error('That is not a bunker:// URI or a NIP-05 that points at one.')
  if (signal?.aborted) throw new Error(GIVEN_UP)
  const bunker = nip46.BunkerSigner.fromBunker(clientSk, bp, { pool: pool as never })
  let pubkey: string
  let stop: (() => void) | null = null
  try {
    const givenUp = new Promise<never>((_, reject) => {
      stop = () => reject(new Error(GIVEN_UP))
      signal?.addEventListener('abort', stop, { once: true })
    })
    pubkey = await Promise.race([bunker.connect().then(() => bunker.getPublicKey()), givenUp])
  } catch (err) {
    void bunker.close().catch(() => { /* already gone */ })
    throw err
  } finally {
    if (stop) signal?.removeEventListener('abort', stop)
  }
  const signer: Signer = {
    kind: 'nip46',
    pubkey,
    bunkerUri,
    clientSecretKey: clientSk,
    signEvent: (t) => bunker.signEvent(attributed(t)) as Promise<NostrEvent>,
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
export async function signerFromPref(pref: SignerPref, signal?: AbortSignal): Promise<Signer> {
  if (pref.kind === 'local' && pref.nsec) return signerFromNsec(pref.nsec)
  if (pref.kind === 'nip07') return nip07Signer()
  if (pref.kind === 'nip46' && pref.bunkerUri) {
    const clientSk = pref.clientNsec ? (nip19.decode(pref.clientNsec).data as Uint8Array) : undefined
    return nip46Signer(pref.bunkerUri, clientSk, signal)
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

/** Why a way in that was given up rejects. */
export const GIVEN_UP = 'Given up.'

/** Why a wait the person cancelled (the PUBLISHING chip) rejects. */
export const CANCELLED = 'Cancelled.'

/**
 * How long a saved bunker gets to answer its reconnect. Its handshake has no
 * deadline of its own (nostr-tools waits on the relay for good), and every
 * publish and relay sign-in waits on it, so a bunker that never answered left
 * PUBLISHING up for good (review of parity #35). A minute is long enough to
 * find the phone and approve it.
 */
export const HANDSHAKE_PATIENCE_MS = 60_000

/** What a reconnect that ran out of patience says: a bunker or an extension, so neither is named. */
export const HANDSHAKE_LATE = 'Your signer did not answer the reconnect within a minute. Approve the connection in your signer, then publish again.'

/** What a reconnect says when the signer came back as another key than the one saved here. */
export const OTHER_KEY = 'Your signer now signs as a different key from the one saved here. Choose your key again in the menu.'

/**
 * An identity whose pubkey is already known but whose signer has not been
 * reconnected yet.
 *
 * The pubkey is available at once, so the app can say who you are the moment
 * it opens. The first signature, or an explicit reconnect, does the real
 * handshake, once, and hands the live signer to `onReady` so the store can
 * swap it in. Without this, opening the app with a bunker identity would mean
 * waiting on somebody's phone before anything could be drawn.
 *
 * `close` lets it go, handshake and all: a handshake in flight is given up
 * (a bunker's is closed at once), a live signer already handed over is
 * closed, and one that arrives anyway is closed on arrival and never handed
 * to `onReady`, so an identity replaced in the meantime stays replaced. A
 * handshake that fails is not remembered: the next signature tries again,
 * as ONOSENDAI's does (review of parity #35).
 *
 * One connect at a time, shared by everyone waiting on it (a publish, a
 * relay sign-in), with one deadline: HANDSHAKE_PATIENCE_MS from when the
 * connect started. When it passes, every waiter is told so together
 * (HANDSHAKE_LATE), and the connect is given up (a bunker's subscription is
 * closed) and forgotten, so the next signature starts one fresh connect. A
 * waiter that cancels (`ready`'s signal) leaves alone; the connect is given up
 * only when nobody else is waiting on it (review of parity #35).
 *
 * A signer that comes back as another key than the one saved is let go with
 * OTHER_KEY, rather than signing as someone the app does not show.
 */
export function deferredReconnect(pref: SignerPref, onReady: (s: Signer) => void): Signer {
  /** A connect in flight: who is waiting on it, and how to give it up. */
  interface Attempt { abort: AbortController; done: Promise<Signer>; waiting: number; timer: ReturnType<typeof setTimeout> }
  let live: Signer | null = null
  let closed = false
  let attempt: Attempt | null = null
  /** Give one connect up and forget it, if it is still the one in flight. */
  const drop = (a: Attempt): void => {
    clearTimeout(a.timer)
    a.abort.abort()
    if (attempt === a) attempt = null
  }
  const connect = (): Attempt => {
    if (attempt) return attempt
    const abort = new AbortController()
    let late!: (err: Error) => void
    const deadline = new Promise<never>((_, reject) => { late = reject })
    const a: Attempt = { abort, waiting: 0, timer: setTimeout(() => { late(new Error(HANDSHAKE_LATE)); drop(a) }, HANDSHAKE_PATIENCE_MS), done: null as unknown as Promise<Signer> }
    const made = signerFromPref(pref, abort.signal).then((s) => {
      if (closed || abort.signal.aborted) { void s.close?.().catch(() => { /* already gone */ }); throw new Error(closed ? GIVEN_UP : HANDSHAKE_LATE) }
      if (s.pubkey !== pref.pubkey) { void s.close?.().catch(() => { /* already gone */ }); throw new Error(OTHER_KEY) }
      live = s
      onReady(s)
      return s
    })
    a.done = Promise.race([made, deadline]).then((s) => { clearTimeout(a.timer); return s }, (err: unknown) => {
      // A failed connect is not remembered: the next signature tries again.
      clearTimeout(a.timer)
      if (attempt === a) attempt = null
      throw closed ? new Error(GIVEN_UP) : err
    })
    // Nobody may be waiting when it fails (a cancelled wait): that is not an error to report.
    a.done.catch(() => { /* told to the waiters, if any */ })
    attempt = a
    return a
  }
  const ready = (signal?: AbortSignal): Promise<Signer> => {
    if (live) return Promise.resolve(live)
    if (closed) return Promise.reject(new Error(GIVEN_UP))
    if (signal?.aborted) return Promise.reject(new Error(CANCELLED))
    const a = connect()
    a.waiting++
    return new Promise<Signer>((resolve, reject) => {
      let left = false
      const leave = (): boolean => {
        if (left) return false
        left = true
        a.waiting--
        signal?.removeEventListener('abort', cancel)
        return true
      }
      // This waiter leaves; the connect goes on for anyone still waiting.
      const cancel = (): void => {
        if (!leave()) return
        if (a.waiting === 0 && !live) drop(a)
        reject(new Error(CANCELLED))
      }
      signal?.addEventListener('abort', cancel, { once: true })
      a.done.then((s) => { if (leave()) resolve(s) }, (err: unknown) => { if (leave()) reject(err) })
    })
  }
  return {
    kind: pref.kind,
    pubkey: pref.pubkey,
    signEvent: (template) => ready().then((s) => s.signEvent(template)),
    reconnect: () => ready(),
    ready,
    close: async () => {
      closed = true
      if (attempt) drop(attempt)
      await live?.close?.()
    },
  }
}
