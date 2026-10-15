/**
 * useNostr.ts - the identity, the relays, and the two things this app does
 * with them: publish an object and read the ones other people published.
 *
 * DECK-0003 §3.1: a standalone object is a `kind 33331` event, addressable, so
 * relays keep the newest per (pubkey, kind, d). The `d` is the object's own id,
 * stable across edits, which is what lets someone fix a mistake in an object
 * without publishing a second copy of it. The payload in `content` is exactly
 * what the workshop already writes, and it goes out as `v: 2`, the published
 * frame, which any glTF-minded tool can read without a special case.
 *
 * Keys are ONOSENDAI's four (lib/signers): a key this app makes and keeps in
 * the browser, an nsec, an encrypted ncryptsec, or a signer that is not this
 * app at all, an extension or a bunker. A key held here can be taken away
 * again, encrypted (lib/keyExport), because a key that lives in one browser is
 * one cleared cache from gone. Nothing here touches Cyberspace: an object has
 * no coordinate and this app never computes one.
 */

import { create } from 'zustand'
import { nip19, type Event } from 'nostr-tools'
import { CONNECT_DEADLINE_MS, READ_DEADLINE_MS, authAll, authForRead, connectRelay, pool, queryAny, setAuthSigner, subscribeOne } from '../lib/pool'
import { SNO_KIND, createFeed, creditAuthor, objectAddress as coordinate, creditOf, creditTags, objectFromEvent, readCredit, type Credit, type Feed, type FeedObject } from 'sno-core/feed'
import { relaySet } from './useRelays'
import {
  CANCELLED, GIVEN_UP, HANDSHAKE_LATE, OTHER_KEY, deferredReconnect, forgetSignerPref, loadSignerPref, nip07Signer, nip46Signer,
  prefOf, randomSigner, saveSignerPref, signWithin, signerFromNcryptsec, signerFromNsec,
  signerFromPref, type Signer, type SignerKind,
} from '../lib/signers'
import { exportNcryptsec } from '../lib/keyExport'
import { fingerprint, forget, loadLedger, noteRetracted, noteSeen, noteSent, retractedAt, saveLedger, type Ledger } from '../lib/published'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { refTags } from 'sno-core/parts'
import { forgetRef } from '../lib/parts'
import { hexAt, parsePaletteEvent, type Palette } from 'sno-core/snoPalette'
import type { PublishedPalette } from './useWorkshop'
import { CLIENT_TAG } from '../lib/client'

/** DECK-0003 §3.1. Addressable: the newest event per (pubkey, kind, d) stands. */
export { SNO_KIND } from 'sno-core/feed'

/**
 * DECK-0003 §1.3b. The colour-moment convention, which is where the palettes
 * on nostr already are: 205 events from 51 pubkeys at the time this was
 * written, every one of them carrying its colours as `c` tags.
 *
 * Regular, not addressable, so an event of this kind is immutable and an
 * object that names one renders the same forever.
 */
export const PALETTE_KIND = 3367

/** A palette read back off a relay, with everything needed to keep using it. */
export interface FetchedPalette {
  colors: Palette
  /** What its author called it, when they said. */
  name: string | null
  event: PublishedPalette
}

/** MINE or GLOBAL, the switch over the feed. */
export type FeedScope = 'global' | 'mine'

/** Which read of the feed is current: a switch mid-read must not let the old one paint over the new. */
let feedGen = 0
/** The read in progress, closed when a newer one starts. */
let currentFeed: Feed | null = null

/** An object someone published, with the event it came from (sno-core/feed, shared with ONOSENDAI). */
export type { FeedObject } from 'sno-core/feed'

/** Who signs right now. Not in the store: it holds a key and React state is copied. */
let signer: Signer | null = null
/**
 * Which way in is the live one. Each attempt takes the next number; one
 * that comes back after another has started, or after it was given up
 * (cancelLogin, a new key, signing out), is dropped: a bunker or an
 * extension approved later must not switch who signs behind a closed
 * modal, and its late error must not linger (review of parity #35).
 */
let attempt = 0
/** Gives the live attempt up where it can be (a bunker's handshake); see `attempt`. */
let attemptAbort: AbortController | null = null

/** Give up the attempt in flight, if any: the next one, a new key, sign-out, or ✕. */
function giveUpAttempt(): void {
  attempt++
  attemptAbort?.abort()
  attemptAbort = null
}

/** The current signer, for the one thing outside this module that needs it. */
export function currentSigner(): Signer | null { return signer }

