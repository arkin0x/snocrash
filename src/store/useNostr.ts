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
import { pool, queryAny, stream } from '../lib/pool'
import { relaySet } from './useRelays'
import {
  deferredReconnect, forgetSignerPref, loadSignerPref, nip07Signer, nip46Signer,
  prefOf, randomSigner, saveSignerPref, signWithin, signerFromNcryptsec, signerFromNsec,
  signerFromPref, type Signer, type SignerKind,
} from '../lib/signers'
import { exportNcryptsec } from '../lib/keyExport'
import { fingerprint, loadLedger, noteSeen, noteSent, saveLedger, type Ledger } from '../lib/published'
import { fromPayload, toPayload, type ShardModel } from 'sno-core/shards'
import { hexAt, parsePaletteEvent, type Palette } from 'sno-core/snoPalette'
import type { PublishedPalette } from './useWorkshop'

/** DECK-0003 §3.1. Addressable: the newest event per (pubkey, kind, d) stands. */
export const SNO_KIND = 33331

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

/** An object someone published, with the event it came from. */
export interface FeedObject {
  id: string
  pubkey: string
  createdAt: number
  /** The `d` tag: this object's identity, stable across its edits. */
  d: string
  shard: ShardModel
}

/** Who signs right now. Not in the store: it holds a key and React state is copied. */
let signer: Signer | null = null

/** The current signer, for the one thing outside this module that needs it. */
export function currentSigner(): Signer | null { return signer }

interface NostrState {
  pubkey: string | null
  signer: SignerKind
  feed: FeedObject[]
  loading: boolean
  publishing: boolean
  notice: string | null
  /** Whether an identity has been chosen at all. */
  signedIn: boolean
  /** What this browser knows about which objects have been published. */
  published: Ledger
  /** The last thing that went wrong while choosing one. */
  loginError: string | null
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
  /**
   * Publish a palette as its own event, or edit one already published.
   *
   * Returns where it landed, which the caller keeps so the next publish of the
   * same palette is the next link in one chain rather than a second palette.
   */
  publishPalette: (name: string, colors: Palette, prev?: PublishedPalette) => Promise<PublishedPalette | null>
  /** Read somebody's palette event back, by `nevent` or `naddr`. */
  fetchPalette: (ref: string) => Promise<FetchedPalette | null>
  loadFeed: () => Promise<void>
  say: (note: string | null) => void
}

/** The event an object goes out as. Pure, so the shape is testable without a relay. */
export function objectTemplate(shard: ShardModel, createdAt: number): { kind: number; created_at: number; tags: string[][]; content: string } {
  const payload = toPayload(shard)
  return {
    kind: SNO_KIND,
    created_at: createdAt,
    tags: [
      // The object's own id: addressable means the author can fix it in place.
      ['d', shard.id],
      ['name', shard.name],
      // What a client that cannot draw it should say instead (NIP-31).
      ['alt', `a 3D object: ${shard.name}, ${shard.vertices.length} vertices`],
    ],
    content: JSON.stringify(payload),
  }
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
      ['client', 'snocrash'],
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

/** The relays a reference names, ahead of this client's own, because the author knew where it was. */
function withHints(hints: string[] | undefined): string[] {
  return [...new Set([...(hints ?? []), ...relaySet()])]
}

/** The object an event carries, or null when it is not one or is malformed. */
export function objectFromEvent(ev: Event): FeedObject | null {
  if (ev.kind !== SNO_KIND) return null
  const d = ev.tags.find((t) => t[0] === 'd')?.[1]
  if (!d) return null
  let shard: ShardModel | null = null
  try { shard = fromPayload(JSON.parse(ev.content), `${ev.pubkey}:${d}`) } catch { return null }
  if (!shard || shard.vertices.length === 0) return null
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, d, shard }
}

/**
 * Take a signer, or say why not.
 *
 * Every way in behaves the same on failure: nothing changes, and the reason is
 * shown where it was asked for. A half-adopted signer would leave the app
 * signing as somebody it no longer is.
 */
