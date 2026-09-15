/**
 * published.ts - which of your objects have been published, and whether the
 * one on the bench is still the one that went out.
 *
 * Nothing on a relay tells you this. An addressable event (kind 33331, keyed
 * by `d`) can be replaced any number of times and carries no memory of what
 * it replaced, so "have I published this, and have I changed it since" is a
 * question only this browser can answer, and only if it wrote the answer down
 * at the time. That is all this module is: a small ledger in localStorage,
 * written when a publish is accepted by at least one relay.
 *
 * Four states, because the honest answer is not two:
 *
 *   never      - no relay has ever been handed this object
 *   published  - it went out, and it matches what went out
 *   edited     - it went out, and it has been changed here since
 *   other-key  - it went out under a key that is not the one signing now,
 *                so publishing it again writes a *different* object rather
 *                than replacing that one (a is kind + pubkey + d, and the
 *                pubkey is half of it)
 *
 * On the fingerprint: it is taken from the payload this app would publish,
 * never from the bytes a relay returns. A payload that goes out and comes
 * back has been through `fromPayload` and `toPayload` again, and the two need
 * only agree on meaning, not on byte order, so comparing against wire text
 * would report edits that never happened. An object learned from the feed
 * rather than published from here therefore gets an empty fingerprint, which
 * reads as "published, and this browser cannot tell you whether it changed" -
 * unknown, and never a guess.
 */

import { toPayload, type ShardModel } from './shards'

const STORAGE = 'snocrash:published'

export type PublishState = 'never' | 'published' | 'edited' | 'other-key'

export interface PublishRecord {
  /** When the relays took it, in seconds, as nostr counts time. */
  at: number
  /** The payload as it went out, or '' when this browser did not send it. */
  fp: string
  /** Who signed it. Half of the object's address, so a change of key matters. */
  pubkey: string
}

export type Ledger = Record<string, PublishRecord>

/**
 * A short, stable hash of the payload: two FNV-1a passes from different
 * offsets, so the result is 64 bits rather than 32 and an accidental collision
 * (which would read as "unchanged" on a changed object) is not a practical
 * worry. It is not a cryptographic hash and nothing here needs one: it is
 * only ever compared against another fingerprint made the same way.
 */
export function fingerprint(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const pass = (offset: number): string => {
    let h = offset >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x7fffffff)
}

export function loadLedger(): Ledger {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Ledger = {}
    for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
      const r = rec as Partial<PublishRecord>
      if (typeof r?.at !== 'number' || typeof r?.pubkey !== 'string') continue
      out[id] = { at: r.at, fp: typeof r.fp === 'string' ? r.fp : '', pubkey: r.pubkey }
    }
    return out
  } catch { return {} }
}

export function saveLedger(ledger: Ledger): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(ledger)) } catch { /* quota or private mode */ }
}

/**
 * Note a publish. Later word wins: republishing is exactly how an addressable
 * object is corrected, so the newest send is the one worth remembering.
 */
export function noteSent(ledger: Ledger, id: string, fp: string, pubkey: string, at: number): Ledger {
  return { ...ledger, [id]: { at, fp, pubkey } }
}

/**
 * Note an object seen on a relay under this key, without claiming to know
 * whether it matches what is on the bench. A real send always outranks this:
 * it carries a fingerprint and this does not, and losing that would turn a
 * known "edited" into an unknowable "published".
 */
export function noteSeen(ledger: Ledger, id: string, pubkey: string, at: number): Ledger {
  const prev = ledger[id]
  if (prev && (prev.fp !== '' || prev.at >= at)) return ledger
  return { ...ledger, [id]: { at, fp: '', pubkey } }
}

/** Where an object stands, given the ledger, its current payload and who signs. */
export function publishState(rec: PublishRecord | undefined, fp: string, pubkey: string | null): PublishState {
  if (!rec) return 'never'
  // A key is only compared when there is one to compare against: signed out,
  // what is known is that it went out, not who would send it next.
  if (pubkey && rec.pubkey !== pubkey) return 'other-key'
  if (rec.fp !== '' && rec.fp !== fp) return 'edited'
  return 'published'
}

/** The short label a list row wears. */
export const STATE_LABEL: Record<PublishState, string> = {
  never: 'DRAFT',
  published: 'PUBLISHED',
  edited: 'EDITED',
  'other-key': 'OTHER KEY',
}

/** Which tag colour a state wears: a draft is quiet, a drift is a warning. */
export const STATE_TAG: Record<PublishState, string> = {
  never: 'tag--local',
  published: 'tag--live',
  edited: 'tag--sending',
  'other-key': 'tag--danger',
}

/** What that label means, spelled out, for the row's tooltip. */
export const STATE_HELP: Record<PublishState, string> = {
  never: 'Never published. It exists in this browser and nowhere else.',
  published: 'Published, and unchanged since. Relays hold this object.',
  edited: 'Published, then edited here. Publish again to replace what is on the relays.',
  'other-key': 'Published under a different key. Publishing now writes a new object rather than replacing that one.',
}

/**
 * The fingerprint of an object as it would go out right now. One definition,
 * used both when a publish is recorded and when a row asks whether it has
 * drifted, so the two can never disagree about what "the same object" means.
 */
export function shardFingerprint(shard: ShardModel): string {
  return fingerprint(JSON.stringify(toPayload(shard)))
}