interface NostrState {
  pubkey: string | null
  signer: SignerKind
  feed: FeedObject[]
  /** Whose objects the feed shows: everyone's, or only this key's. */
  scope: FeedScope
  loading: boolean
  publishing: boolean
  /** The publish is past signing and going out to the relays: too late to cancel. */
  sending: boolean
  notice: string | null
  /** Whether an identity has been chosen at all. */
  signedIn: boolean
  /** What this browser knows about which objects have been published. */
  published: Ledger
  /** The last thing that went wrong while choosing one. */
  loginError: string | null
  /** Whether a way in (a key, an extension, a bunker) is being tried now. */
  loggingIn: boolean
  /** Give up the way in being tried: whatever it brings back later is dropped. */
  cancelLogin: () => void
  /** Pick up a key this browser already holds, without prompting for anything. */
  init: () => Promise<void>
  useNewKey: () => void
  useNsec: (nsec: string) => Promise<void>
  useNcryptsec: (ncryptsec: string, password: string) => Promise<void>
  useExtension: () => Promise<void>
  useBunker: (uri: string) => Promise<void>
  /** Forget the key this browser holds, and who is signing. */
  signOut: () => void
  clearLoginError: () => void
  /** This device's key, encrypted (NIP-49), or a thrown error naming the problem. */
  exportKey: (password: string, again: string) => string
  npub: () => string | null
  publish: (shard: ShardModel) => Promise<boolean>
  /** Whether a retraction is in flight (RETRACT). */
  retracting: boolean
  /**
   * RETRACT: ask your relays to drop a published object (NIP-09, by address
   * and event id), through the same signing and sending as PUBLISH, and
   * forget it in the ledger once a relay takes the deletion.
   */
  retract: (shard: ShardModel) => Promise<boolean>
  /** Call off the publish in flight (the PUBLISHING chip): it sends nothing, and a reconnect it was waiting on is given up. */
  cancelPublish: () => void
  /**
   * Publish a palette as its own event, or edit one already published.
   *
   * Returns where it landed, which the caller keeps so the next publish of the
   * same palette is the next link in one chain rather than a second palette.
   */
  publishPalette: (name: string, colors: Palette, prev?: PublishedPalette) => Promise<PublishedPalette | null>
  /** Read somebody's palette event back, by `nevent` or `naddr`. */
  fetchPalette: (ref: string) => Promise<FetchedPalette | null>
  /**
   * The object an address names, newest version, or null with a notice saying
   * why. Looks in the feed already on hand first, so opening a tile costs no
   * round trip; a shared link arriving cold goes to the relays.
   */
  fetchObject: (address: string) => Promise<FeedObject | null>
  loadFeed: () => Promise<void>
  /** Show everyone's objects, or only your own, and read the relays for them. */
  setScope: (scope: FeedScope) => void
  say: (note: string | null) => void
}

/**
 * The event an object goes out as. Pure, so the shape is testable without a
 * relay. `author` is the key that will sign it: a credit naming that key
 * keeps its q, which says what the object was made from, and drops the p,
 * since nobody needs telling that they copied their own object (one opened
 * from the feed while signed out, or under another key, and edited, credits
 * whoever published it, who may be you; review of parity #35).
 */
export function objectTemplate(shard: ShardModel, createdAt: number, author?: string): { kind: number; created_at: number; tags: string[][]; content: string } {
  const payload = toPayload(shard)
  const credit = creditOf(shard)
  const notify = !credit || !author || creditAuthor(credit) !== author
  return {
    kind: SNO_KIND,
    created_at: createdAt,
    tags: [
      // The object's own id: addressable means the author can fix it in place.
      ['d', shard.id],
      ['name', shard.name],
      // What a client that cannot draw it should say instead (NIP-31).
      ['alt', `a 3D object: ${shard.name}, ${shard.vertices.length} vertices${shard.parts?.length ? `, ${shard.parts.length} placed objects` : ''}`],
      // Each object it places, as the payload names it (DECK-0003 §1.10), so
      // a relay can answer "what places this object". Readers take the
      // placements from the payload, never from these.
      ...refTags(shard),
      // A remix credits the object it was made from: the q tag naming it,
      // and, since this is published for everyone, the p that tells its
      // author (DECK-0003, crediting; arkinox, 2026-10-08).
      ...(credit ? creditTags(credit, { notify }) : []),
    ],
    content: JSON.stringify(payload),
  }
}

/**
 * The deletion that takes a kind 33331 object down (NIP-09): by its address,
 * so every version up to this moment goes, by its event id when that is
 * known, and with the `k` that says what kind it was. `reason` is the
 * content, a word for a human reading the relay. ONOSENDAI's
 * (lib/published.ts retractionTemplate), tag for tag, so a relay sees one
 * kind of retraction whichever app sent it.
 */
export function retractionTemplate(pubkey: string, d: string, eventId: string | undefined, createdAt: number, reason: string): { kind: number; created_at: number; tags: string[][]; content: string } {
  return {
    kind: 5,
    created_at: createdAt,
    content: reason,
    tags: [['a', coordinate(pubkey, d)], ...(eventId ? [['e', eventId]] : []), ['k', String(SNO_KIND)]],
  }
}