async function adopt(set: (p: Partial<NostrState>) => void, make: () => Signer | Promise<Signer>): Promise<void> {
  try {
    const next = await make()
    const old = signer
    signer = next
    // The one it replaces holds sockets of its own; let them go.
    if (old && old !== next) void old.close?.().catch(() => { /* already gone */ })
    saveSignerPref(prefOf(next))
    set({ pubkey: next.pubkey, signer: next.kind, signedIn: true, loginError: null })
  } catch (err) {
    set({ loginError: err instanceof Error ? err.message : String(err) })
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
 */
async function signEvent(template: Parameters<Signer['signEvent']>[0]): Promise<Event> {
  const current = signer
  if (!current) throw new Error('Pick a key first.')
  if (current.kind === 'local') return current.signEvent(template) as Promise<Event>
  pendingSigns++
  try {
    return await signWithin(current, template) as Event
  } catch (err) {
    if (!current.reconnect) throw err
    const fresh = await current.reconnect()
    if (signer === current) signer = fresh
    return await signWithin(fresh, template) as Event
  } finally {
    pendingSigns--
  }
}

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
  if (!current || current.kind === 'local' || pendingSigns > 0) return
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
  feed: [],
  loading: false,
  publishing: false,
  notice: null,

  init: async () => {
    const pref = loadSignerPref()
    if (pref) {
      // A local key is instant. An extension or a bunker is shown by its
      // pubkey now and reconnected on the first thing that needs a signature,
      // so opening the app never waits on somebody's phone.
      try {
        signer = pref.kind === 'local'
          ? await signerFromPref(pref)
          : deferredReconnect(pref, (live) => { signer = live })
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
    const old = signer
    signer = randomSigner()
    if (old) void old.close?.().catch(() => { /* already gone */ })
    saveSignerPref(prefOf(signer))
    set({
      pubkey: signer.pubkey, signer: 'local', signedIn: true, loginError: null,
      notice: 'A key was made in this browser. Export it before you clear your cache, or it is gone.',
    })
  },

  useNsec: async (nsec) => { await adopt(set, () => signerFromNsec(nsec)) },
  useNcryptsec: async (ncryptsec, password) => { await adopt(set, () => signerFromNcryptsec(ncryptsec, password)) },
  useExtension: async () => { await adopt(set, () => nip07Signer()) },
  useBunker: async (uri) => { await adopt(set, () => nip46Signer(uri)) },

  signOut: () => {
    void signer?.close?.().catch(() => { /* already gone */ })
    signer = null
    forgetSignerPref()
    set({ pubkey: null, signedIn: false, signer: 'local', loginError: null, notice: 'Signed out. The key this browser held is gone.' })
  },

  clearLoginError: () => set({ loginError: null }),

  exportKey: (password, again) => exportNcryptsec(signer?.secretKey, password, again),

  npub: () => {
    const pk = get().pubkey
    try { return pk ? nip19.npubEncode(pk) : null } catch { return null }
  },

  publish: async (shard) => {
    const relays = relaySet()
    if (!signer) { set({ notice: 'Pick a key first.' }); return false }
    if (shard.vertices.length === 0) { set({ notice: 'An empty object has nothing to publish.' }); return false }
    set({ publishing: true, notice: null })
    const template = objectTemplate(shard, Math.floor(Date.now() / 1000))
    try {
      const signed = await signEvent(template)
      const results = await Promise.allSettled(pool.publish(relays, signed))
      const took = results.filter((r) => r.status === 'fulfilled').length
      if (took > 0) {
        // Written down here rather than asked of a relay later: an addressable
        // event keeps no memory of what it replaced, so this is the only record
        // that this object went out and what it looked like when it did.
        const ledger = noteSent(get().published, shard.id, fingerprint(template.content), signed.pubkey, signed.created_at)
        saveLedger(ledger)
        set({ published: ledger })
      }
      set({
        publishing: false,
        notice: took > 0 ? `"${shard.name}" is published to ${took} of ${relays.length} relays.` : 'No relay took it.',
      })
      if (took > 0) void get().loadFeed()
      return took > 0
    } catch (err) {
      set({ publishing: false, notice: `Could not publish: ${err instanceof Error ? err.message : String(err)}` })
      return false
    }
  },

  publishPalette: async (name, colors, prev) => {
    const relays = relaySet()
    if (!signer) { set({ notice: 'Pick a key first.' }); return null }
    if (colors.length < 2 || colors.length > 256) { set({ notice: 'A palette is 2 to 256 colors.' }); return null }
    set({ publishing: true, notice: null })
    try {
      const signed = await signEvent(paletteTemplate(name, colors, Math.floor(Date.now() / 1000), prev))
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
      set({ publishing: false, notice: `Could not publish: ${err instanceof Error ? err.message : String(err)}` })
      return null
    }
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
    const ev = found.sort((a, b) => b.created_at - a.created_at)[0]
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
    const seen = [...(pool.seenOn.get(ev.id) ?? [])].map((r) => r.url)
    return {
      colors,
      name: ev.tags.find((t) => t[0] === 'name')?.[1] ?? null,
      event: { id: ev.id, genesis: ev.id, relays: seen.length ? seen : relays.slice(0, 1) },
    }
  },

  loadFeed: async () => {
    // Objects appear as they arrive rather than when the last relay finishes.
    // Waiting for all of them meant the whole read cost whatever the slowest
    // one cost, and one of four is always slow (lib/pool).
    set({ loading: true, feed: [] })
    // Addressable: one object per (pubkey, d), the newest of them. Relays
    // repeat each other, so the same event arrives more than once and an older
    // edit can arrive after a newer one; the map settles both.
    const newest = new Map<string, Event>()
    let paint: number | undefined
    const show = (): void => {
      paint = undefined
      set({
        feed: [...newest.values()]
          .map(objectFromEvent)
          .filter((o): o is FeedObject => o !== null)
          .sort((a, b) => b.createdAt - a.createdAt),
      })
    }
    try {
      await stream(relaySet(), { kinds: [SNO_KIND], limit: 100 }, (ev) => {
        const d = ev.tags.find((t) => t[0] === 'd')?.[1]
        if (!d) return
        const key = `${ev.pubkey}:${d}`
        const prev = newest.get(key)
        if (prev && prev.created_at >= ev.created_at) return
        newest.set(key, ev)
        // A burst from one relay is one repaint, not one per event: parsing
        // and drawing every object again for each arrival is what would make
        // a fast read feel slow.
        if (paint === undefined) paint = window.setTimeout(show, 120)
      }).done
    } catch {
      set({ notice: 'Could not reach the relays.' })
    }
    window.clearTimeout(paint)
    show()
    // An object of mine that came back from a relay was published, even if it
    // was published from another browser. It is noted without a fingerprint,
    // because what a relay returns has been through the reader and the writer
    // again and need only match in meaning, not byte for byte.
    const mine = get().pubkey
    if (mine) {
      let ledger = get().published
      for (const o of get().feed) if (o.pubkey === mine) ledger = noteSeen(ledger, o.d, mine, o.createdAt)
      if (ledger !== get().published) { saveLedger(ledger); set({ published: ledger }) }
    }
    set({ loading: false })
  },

  say: (note) => set({ notice: note }),
}))
