/**
 * copiesTable.test.ts - a copy made yours keeps a carried table (DECK-0003
 * §1.10) only when you signed the event it came from (review of #47, as
 * ONOSENDAI's copies do). REMIX (importShard), a first edit of someone's
 * viewed object (adopt) and a paste (importText) each drop the publisher's
 * `author` and any table you did not sign, so the bench draws what every
 * reader of your published copy will draw, and nothing it will not.
 */
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

import { objectFromEvent } from 'sno-core/feed'
import { resolveParts } from 'sno-core/parts'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { DEFAULT_PALETTE, asYours, useWorkshop } from './useWorkshop'
import { useNostr } from './useNostr'

const w = () => useWorkshop.getState()
const ME = 'c'.repeat(64)
const THEM = 'a'.repeat(64)
const TRI = { v: 2, name: 'Tri', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], colors: [238, 238, 238], faces: [[0, 1, 2]] }

/** A kit by `pk` that carries the piece it places, as the feed reads it from `pk`'s event. */
function kitBy(pk: string): ShardModel {
  const piece = `33331:${pk}:unpublished-piece`
  const payload = { ...TRI, name: 'Kit', refs: [['a', piece]], parts: [[0, 0, 0, 0, 0, 0, 0, 0]], objects: { [piece]: TRI } }
  return objectFromEvent({ id: '1'.repeat(64), pubkey: pk, created_at: 1, kind: 33331, tags: [['d', 'kit']], content: JSON.stringify(payload) })!.shard
}

/** What the bench draws of `s` for you, as Bench.tsx asks (self and author said). */
async function benchDraws(s: ShardModel): Promise<boolean> {
  const placed = await resolveParts(s, async () => null, { self: ['a', `33331:${ME}:${s.id}`], author: s.author ?? ME })
  return !!placed[0]?.model
}

beforeEach(() => {
  useNostr.setState({ pubkey: ME } as never)
  useWorkshop.setState({
    shards: [], currentId: null, viewing: null, address: null, aimKey: null,
    selection: [], partSel: [], selectedFace: null, facePick: [], invert: false,
    palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [],
    aim: null, notice: null, tool: 'select', stampKind: 'block', stampSize: 1, stampFacing: 0,
    stampMode: 'shape', stampObject: null, clip: null,
  })
})

describe('a copy made yours keeps only a table you signed', () => {
  it("REMIX of someone's object drops their author and table: the bench draws what your readers will", async () => {
    const theirs = kitBy(THEM)
    expect(theirs.author).toBe(THEM)
    expect(Object.keys(theirs.objects ?? {})).toHaveLength(1)
    const id = w().importShard(theirs)
    const copy = w().shards.find((s) => s.id === id)!
    expect(copy.author).toBeUndefined()
    expect(copy.objects).toBeUndefined()
    expect('objects' in toPayload(copy)).toBe(false)
    // Their piece is not carried by you: drawn as a placeholder here, as everywhere.
    expect(await benchDraws(copy)).toBe(false)
  })

  it('REMIX of your own published object keeps the table you signed', async () => {
    const id = w().importShard(kitBy(ME))
    const copy = w().shards.find((s) => s.id === id)!
    expect(copy.author).toBeUndefined()
    expect(Object.keys(copy.objects ?? {})).toHaveLength(1)
    expect(await benchDraws(copy)).toBe(true)
  })

  it("a first edit of someone's object you were viewing (adopt) drops their table too", () => {
    const theirs = kitBy(THEM)
    w().view(theirs, { d: 'kit', own: false, address: 'naddr-kit' })
    const adopted = w().adopt()!
    expect(adopted.author).toBeUndefined()
    expect(adopted.objects).toBeUndefined()
  })

  it('a paste is signed by nobody: no table of it counts, whoever its keys name', () => {
    const piece = `33331:${ME}:mine`
    const id = w().importText(JSON.stringify({ ...TRI, name: 'Pasted', refs: [['a', piece]], parts: [[0, 0, 0, 0, 0, 0, 0, 0]], objects: { [piece]: TRI } }))!
    const s = w().shards.find((x) => x.id === id)!
    expect(s.objects).toBeUndefined()
    expect(s.parts).toHaveLength(1)
  })

  it('asYours keeps everything else as it was', () => {
    const theirs = kitBy(THEM)
    const { author: _a, objects: _o, ...rest } = theirs
    expect(asYours(theirs, false)).toEqual(rest)
  })
})