/**
 * The credit a copy of a feed object carries (REMIX). Someone else's object
 * is credited, with a relay it was seen on. A copy of your own remix keeps
 * the credit that remix was published with; a copy of your own original
 * credits the original, which goes out as the q alone, since the p would only
 * tell you (objectTemplate; review of parity #35).
 */
export function remixCredit(o: FeedObject, me: string | null): Credit {
  return (o.pubkey === me ? readCredit(o.event.tags) : null) ?? { address: o.address, ...(o.seen?.[0] ? { relay: o.seen[0] } : {}) }
}

/**
 * The event a palette goes out as (DECK-0003 §1.3b). Pure, like objectTemplate.
 *
 * One `c` tag per colour, in index order, and no second machine-readable copy
 * of them anywhere else. The colours are tags rather than content because `c`
 * is a single-letter tag, which relays index: `{"#c": ["#ff0000"]}` finds every
 * palette containing pure red, and that is a capability a palette in `content`
 * could never offer. It also makes this event a colour moment, which is what
 * the clients already publishing kind 3367 know how to show.
 *
 * `prev` turns a publish into an edit. A regular event cannot be replaced, so
 * a correction is a new event that names the old one: `previous` is the step
 * back, `genesis` is where the chain started, and the two marker words are the
 * ones Cyberspace's own action chain uses.
 */
export function paletteTemplate(
  name: string, colors: Palette, createdAt: number, prev?: PublishedPalette,
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const hexes = colors.map((_, i) => hexAt(colors, i))
  const shown = hexes.slice(0, 8).join(', ')
  const rest = hexes.length - 8
  return {
    kind: PALETTE_KIND,
    created_at: createdAt,
    tags: [
      // The palette itself. Tag n is the colour index n names.
      ...hexes.map((h) => ['c', h]),
      ['name', name],
      // How the colour-moment clients lay a palette out. Cosmetic, and theirs.
      ['layout', 'horizontal'],
      // What a client that cannot render it should say instead (NIP-31).
      ['alt', `Color palette "${name}": ${hexes.length} colors, ${shown}${rest > 0 ? `, and ${rest} more` : ''}`],
      [...CLIENT_TAG],
      ...(prev ? [['e', prev.id, prev.relays[0] ?? '', 'previous']] : []),
      // Only when it says something `previous` does not: the first edit's
      // previous IS the genesis, and one hop back finds it.
      ...(prev && prev.genesis !== prev.id ? [['e', prev.genesis, '', 'genesis']] : []),
    ],
    // Deliberately not the palette. A colour-moment client puts a note or an
    // emoji here, and a second copy of the colours would be the same thing
    // spelled twice, with a rule needed to say which copy wins.
    content: '',
  }
}

/**
 * The reference an object carries to name a palette (DECK-0003 §1.3a).
 *
 * An nevent rather than an naddr, because a palette event is regular and has
 * no address, and because naming one immutable event is what pins an object's
 * colours: an author correcting a palette publishes a new event and cannot
 * repaint objects that already name the old one.
 */
export function paletteNevent(event: PublishedPalette): string {
  return nip19.neventEncode({ id: event.id, relays: event.relays.slice(0, 2), kind: PALETTE_KIND })
}

/**
 * An object's address: the naddr for its kind, author and `d`.
 *
 * An naddr rather than an nevent because an object is addressable: the link
 * should open whatever the author's current version is, not the version that
 * happened to be on screen when it was shared. Up to two relays it was actually
 * seen on ride along as hints, so a shared link can be followed by a client
 * whose relays never carried it.
 */
export function objectAddress(o: FeedObject): string {
  const relays = (o.seen ?? []).slice(0, 2)
  return nip19.naddrEncode({ kind: SNO_KIND, pubkey: o.pubkey, identifier: o.d, relays })
}

/** What an object address names, or null when it is not one: another kind, or not an naddr at all. */
export function decodeObjectAddress(address: string): { pubkey: string; d: string; relays: string[] } | null {
  try {
    const decoded = nip19.decode(address.trim().replace(/^nostr:/, ''))
    if (decoded.type !== 'naddr' || decoded.data.kind !== SNO_KIND) return null
    return { pubkey: decoded.data.pubkey, d: decoded.data.identifier, relays: decoded.data.relays ?? [] }
  } catch { return null }
}

/** The relays a reference names, ahead of this client's own, because the author knew where it was. */
function withHints(hints: string[] | undefined): string[] {
  return [...new Set([...(hints ?? []), ...relaySet()])]
}

/** The object an event carries, or null when it is not one or is malformed (sno-core/feed). */
export { objectFromEvent } from 'sno-core/feed'

