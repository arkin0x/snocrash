/**
 * signers.ts - who holds the key, and how that survives a reload.
 *
 * Four ways in, which are the four ways nostr has: a key this app makes and
 * keeps in the browser, an nsec pasted in, an encrypted ncryptsec unlocked
 * with its password, or a signer that is not this app at all, a browser
 * extension (NIP-07) or a remote bunker (NIP-46), reached by its bunker:// URI
 * or by a Nostr Connect QR this app shows. They differ only in how
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
import { DEFAULT_SIGNER_RELAY, normalizeSignerRelay, signerRelays } from './loginCredentials'
export { BACKUP_SIGNER_RELAY, DEFAULT_SIGNER_RELAY, loginCredentialKind, normalizeSignerRelay, signerRelays } from './loginCredentials'

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
  /** A client-initiated Nostr Connect session (the QR) does not repeat the bunker connect handshake. */
  nostrConnectSession?: boolean
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

/**
 * How long a reconnect waits for an extension to appear. Extensions inject
 * `window.nostr` from a content script some time after the page starts, and
 * a reload can ask for a signature at once (a relay's NIP-42 challenge
 * arrives with the first socket), so asking only once found no extension and
 * the whole visit signed nothing. ONOSENDAI's (#321).
 */
export const NIP07_WAIT_MS = 4000

/** `window.nostr`, once it appears, or null after `waitMs` or once `signal` gives the wait up. */
async function waitForWindowNostr(waitMs: number, signal?: AbortSignal): Promise<Nip07 | null> {
  const start = Date.now()
  for (;;) {
    const ext = windowNostr()
    if (ext || signal?.aborted || Date.now() - start >= waitMs) return ext
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * The browser extension, which keeps its own key and prompts for each
 * signature. A reload waits up to `waitMs` for it to be injected; a choice
 * made in the modal does not, since the button is only offered once it is.
 */
export async function nip07Signer(waitMs = 0, signal?: AbortSignal): Promise<Signer> {
  const ext = await waitForWindowNostr(waitMs, signal)
  if (signal?.aborted) throw new Error(GIVEN_UP)
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

/*
 * Nostr Connect: the QR. ONOSENDAI's (hzrd149, ONOSENDAI #196).
 *
 * The other way round from a bunker:// URI. This app makes a one-time client
 * key and a nostrconnect:// URI naming it, shows that as a QR, and waits on
 * the URI's relays for a signer app to answer with the secret it carries.
 * The answer is the approval, so there is no connect handshake to repeat:
 * a reload rebuilds the session from the client key and the remote key, and
 * uses the pubkey saved at login.
 */

function randomHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** How long a signer that has answered the QR gets to say which key it holds. */
export const PUBLIC_KEY_WAIT_MS = 30_000

/** The signer's pubkey, or an error once PUBLIC_KEY_WAIT_MS has passed or `signal` gives it up. */
async function waitForPublicKey(bunker: nip46.BunkerSigner, signal?: AbortSignal): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Signer connected but did not return its public key. Try the QR flow again.')), PUBLIC_KEY_WAIT_MS)
    if (signal) {
      abort = (): void => reject(new Error(GIVEN_UP))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
  })
  try {
    return await Promise.race([bunker.getPublicKey(), stopped])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (signal && abort) signal.removeEventListener('abort', abort)
  }
}

/** A connected BunkerSigner as a Signer, with the pubkey it is known to hold. */
function wrapBunkerSigner(bunker: nip46.BunkerSigner, clientSecretKey: Uint8Array, pubkey: string, bunkerUri: string): Signer {
  const signer: Signer = {
    kind: 'nip46',
    pubkey,
    bunkerUri,
    clientSecretKey,
    nostrConnectSession: true,
    signEvent: (t) => bunker.signEvent(attributed(t)) as Promise<NostrEvent>,
    close: () => bunker.close(),
    // Half-open sockets, as nip46Signer's reconnect: dropped, and the same
    // signer opens fresh ones on its next request.
    reconnect: async () => {
      pool.close([...bunker.bp.relays])
      return signer
    },
  }
  return signer
}

/** A QR login is made synchronously so its URI can be painted while the connection waits. */
export interface NostrConnectSession {
  uri: string
  relay: string
  /**
   * Wait for a signer to answer the QR. `signal` gives the wait up (leaving
   * the QR screen); `onConnected` says the signer answered and its pubkey is
   * being asked for.
   */
  connect: (signal?: AbortSignal, onConnected?: () => void) => Promise<Signer>
}

/** A new QR session on `relayInput` (the default carries a backup relay too). Throws a readable error for a bad relay. */
export function createNostrConnectSession(relayInput = DEFAULT_SIGNER_RELAY): NostrConnectSession {
  const relay = normalizeSignerRelay(relayInput)
  const clientSecretKey = generateSecretKey()
  const uri = nip46.createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecretKey),
    relays: signerRelays(relay),
    secret: randomHex(generateSecretKey()),
    // This app only signs: no encryption is asked for.
    perms: ['get_public_key', 'sign_event'],
    name: 'snocrash',
    ...(typeof location !== 'undefined' ? { url: location.origin } : {}),
  })

  return {
    uri,
    relay,
    connect: async (signal, onConnected) => {
      const bunker = await nip46.BunkerSigner.fromURI(
        clientSecretKey,
        uri,
        // Keep the whole login handshake on the relays encoded in the QR.
        // Automatic switch_relays interoperability varies between signers and
        // can strand the get_public_key response on a relay we never selected;
        // the QR names two relays by default so neither is a single point.
        { pool: pool as never, skipSwitchRelays: true },
        signal ?? 300_000,
      )
      onConnected?.()
      let pubkey: string
      try { pubkey = await waitForPublicKey(bunker, signal) }
      catch (err) {
        await bunker.close().catch(() => { /* already gone */ })
        throw err
      }
      // The approved client key is the durable session identity. Rebuild from
      // the remote key and relay on reload; do not replay the one-time QR secret.
      const sessionUri = nip46.toBunkerURL({ ...bunker.bp, secret: null })
      return wrapBunkerSigner(bunker, clientSecretKey, pubkey, sessionUri)
    },
  }
}

