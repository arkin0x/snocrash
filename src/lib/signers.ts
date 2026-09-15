/**
 * signers.ts - who signs, and where the key lives.
 *
 * Four ways in, which are the four ways nostr has: a key this app makes and
 * keeps in the browser, an nsec pasted in, an encrypted ncryptsec unlocked with
 * its password, or a signer that is not this app at all, a browser extension
 * (NIP-07) or a remote bunker (NIP-46).
 *
 * The distinction that matters everywhere else in the app is whether the key is
 * here. Only a local signer has a `secretKey`, and only a local signer can be
 * exported (lib/keyExport): an extension and a bunker hold their own key and it
 * is theirs to give, not this app's.
 *
 * This is ONOSENDAI's signer model, rewritten small. The original reaches its
 * whole relay layer to hand the bunker a shared pool, which is most of that
 * app; here the bunker opens its own.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19, type EventTemplate, type Event as NostrEvent } from 'nostr-tools'
import * as nip46 from 'nostr-tools/nip46'
import * as nip49 from 'nostr-tools/nip49'

export type SignerKind = 'local' | 'nip07' | 'nip46'

export interface Signer {
  kind: SignerKind
  pubkey: string
  /** Present only for a local key: what an export encrypts, and nothing else reads. */
  secretKey?: Uint8Array
  signEvent: (template: EventTemplate) => Promise<NostrEvent>
}

interface Nip07 {
  getPublicKey: () => Promise<string>
  signEvent: (e: EventTemplate) => Promise<NostrEvent>
}

/** Whether a browser extension is offering to sign. */
export function hasNip07(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { nostr?: Nip07 }).nostr
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
  try { decoded = nip19.decode(nsec.trim()) } catch { throw new Error('That is not a valid nsec.') }
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
  const ext = (window as unknown as { nostr?: Nip07 }).nostr
  if (!ext) throw new Error('No nostr extension found in this browser.')
  const pubkey = await ext.getPublicKey()
  return { kind: 'nip07', pubkey, signEvent: (t) => ext.signEvent(t) }
}

/** A remote bunker over NIP-46: the key is on another machine entirely. */
export async function nip46Signer(uri: string): Promise<Signer> {
  const pointer = await nip46.parseBunkerInput(uri.trim())
  if (!pointer) throw new Error('That is not a bunker:// URI or a NIP-05 that points at one.')
  // A throwaway key for the conversation with the bunker; it signs nothing of
  // yours, it is only how this app is recognised across the relay.
  const client = generateSecretKey()
  const bunker = nip46.BunkerSigner.fromBunker(client, pointer)
  await bunker.connect()
  const pubkey = await bunker.getPublicKey()
  return { kind: 'nip46', pubkey, signEvent: (t) => bunker.signEvent(t) as Promise<NostrEvent> }
}

const SK = 'snocrash:sk'
const PREF = 'snocrash:signer'

/** Keep a local key across reloads, which is the only key this app ever holds. */
export function saveLocal(sk: Uint8Array): void {
  try {
    localStorage.setItem(SK, [...sk].map((b) => b.toString(16).padStart(2, '0')).join(''))
    localStorage.setItem(PREF, 'local')
  } catch { /* private mode: the key lives for this tab only */ }
}

export function loadLocal(): Uint8Array | null {
  try {
    const hex = localStorage.getItem(SK)
    if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null
    return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))
  } catch { return null }
}

/** Which kind signed last, so a reload can offer the same one without prompting. */
export function savePref(kind: SignerKind | null): void {
  try { if (kind) localStorage.setItem(PREF, kind); else localStorage.removeItem(PREF) } catch { /* ignore */ }
}

export function loadPref(): SignerKind | null {
  try {
    const v = localStorage.getItem(PREF)
    return v === 'local' || v === 'nip07' || v === 'nip46' ? v : null
  } catch { return null }
}

/** Forget the key this browser holds. */
export function forgetLocal(): void {
  try { localStorage.removeItem(SK); localStorage.removeItem(PREF) } catch { /* ignore */ }
}