/**
 * Take a signer, or say why not.
 *
 * Every way in behaves the same on failure: nothing changes, and the reason is
 * shown where it was asked for. A half-adopted signer would leave the app
 * signing as somebody it no longer is.
 */
async function adopt(set: (p: Partial<NostrState>) => void, make: (signal: AbortSignal) => Signer | Promise<Signer>): Promise<void> {
  giveUpAttempt()
  const mine = attempt
  const abort = new AbortController()
  attemptAbort = abort
  set({ loggingIn: true })
  try {
    const next = await make(abort.signal)
    // Given up, or overtaken, while it was being made: let it go unused.
    if (mine !== attempt) { void next.close?.().catch(() => { /* already gone */ }); return }
    const old = signer
    signer = next
    // The one it replaces holds sockets of its own; let them go.
    if (old && old !== next) void old.close?.().catch(() => { /* already gone */ })
    saveSignerPref(prefOf(next))
    set({ pubkey: next.pubkey, signer: next.kind, signedIn: true, loginError: null })
  } catch (err) {
    if (mine !== attempt) return
    set({ loginError: err instanceof Error ? err.message : String(err) })
  } finally {
    if (mine === attempt) { attemptAbort = null; set({ loggingIn: false }) }
  }
}

/**
 * A signature, with the patience a remote signer needs.
 *
 * A local key signs at once. An extension or a bunker gets SIGN_PATIENCE_MS,
 * and if it does not answer its channel is presumed dead, which is what a
 * phone leaves behind after the tab has sat in another app: the sockets look
 * open and the request goes into the void. So they are dropped and the same
 * signer is asked once more over fresh ones.
 *
 * A saved identity reconnects first (deferredReconnect), and the patience
 * starts once that handshake is done: a slow one is somebody approving the
 * connection on their phone, not a dead channel, and taking it for one asked
 * them a second time (review of parity #35).
 */
async function signEvent(template: Parameters<Signer['signEvent']>[0], signal?: AbortSignal): Promise<Event> {
  const asked = signer
  if (!asked) throw new Error('Pick a key first.')
  if (asked.kind === 'local' && !asked.ready) return asked.signEvent(template) as Promise<Event>
  pendingSigns++
  try {
    // A saved identity's handshake first, on its own clock (a minute,
    // HANDSHAKE_PATIENCE_MS); the signature's starts after it.
    const current = asked.ready ? await asked.ready(signal) : asked
    if (current.kind === 'local') return await current.signEvent(template) as Event
    try {
      return await untilCancelled(signWithin(current, template), signal) as Event
    } catch (err) {
      if (!current.reconnect || (err instanceof Error && err.message === CANCELLED)) throw err
      const fresh = await current.reconnect()
      if (signer === current) signer = fresh
      return await untilCancelled(signWithin(fresh, template), signal) as Event
    }
  } catch (err) {
    // The key changed (or was signed out) while this was being signed:
    // whatever else went wrong, that is what happened (review of parity #35).
    if (signer?.pubkey !== asked.pubkey) throw new Error(GIVEN_UP)
    throw err
  } finally {
    pendingSigns--
  }
}

