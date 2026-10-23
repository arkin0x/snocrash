/**
 * constrain.test.ts - the workshop's CONSTRAIN MOVEMENT IN WALK MODE
 * (DECK-0003 §1.12; arkinox, 2026-10-23: "ALL shards should publish with the
 * OPAQUE option on by default"): a shard that never chose shows and publishes
 * OPAQUE, OFF is written as "off" so it survives, an explicit word is kept,
 * and a walker still reads absent and "off" as off.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { PAYLOAD_FIELDS, fromPayload, newShard, normalizeStored, toPayload, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from './useWorkshop'
import { objectTemplate } from './useNostr'
import { shardFingerprint } from '../lib/published'
import { CONSTRAIN_DEFAULT, authoredConstrain, authoredConstrainOf, constrainOf, readConstrain, withAuthoredConstrain, withConstrain } from '../lib/walkConstrain'

const w = () => useWorkshop.getState()
const cur = () => w().current() as ShardModel
const wire = (s: ShardModel) => JSON.parse(objectTemplate(s, 1).content) as { constrain?: unknown }

beforeEach(() => {
  const s: ShardModel = { ...newShard('Wall'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], selection: [], partSel: [], viewing: null })
})

describe('the field', () => {
  it('a walker reads all and opaque exactly, and everything else, off and absent included, as off', () => {
    expect(readConstrain('all')).toBe('all')
    expect(readConstrain('opaque')).toBe('opaque')
    for (const v of [undefined, null, 'off', 'OFF', 'ALL', ' all', 1, true, [], {}]) expect(readConstrain(v)).toBe('off')
  })

  it('the workshop reads the three words exactly, and everything else, absent included, as the default OPAQUE', () => {
    expect(CONSTRAIN_DEFAULT).toBe('opaque')
    for (const v of ['all', 'opaque', 'off'] as const) expect(authoredConstrain(v)).toBe(v)
    for (const v of [undefined, null, 'OFF', 'ALL', 'Opaque', ' all', '', 'none', 1, true, false, [], {}]) expect(authoredConstrain(v)).toBe('opaque')
  })

  it('is a field sno-core does not know yet: the day it learns it, this fails and the writer here must follow', () => {
    expect(PAYLOAD_FIELDS as readonly string[]).not.toContain('constrain')
  })

  it('"off" rides through sno-core as a field it does not know: payload, read back, stored', () => {
    const s = withConstrain(cur(), 'off')
    const out = JSON.parse(JSON.stringify(toPayload(s)))
    expect(out.constrain).toBe('off')
    const back = fromPayload(out, 'x')!
    expect(authoredConstrainOf(back)).toBe('off')
    expect(constrainOf(back)).toBe('off')
    expect(authoredConstrainOf(normalizeStored(JSON.parse(JSON.stringify(back))))).toBe('off')
  })
})

describe('the workshop', () => {
  it('a new shard is OPAQUE', () => {
    w().create('Fresh')
    expect(cur().name).toBe('Fresh')
    expect(authoredConstrainOf(cur())).toBe('opaque')
    expect(wire(cur()).constrain).toBe('opaque')
  })

  it('sets it undoably; OFF writes "off"; the same setting again is no edit', () => {
    // OPAQUE on a shard that never chose is what it already shows and publishes.
    w().setConstrain('opaque')
    expect(w().past).toHaveLength(0)
    expect(cur()).not.toHaveProperty('extra')
    w().setConstrain('all')
    expect(cur().extra).toEqual({ constrain: 'all' })
    w().undo()
    expect(cur()).not.toHaveProperty('extra')
    w().setConstrain('off')
    expect(cur().extra).toEqual({ constrain: 'off' })
    const past = w().past.length
    w().setConstrain('off')
    expect(w().past.length).toBe(past)
  })

  it('the row lights the setting a shard publishes as: OPAQUE for one that never chose', () => {
    const src = readFileSync(join(__dirname, '..', 'ui', 'Workshop.tsx'), 'utf8')
    const at = src.indexOf('CONSTRAIN MOVEMENT IN WALK MODE</span>')
    expect(at).toBeGreaterThan(-1)
    const row = src.slice(at, src.indexOf('</div>', at))
    expect(row).toContain('authoredConstrainOf(shard) === c')
    expect(row).toContain('w().setConstrain(c)')
  })
})

describe('what is published', () => {
  it('a shard that never chose publishes "opaque", and the bench keeps no field', () => {
    expect(wire(cur()).constrain).toBe('opaque')
    expect(cur()).not.toHaveProperty('extra')
  })

  it('an import without the field publishes "opaque"; one with a word keeps it', () => {
    const bare = JSON.stringify(toPayload(cur()))
    const id = w().importText(bare)
    expect(id).toBeTruthy()
    expect(wire(cur()).constrain).toBe('opaque')
    w().importText(JSON.stringify({ ...JSON.parse(bare), constrain: 'off' }))
    expect(wire(cur()).constrain).toBe('off')
    w().importText(JSON.stringify({ ...JSON.parse(bare), constrain: 'all' }))
    expect(wire(cur()).constrain).toBe('all')
  })

  it('an explicit OFF publishes "off", and a walker reads it as off', () => {
    w().setConstrain('off')
    expect(wire(cur()).constrain).toBe('off')
    expect(constrainOf(fromPayload(wire(cur()), 'x')!)).toBe('off')
  })

  it('explicit ALL and OPAQUE publish unchanged, the same object', () => {
    for (const c of ['all', 'opaque'] as const) {
      const s = withConstrain(cur(), c)
      expect(withAuthoredConstrain(s)).toBe(s)
      expect(wire(s).constrain).toBe(c)
    }
  })

  it('a malformed value publishes as the default', () => {
    const odd: ShardModel = { ...cur(), extra: { constrain: 'ALL', future: 7 } }
    expect(authoredConstrainOf(odd)).toBe('opaque')
    expect(JSON.parse(objectTemplate(odd, 1).content)).toMatchObject({ constrain: 'opaque', future: 7 })
  })

  it('the publish fingerprint is of what goes out, so an unset shard and the same one set to OPAQUE are the same object', () => {
    expect(shardFingerprint(cur())).toBe(shardFingerprint(withConstrain(cur(), 'opaque')))
    expect(shardFingerprint(cur())).not.toBe(shardFingerprint(withConstrain(cur(), 'off')))
  })
})