/**
 * Restore a previously approved Nostr Connect session.
 *
 * The pubkey is the one saved at login, not asked for again: asking on every
 * reload needs the signer app awake before anything can sign, with no bound on
 * the wait, and an answer naming another account (the app switched accounts)
 * would put a different key behind the identity on screen.
 */
async function nostrConnectSessionSigner(bunkerUri: string, clientSecretKey: Uint8Array, pubkey: string): Promise<Signer> {
  const bp = await nip46.parseBunkerInput(bunkerUri)
  if (!bp) throw new Error('The saved Nostr Connect session is invalid.')
  const bunker = nip46.BunkerSigner.fromBunker(clientSecretKey, bp, { pool: pool as never })
  return wrapBunkerSigner(bunker, clientSecretKey, pubkey, bunkerUri)
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
  /** nip46 only: the session came from the QR, so a reload asks the signer nothing. */
  nostrConnectSession?: boolean
}

export function prefOf(signer: Signer): SignerPref {
  const base: SignerPref = { kind: signer.kind, pubkey: signer.pubkey }
  if (signer.kind === 'local' && signer.secretKey) base.nsec = nip19.nsecEncode(signer.secretKey)
  if (signer.kind === 'nip46') {
    base.bunkerUri = signer.bunkerUri
    if (signer.clientSecretKey) base.clientNsec = nip19.nsecEncode(signer.clientSecretKey)
    if (signer.nostrConnectSession) base.nostrConnectSession = true
  }
  return base
}