/** A promise, or CANCELLED as soon as `signal` fires. */
function untilCancelled<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(new Error(CANCELLED))
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => reject(new Error(CANCELLED))
    signal.addEventListener('abort', cancel, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

/** What a publish that went out signed by a key that is no longer this one says. */
const KEY_CHANGED = 'Not published: the key changed while it was going out. Publish again to sign it with the current key.'

/** What a publish that failed says. */
function publishFailed(err: unknown, signedIn: boolean): string {
  const why = err instanceof Error ? err.message : String(err)
  if (why === CANCELLED) return 'Publishing cancelled. Nothing went out.'
  if (why === HANDSHAKE_LATE || why === OTHER_KEY) return why
  // Signed out meanwhile: that was the point, so nothing more to say.
  if (why === GIVEN_UP) return signedIn ? KEY_CHANGED : 'Signed out, so nothing was published.'
  return `Could not publish: ${why}`
}

/** What a publish refused while a retraction is in flight says. */
const RETRACTION_OUT = 'A retraction is going out. Try again once it is done.'

/** What a retraction that failed says: the same cases as a publish, in its own words. */
function retractFailed(err: unknown, signedIn: boolean, name: string): string {
  const why = err instanceof Error ? err.message : String(err)
  if (why === CANCELLED) return 'Retraction cancelled. Nothing went out.'
  if (why === HANDSHAKE_LATE || why === OTHER_KEY) return why
  // Only the key that published an object can retract it, so a new key has nothing to resend.
  if (why === GIVEN_UP) return signedIn ? `Not retracted: the key changed while it was going out. Only the key that published "${name}" can retract it.` : 'Signed out, so nothing was retracted.'
  return `Could not retract "${name}": ${why}`
}

/**
 * A per-object clock, so a publish is strictly newer than the last publish
 * or retraction of the same object: a relay keeps the addressable event with
 * the greatest created_at, and a deletion by address covers every version up
 * to its own second (sno-core isDeleted), so PUBLISH AGAIN or PUBLISH after
 * RETRACT inside one second would otherwise lose. Session-local, seeded from
 * the ledger's record of the last send. ONOSENDAI's (store/usePublished.ts).
 *
 * A retraction forgets the ledger's record, so its second is kept apart for a
 * while (lib/published retractedAt): a PUBLISH right after a reload must
 * still land newer than the deletion, or relays that honor it drop the new
 * version too (review of parity #36).
 */
const clock = new Map<string, number>()
function nextAt(id: string, floor: number): number {
  const now = Math.floor(Date.now() / 1000)
  const at = Math.max(now, floor + 1, (clock.get(id) ?? 0) + 1)
  clock.set(id, at)
  return at
}

/**
 * The last word before an event goes out: not cancelled, and still signed by
 * the key this app is now. A key change or a sign-out during the relays'
 * sign-in comes after the signature, so it is checked here, right before
 * sending (review of parity #35).
 */
function readyToSend(signed: Event, signal: AbortSignal, currentPubkey: () => string | null): void {
  if (signal.aborted) throw new Error(CANCELLED)
  if (signed.pubkey !== currentPubkey()) throw new Error(GIVEN_UP)
}

/** The publish in flight, so the PUBLISHING chip can call it off. */
let publishAbort: AbortController | null = null

/**
 * Sign for a publish, and check it is still yours to send: an extension or a
 * bunker that answers after the key was changed signed as the old key, and
 * that must not go out (review of parity #35).
 */
async function signForPublish(template: Parameters<Signer['signEvent']>[0], signal: AbortSignal, currentPubkey: () => string | null): Promise<Event> {
  const signed = await signEvent(template, signal)
  if (signal.aborted) throw new Error(CANCELLED)
  if (signed.pubkey !== currentPubkey()) throw new Error(GIVEN_UP)
  return signed
}

/**
 * How the pool answers a relay's NIP-42 challenge.
 *
 * Given to it rather than imported by it, because that module is imported here
 * and the other direction would be a cycle. An auth event is signed by whoever
 * is signing everything else, so an auth-gated relay sees the same identity
 * that publishes.
 */
setAuthSigner(async (template) => {
  // The first read of a visit can reach a relay's challenge before the
  // identity is restored: a page's effects run child first, so the feed asks
  // before App's init() has set the signer. Wait for it, briefly, rather than
  // fail the challenge and have the relay close the read.
  for (let i = 0; i < 60 && !signer; i++) await new Promise((r) => setTimeout(r, 50))
  return signEvent(template)
})

/** Remote signatures in flight, so a wake cannot drop the sockets one is arriving on. */
let pendingSigns = 0

/**
 * The tab is back from another app.
 *
 * A remote signer's sockets are presumed half-open and dropped now, before
 * anything is asked of them, so the next request goes out over live ones. Not
 * while a signature is pending: the answer to that one is on its way over
 * these sockets, and dropping them would lose it and ask again, which is a
 * second prompt for the same event. If they really are dead, that request's
 * own timeout reconnects and asks again.
 */
function wakeSigner(): void {
  const current = signer
  // A saved identity that has not connected yet has no sockets to refresh,
  // and starting its connect here would put a round trip on the phone
  // nobody asked for (review of parity #35).
  if (!current || current.kind === 'local' || current.ready || pendingSigns > 0) return
  void current.reconnect?.().then((fresh) => { if (signer === current) signer = fresh }).catch(() => { /* next request retries */ })
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeSigner() })
}

