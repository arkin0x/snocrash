/**
 * What these prove: the ledger answers "has this been published, and is it
 * still the thing that went out" without asking a relay, it never guesses when
 * it cannot know, and a real send is never overwritten by a weaker sighting.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  STATE_HELP, STATE_LABEL, fingerprint, forget, loadLedger, noteRetracted, noteSeen, noteSent,
  publishState, retractedAt, saveLedger, type Ledger,
} from './published'

const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

describe('fingerprint', () => {
  it('is stable for the same payload and different for a changed one', () => {
    const a = fingerprint({ v: 2, verts: [1, 2, 3] })
    expect(fingerprint({ v: 2, verts: [1, 2, 3] })).toBe(a)
    expect(fingerprint({ v: 2, verts: [1, 2, 4] })).not.toBe(a)
  })

  it('is 64 bits of hex, so a collision reading as "unchanged" is not a worry', () => {
    expect(fingerprint('x')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('notices a one-character change anywhere in a long payload', () => {
    const long = JSON.stringify({ p: Array.from({ length: 500 }, (_, i) => i) })
    expect(fingerprint(long)).not.toBe(fingerprint(long.replace('499', '500')))
  })
})

describe('publishState', () => {
  const rec = { at: 100, fp: 'abc', pubkey: KEY_A }

  it('is never when nothing was ever sent', () => {
    expect(publishState(undefined, 'abc', KEY_A)).toBe('never')
  })

  it('is published when the object matches what went out', () => {
    expect(publishState(rec, 'abc', KEY_A)).toBe('published')
  })

  it('is edited when it has drifted since', () => {
    expect(publishState(rec, 'zzz', KEY_A)).toBe('edited')
  })

  it('is other-key under a different signer, because the key is half the address', () => {
    expect(publishState(rec, 'abc', KEY_B)).toBe('other-key')
    expect(publishState(rec, 'zzz', KEY_B)).toBe('other-key')
  })

  it('does not compare keys when there is nothing to compare against', () => {
    // Signed out, what is known is that it went out, not who would send it next.
    expect(publishState(rec, 'abc', null)).toBe('published')
  })

  it('says published, not edited, when the fingerprint is unknown', () => {
    // A sighting on a relay cannot tell you whether the bench has drifted, and
    // an unknowable answer must never be reported as a known one.
    const seen = { at: 100, fp: '', pubkey: KEY_A }
    expect(publishState(seen, 'anything at all', KEY_A)).toBe('published')
  })

  it('has a label and an explanation for every state', () => {
    for (const s of ['never', 'published', 'edited', 'other-key'] as const) {
      expect(STATE_LABEL[s].length).toBeGreaterThan(3)
      expect(STATE_HELP[s].length).toBeGreaterThan(20)
    }
  })
})

describe('noteSent and noteSeen', () => {
  it('records a send, and a later send replaces it', () => {
    let l: Ledger = {}
    l = noteSent(l, 'obj', 'fp1', KEY_A, 100)
    expect(l.obj).toEqual({ at: 100, fp: 'fp1', pubkey: KEY_A })
    l = noteSent(l, 'obj', 'fp2', KEY_A, 200)
    expect(l.obj.fp).toBe('fp2')
  })

  it('never lets a sighting erase what a send knows', () => {
    // The send carries a fingerprint and the sighting does not: taking the
    // sighting would turn a known "edited" into an unknowable "published".
    const sent = noteSent({}, 'obj', 'fp1', KEY_A, 100)
    expect(noteSeen(sent, 'obj', KEY_A, 900)).toBe(sent)
    expect(publishState(noteSeen(sent, 'obj', KEY_A, 900).obj, 'other', KEY_A)).toBe('edited')
  })

  it('records a sighting when nothing is known, and keeps the newest', () => {
    let l = noteSeen({}, 'obj', KEY_A, 100)
    expect(l.obj).toEqual({ at: 100, fp: '', pubkey: KEY_A })
    l = noteSeen(l, 'obj', KEY_A, 300)
    expect(l.obj.at).toBe(300)
    expect(noteSeen(l, 'obj', KEY_A, 200).obj.at).toBe(300)
  })
})

/** These tests run under node, which has no localStorage; this is one. */
function stubStorage(): void {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
  }
}

describe('the ledger on disk', () => {
  beforeEach(stubStorage)

  it('round-trips', () => {
    const l = noteSent({}, 'obj', 'fp', KEY_A, 7)
    saveLedger(l)
    expect(loadLedger()).toEqual(l)
  })

  it("keeps the event id a retraction names, sent or seen, and reads a record without one as before (review of #36)", () => {
    const l = noteSeen(noteSent({}, 'sent', 'fp', KEY_A, 7, 'e'.repeat(64)), 'seen', KEY_A, 8, 'f'.repeat(64))
    saveLedger({ ...l, old: { at: 1, fp: 'x', pubkey: KEY_A } })
    const back = loadLedger()
    expect(back.sent).toEqual({ at: 7, fp: 'fp', pubkey: KEY_A, id: 'e'.repeat(64) })
    expect(back.seen).toEqual({ at: 8, fp: '', pubkey: KEY_A, id: 'f'.repeat(64) })
    expect(back.old).toEqual({ at: 1, fp: 'x', pubkey: KEY_A })
    expect('id' in back.old).toBe(false)
  })

  it('forgets one object, and leaves the rest', () => {
    const l = noteSent(noteSent({}, 'a', 'fp', KEY_A, 1), 'b', 'fp', KEY_A, 2)
    expect(Object.keys(forget(l, 'a'))).toEqual(['b'])
    expect(forget(l, 'missing')).toBe(l)
  })

  it('is empty rather than broken when what is stored is not a ledger', () => {
    localStorage.setItem('snocrash:published', 'not json')
    expect(loadLedger()).toEqual({})
    localStorage.setItem('snocrash:published', '[1,2,3]')
    expect(loadLedger()).toEqual({})
  })

  it('drops entries that are missing what a state needs', () => {
    localStorage.setItem('snocrash:published', JSON.stringify({
      good: { at: 1, fp: 'x', pubkey: KEY_A },
      noKey: { at: 1, fp: 'x' },
      noTime: { fp: 'x', pubkey: KEY_A },
      noFp: { at: 2, pubkey: KEY_A },
    }))
    const l = loadLedger()
    expect(Object.keys(l).sort()).toEqual(['good', 'noFp'])
    expect(l.noFp.fp).toBe('')
  })
})

describe('when an object was retracted (review of #36)', () => {
  beforeEach(stubStorage)

  it('is remembered after the ledger forgets the object, and only the latest second counts', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(retractedAt('lamp')).toBe(0)
    noteRetracted('lamp', now)
    noteRetracted('lamp', now - 5)
    expect(retractedAt('lamp')).toBe(now)
  })

  it('lets go of retractions a day old when it writes', () => {
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem('snocrash:retracted', JSON.stringify({ stale: now - 2 * 24 * 60 * 60, fresh: now - 60 }))
    noteRetracted('lamp', now)
    expect(retractedAt('stale')).toBe(0)
    expect(retractedAt('fresh')).toBe(now - 60)
    expect(retractedAt('lamp')).toBe(now)
  })
})