/**
 * Rebuild a signer from a kept preference. Local is instant; the others
 * reconnect. An extension or a bunker that answers as another key than the
 * one saved is refused with OTHER_KEY (closed, for a bunker): signing as it
 * would publish under a key the app does not show. A QR session is the
 * exception that cannot be asked: it is rebuilt with the saved pubkey.
 */
export async function signerFromPref(pref: SignerPref, signal?: AbortSignal): Promise<Signer> {
  if (pref.kind === 'local' && pref.nsec) return signerFromNsec(pref.nsec)
  if (pref.kind === 'nip07') {
    const signer = await nip07Signer(NIP07_WAIT_MS, signal)
    if (signer.pubkey !== pref.pubkey) throw new Error(OTHER_KEY)
    return signer
  }
  if (pref.kind === 'nip46' && pref.bunkerUri) {
    const clientSk = pref.clientNsec ? (nip19.decode(pref.clientNsec).data as Uint8Array) : undefined
    if (pref.nostrConnectSession && clientSk) return nostrConnectSessionSigner(pref.bunkerUri, clientSk, pref.pubkey)
    const signer = await nip46Signer(pref.bunkerUri, clientSk, signal)
    if (signer.pubkey !== pref.pubkey) {
      await signer.close?.().catch(() => { /* already gone */ })
      throw new Error(OTHER_KEY)
    }
    return signer
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
export const HANDSHAKE_LATE = 'Your signer did not answer the reconnect within a minute. Approve the connection in your signer, then try again.'

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
 * OTHER_KEY, rather than signing as someone the app does not show, and this
 * identity says so at once from then on, asking the signer nothing more:
 * every ask would be another approval for a key that cannot be used. Picking
 * a key again replaces it.
 */
export function deferredReconnect(pref: SignerPref, onReady: (s: Signer) => void): Signer {
  /** A connect in flight: who is waiting on it, and how to give it up. */
  interface Attempt { abort: AbortController; done: Promise<Signer>; waiting: number; timer: ReturnType<typeof setTimeout>; why: string | null }
  let live: Signer | null = null
  let closed = false
  let otherKey = false
  let attempt: Attempt | null = null
  /**
   * Give one connect up and forget it, if it is still the one in flight.
   * `why` is what it ends with: HANDSHAKE_LATE when its minute ran out,
   * GIVEN_UP when nobody waits on it any more or the identity was let go.
   */
  const drop = (a: Attempt, why: string): void => {
    clearTimeout(a.timer)
    a.why ??= why
    a.abort.abort()
    if (attempt === a) attempt = null
  }
  const connect = (): Attempt => {
    if (attempt) return attempt
    const abort = new AbortController()
    let late!: (err: Error) => void
    const deadline = new Promise<never>((_, reject) => { late = reject })
    const a: Attempt = { abort, waiting: 0, why: null, timer: setTimeout(() => { late(new Error(HANDSHAKE_LATE)); drop(a, HANDSHAKE_LATE) }, HANDSHAKE_PATIENCE_MS), done: null as unknown as Promise<Signer> }
    const made = signerFromPref(pref, abort.signal).then((s) => {
      // Given up while it was being made (a signer that answers despite the abort): let it go.
      if (closed || abort.signal.aborted) { void s.close?.().catch(() => { /* already gone */ }); throw new Error(closed ? GIVEN_UP : a.why ?? GIVEN_UP) }
      if (s.pubkey !== pref.pubkey) { otherKey = true; void s.close?.().catch(() => { /* already gone */ }); throw new Error(OTHER_KEY) }
      live = s
      onReady(s)
      return s
    }, (err: unknown) => {
      // signerFromPref refused another key itself (and closed it): remembered the same way.
      if (err instanceof Error && err.message === OTHER_KEY) otherKey = true
      throw err
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
    if (otherKey) return Promise.reject(new Error(OTHER_KEY))
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
        if (a.waiting === 0 && !live) drop(a, GIVEN_UP)
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
      if (attempt) drop(attempt, GIVEN_UP)
      await live?.close?.()
    },
  }
}