export const useNostr = create<NostrState>((set, get) => ({
  pubkey: null,
  signer: 'local',
  signedIn: false,
  published: loadLedger(),
  loginError: null,
  loggingIn: false,
  feed: [],
  scope: 'global',
  loading: false,
  publishing: false,
  retracting: false,
  sending: false,
  notice: null,

  init: async () => {
    const pref = loadSignerPref()
    if (pref) {
      // A local key is instant. An extension or a bunker is shown by its
      // pubkey now and reconnected on the first thing that needs a signature,
      // so opening the app never waits on somebody's phone.
      try {
        // The live signer a later handshake brings back replaces the deferred
        // one only while that is still who signs: an identity chosen in the
        // meantime stays chosen, and the late one is let go (review of
        // parity #35).
        const lazy: Signer = pref.kind === 'local'
          ? await signerFromPref(pref)
          : deferredReconnect(pref, (live) => {
            if (signer === lazy) signer = live
            else void live.close?.().catch(() => { /* already gone */ })
          })
        signer = lazy
        set({ pubkey: signer.pubkey, signer: signer.kind, signedIn: true })
        return
      } catch {
        // A stored identity that cannot be rebuilt: say so rather than
        // silently handing over a different one, which would look like the
        // objects published under it had vanished.
        set({ notice: 'The identity this browser had could not be restored. Choose a key in the menu.' })
        return
      }
    }
    // Nobody has been here before. Rather than meet a new arrival with a
    // question they have no way to answer yet, make them a key: everything in
    // the app works from that moment, and the first thing they build can be
    // published without a detour through key management they did not ask for.
    //
    // It is kept, not thrown away at the end of the tab. A key that vanished on
    // reload would take everything published under it with it, unreachable and
    // unrepairable, which is a worse trade than a key somebody has to be told
    // to export. The notice says exactly that, and the menu offers the export
    // and a way to bring a real key instead.
    get().useNewKey()
  },

  useNewKey: () => {
    giveUpAttempt()
    const old = signer
    signer = randomSigner()
    if (old) void old.close?.().catch(() => { /* already gone */ })
    saveSignerPref(prefOf(signer))
    set({
      pubkey: signer.pubkey, signer: 'local', signedIn: true, loginError: null, loggingIn: false,
      notice: 'A key was made in this browser. Export it before you clear your cache, or it is gone.',
    })
  },

  useNsec: async (nsec) => { await adopt(set, () => signerFromNsec(nsec)) },
  useNcryptsec: async (ncryptsec, password) => { await adopt(set, () => signerFromNcryptsec(ncryptsec, password)) },
  useExtension: async () => { await adopt(set, () => nip07Signer()) },
  useBunker: async (uri) => { await adopt(set, (signal) => nip46Signer(uri, undefined, signal)) },

  signOut: () => {
    giveUpAttempt()
    void signer?.close?.().catch(() => { /* already gone */ })
    signer = null
    forgetSignerPref()
    set({ pubkey: null, signedIn: false, signer: 'local', loginError: null, loggingIn: false, notice: 'Signed out. The key this browser held is gone.' })
  },

  clearLoginError: () => set({ loginError: null }),

  cancelLogin: () => { giveUpAttempt(); set({ loggingIn: false, loginError: null }) },

  exportKey: (password, again) => exportNcryptsec(signer?.secretKey, password, again),

  npub: () => {
    const pk = get().pubkey
    try { return pk ? nip19.npubEncode(pk) : null } catch { return null }
  },

  publish: async (shard) => {
    const relays = relaySet()
    // One thing out at a time: they share the chip, and its cancel.
    if (get().retracting) { set({ notice: RETRACTION_OUT }); return false }
    if (!signer) { set({ notice: 'Pick a key first.' }); return false }
    if (shard.vertices.length === 0 && !shard.parts?.length) { set({ notice: 'An empty object has nothing to publish.' }); return false }
    set({ publishing: true, notice: null })
    const template = objectTemplate(shard, nextAt(shard.id, Math.max(get().published[shard.id]?.at ?? 0, retractedAt(shard.id))), signer.pubkey)
    const abort = new AbortController()
    publishAbort = abort
    try {
      const signed = await signForPublish(template, abort.signal, () => get().pubkey)
      // A relay that gates reads gates writes, and an unauthenticated publish
      // is refused rather than queued.
      await untilCancelled(authAll(relays), abort.signal)
      readyToSend(signed, abort.signal, () => get().pubkey)
      set({ sending: true })
      const results = await Promise.allSettled(pool.publish(relays, signed))
      const took = results.filter((r) => r.status === 'fulfilled').length
      if (took > 0) {
        // Written down here rather than asked of a relay later: an addressable
        // event keeps no memory of what it replaced, so this is the only record
        // that this object went out and what it looked like when it did.
        const ledger = noteSent(get().published, shard.id, fingerprint(template.content), signed.pubkey, signed.created_at, signed.id)
        saveLedger(ledger)
        set({ published: ledger })
        // Every object placing this one shows the new version at once.
        forgetRef(['a', `${SNO_KIND}:${signed.pubkey}:${shard.id}`])
      }
      set({
        publishing: false,
        notice: took > 0 ? `"${shard.name}" is published to ${took} of ${relays.length} relays.` : 'No relay took it.',
      })
      if (took > 0) void get().loadFeed()
      return took > 0
    } catch (err) {
      set({ publishing: false, notice: publishFailed(err, get().signedIn) })
      return false
    } finally {
      if (publishAbort === abort) publishAbort = null
      set({ sending: false })
    }
  },

  cancelPublish: () => { publishAbort?.abort() },

  retract: async (shard) => {
    if (get().retracting) return false
    if (get().publishing) { set({ notice: 'Something is being published. Retract once it is done.' }); return false }
    if (!signer) { set({ notice: 'Pick a key first.' }); return false }
    const me = signer.pubkey
    const rec = get().published[shard.id]
    // Only what this browser knows went out is retracted: a deletion is
    // irreversible, and one for an object never published is a mistake
    // (review of parity #36).
    if (!rec) { set({ notice: `"${shard.name}" has not been published from here, so there is nothing to retract.` }); return false }
    // Only the author's deletion deletes (NIP-09): an object published under
    // another key is not this key's to take down.
    if (rec.pubkey !== me) { set({ notice: 'This object was published under another key; only that key can retract it.' }); return false }
    const relays = relaySet()
    set({ retracting: true, notice: null })
    const abort = new AbortController()
    publishAbort = abort
    try {
      // The same path as PUBLISH: the signer's patience, a cancel from the
      // chip, and the key checked once signed and again right before sending.
      const template = retractionTemplate(me, shard.id, rec.id, nextAt(shard.id, Math.max(rec.at, retractedAt(shard.id))), 'object retracted')
      const signed = await signForPublish(template, abort.signal, () => get().pubkey)
      await untilCancelled(authAll(relays), abort.signal)
      readyToSend(signed, abort.signal, () => get().pubkey)
      set({ sending: true })
      const results = await Promise.allSettled(pool.publish(relays, signed))
      const took = results.filter((r) => r.status === 'fulfilled').length
      if (took === 0) {
        set({ retracting: false, notice: `No relay took the retraction of "${shard.name}".` })
        return false
      }
      const ledger = forget(get().published, shard.id)
      saveLedger(ledger)
      noteRetracted(shard.id, signed.created_at)
      // Every object placing this one stops drawing it on its next fetch.
      forgetRef(['a', coordinate(me, shard.id)])
      set({
        published: ledger,
        retracting: false,
        notice: `"${shard.name}" is retracted: the deletion went to ${took} of ${relays.length} relays. Relays that honor it drop the object. PUBLISH puts it back.`,
      })
      void get().loadFeed()
      return true
    } catch (err) {
      set({ retracting: false, notice: retractFailed(err, get().signedIn, shard.name) })
      return false
    } finally {
      if (publishAbort === abort) publishAbort = null
      set({ sending: false })
    }
  },

  publishPalette: async (name, colors, prev) => {
    const relays = relaySet()
    if (get().retracting) { set({ notice: RETRACTION_OUT }); return null }
    if (!signer) { set({ notice: 'Pick a key first.' }); return null }
    if (colors.length < 2 || colors.length > 256) { set({ notice: 'A palette is 2 to 256 colors.' }); return null }
    set({ publishing: true, notice: null })
    const abort = new AbortController()
    publishAbort = abort
    try {
      const signed = await signForPublish(paletteTemplate(name, colors, Math.floor(Date.now() / 1000), prev), abort.signal, () => get().pubkey)
      await untilCancelled(authAll(relays), abort.signal)
      readyToSend(signed, abort.signal, () => get().pubkey)
      set({ sending: true })
      const results = await Promise.allSettled(pool.publish(relays, signed))
      const took = relays.filter((_, i) => results[i]?.status === 'fulfilled')
      if (took.length === 0) {
        set({ publishing: false, notice: 'No relay took it.' })
        return null
      }
      set({
        publishing: false,
        notice: prev
          ? `"${name}" is edited, as a new event on ${took.length} of ${relays.length} relays. Objects on the old one keep the old colors.`
          : `"${name}" is published to ${took.length} of ${relays.length} relays.`,
      })
      // Only the relays that took it: a hint pointing somewhere the event is
      // not is worse than no hint, because a reader spends its fetch there.
      return { id: signed.id, genesis: prev?.genesis ?? signed.id, relays: took }
    } catch (err) {
      set({ publishing: false, notice: publishFailed(err, get().signedIn) })
      return null
    } finally {
      if (publishAbort === abort) publishAbort = null
      set({ sending: false })
    }
  },

  fetchObject: async (address) => {
    const where = decodeObjectAddress(address)
    if (!where) { set({ notice: 'That link does not point at an object.' }); return null }
    const held = get().feed.find((o) => o.pubkey === where.pubkey && o.d === where.d)
    if (held) return held
    const found = await queryAny(withHints(where.relays), { kinds: [SNO_KIND], authors: [where.pubkey], '#d': [where.d] })
    // Several relays may each hold a different edit; the newest is the object.
    const newest = found.sort((a, b) => b.event.created_at - a.event.created_at)[0]
    const ev = newest?.event
    if (!ev) { set({ notice: 'No relay had that object. It may have been deleted, or live on a relay this app does not reach.' }); return null }
    const o = objectFromEvent(ev)
    if (!o) { set({ notice: 'That object could not be read.' }); return null }
    // Where it was seen, as the feed's own objects say: the relay a credit
    // names when this object is edited into a copy (review of parity #35).
    return { ...o, seen: newest.relays }
  },

  fetchPalette: async (ref) => {
    let decoded: nip19.DecodedResult
    try { decoded = nip19.decode(ref.trim().replace(/^nostr:/, '')) } catch {
      set({ notice: 'That is not an nevent or an naddr.' })
      return null
    }
    // An nevent names one immutable event, which is what an object is pinned
    // to. An naddr is accepted because somebody may publish a palette as an
    // addressable event of their own; the shape rules are the same once it is
    // in hand (DECK-0003 §1.3b).
    const [filter, hints] = decoded.type === 'nevent'
      ? [{ ids: [decoded.data.id] }, decoded.data.relays]
      : decoded.type === 'naddr'
        ? [{ kinds: [decoded.data.kind], authors: [decoded.data.pubkey], '#d': [decoded.data.identifier] }, decoded.data.relays]
        : [null, undefined]
    if (!filter) {
      set({ notice: 'That points at something else. A palette is an nevent or an naddr.' })
      return null
    }
    const relays = withHints(hints)
    const found = await queryAny(relays, filter)
    // The newest, for an naddr that several relays answer with different
    // versions of. An nevent can only match one event, so this is a no-op there.
    const newest = found.sort((a, b) => b.event.created_at - a.event.created_at)[0]
    const ev = newest?.event
    if (!ev) {
      // Which relays, because "no relay had it" is unactionable and the usual
      // cause is that the pointer named none. An nevent with no relay hint can
      // only be looked for where this app already goes, and a palette
      // published on somebody else's relay is not there. Espy's palettes, for
      // one, live on relay.ditto.pub and its nevents carry no hints at all.
      const shown = relays.slice(0, 3).map((r) => r.replace(/^wss:\/\//, ''))
      const rest = relays.length - shown.length
      set({
        notice: `No relay had that event. Looked on ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
          + `${hints?.length ? '' : ', and the pointer named no relay of its own'}`
          + '. Add the relay it lives on in the menu, or paste the colors instead.',
      })
      return null
    }
    const colors = parsePaletteEvent(ev)
    if (!colors) {
      // A failed fetch rather than an error, in the deck's sense: the event is
      // real and is simply not a palette, so there is nothing to adopt.
      set({ notice: 'That event carries no palette.' })
      return null
    }
    // Where it was actually seen, not where it was looked for, because that is
    // what a relay hint is for.
    const seen = newest.relays
    return {
      colors,
      name: ev.tags.find((t) => t[0] === 'name')?.[1] ?? null,
      event: { id: ev.id, genesis: ev.id, relays: seen.length ? seen : relays.slice(0, 1) },
    }
  },

  loadFeed: async () => {
    // The read is sno-core's (sno-core/feed), shared with ONOSENDAI: each
    // relay asked on its own, the newest event per address, objects painted
    // as they arrive in batches rather than once the slowest relay finishes.
    const gen = ++feedGen
    const mineOnly = get().scope === 'mine'
    const me = get().pubkey
    set({ loading: true, feed: [] })
    if (mineOnly && !me) { set({ loading: false, notice: 'Choose a key in the menu to see your own objects.' }); return }
    // A switch of scope mid-read stops the old read rather than letting it run on.
    currentFeed?.close()
    const feed = createFeed({
      relays: relaySet(),
      // A FeedFilter is a nostr Filter with no tag keys.
      subscribe: (url, filter, handlers) => subscribeOne(url, { ...filter }, handlers),
      authors: mineOnly && me ? [me] : undefined,
      pageSize: 100,
      // The connect bounded on its own, the auth on its own allowance (a
      // signer may be a person approving it): sno-core/feed ReadOptions.
      read: { connect: connectRelay, auth: authForRead, connectMs: CONNECT_DEADLINE_MS, deadlineMs: READ_DEADLINE_MS },
      onChange: (st) => { if (gen === feedGen) set({ feed: st.objects }) },
    })
    currentFeed = feed
    await feed.more()
    if (currentFeed === feed) currentFeed = null
    // An object of mine that came back from a relay was published, even if it
    // was published from another browser. It is noted without a fingerprint,
    // because what a relay returns has been through the reader and the writer
    // again and need only match in meaning, not byte for byte.
    const mine = get().pubkey
    // Only the newest load: an older one finishing late would put back a
    // record a retraction just forgot (review of parity #36).
    if (mine && gen === feedGen) {
      let ledger = get().published
      for (const o of get().feed) if (o.pubkey === mine) ledger = noteSeen(ledger, o.d, mine, o.createdAt, o.id)
      if (ledger !== get().published) { saveLedger(ledger); set({ published: ledger }) }
    }
    if (gen === feedGen) set({ loading: false })
  },

  setScope: (scope) => {
    if (scope === get().scope) return
    set({ scope })
    void get().loadFeed()
  },

  say: (note) => set({ notice: note }),
}))
