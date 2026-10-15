/**
 * viewingEdits.test.ts - an object opened from the feed is built on only
 * after it is adopted (review of parity #33, 2026-10-15).
 *
 * The feed's copy of an object carries the feed's id (pubkey:d), not the id
 * it is stored under. Actions that worked out their result from current()
 * while viewing, then handed it to edit(), stored that copy under the wrong
 * id: on someone else's object the bench went empty and later taps did
 * nothing; on your own object with an unpublished local edit, the edit was
 * replaced by the relay's version. Every edit is now computed on the stored
 * shard, and edit() refuses a result whose id is not the stored shard's.
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

import { TICKS_PER_UNIT as T, fromPayload, newShard, ticksOf, type ShardModel } from 'sno-core/shards'
import { DEFAULT_PALETTE, useWorkshop } from './useWorkshop'
import { useNostr } from './useNostr'

const w = () => useWorkshop.getState()
const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)

/** A one-unit square on the floor, as two triangles, plus a point stacked on corner 0. */
const SQUARE = { v: 1, name: 'square', unit: 0, extent: 8, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]], colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], faces: [[0, 1, 2], [0, 2, 3]] }

/** The feed's copy of an object: the payload read back, under the feed's own id. */
function feedCopy(pubkey: string, d: string, payload: object = SQUARE): ShardModel {
  return fromPayload(payload, `${pubkey}:${d}`)!
}

function reset(): void {
  useNostr.setState({ pubkey: ME } as never)
  useWorkshop.setState({
    shards: [], currentId: null, viewing: null, address: null, aimKey: null,
    selection: [], partSel: [], selectedFace: null, facePick: [], invert: false,
    palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [],
    aim: null, notice: null, tool: 'stamp', stampKind: 'block', stampSize: 1, stampFacing: 0,
    stampMode: 'shape', stampObject: null, clip: null,
  })
}

/** Your own object, stored under its d, with an unpublished local edit (a sixth point), then opened from the feed as the relay has it. */
function ownWithLocalEdit(): { d: string; points: number } {
  const id = w().importText(JSON.stringify(SQUARE))!
  w().select(id)
  w().setTool('add')
  w().addVertex([3 * T, 0, 3 * T])
  const points = w().current()!.vertices.length
  expect(points).toBe(6)
  w().view(feedCopy(ME, id), { d: id, own: true, address: `naddr-${id}` })
  expect(w().current()!.vertices).toHaveLength(5)
  return { d: id, points }
}

/** Every action below must leave your object stored once, under its own id, with the local edit, and on the bench. */
function expectKept(d: string, before: number): ShardModel {
  expect(w().viewing).toBeNull()
  expect(w().currentId).toBe(d)
  expect(w().shards.filter((s) => s.id === d)).toHaveLength(1)
  expect(w().shards.some((s) => s.id.includes(':'))).toBe(false)
  const s = w().current()!
  expect(s.id).toBe(d)
  expect(s.vertices.map((v) => ticksOf(v))).toContainEqual([3 * T, 0, 3 * T])
  expect(s.vertices.length).toBeGreaterThanOrEqual(before - 1)
  return s
}

describe('editing an object opened from the feed', () => {
  beforeEach(reset)

  describe('your own, with an unpublished local edit', () => {
    it('STAMP lands on your stored object, and undo takes only the stamp back', () => {
      const { d, points } = ownWithLocalEdit()
      w().setTool('stamp')
      w().placeStamp([4 * T, 0, 0])
      const s = expectKept(d, points)
      expect(s.vertices.length).toBe(points + 8)
      w().undo()
      expect(w().current()!.vertices).toHaveLength(points)
      expect(w().current()!.id).toBe(d)
    })

    it('placing an object lands on your stored object', () => {
      const { d, points } = ownWithLocalEdit()
      w().setStampObject({ ref: ['a', `33331:${THEM}:column`], name: 'column', shard: newShard('column') })
      w().placeObject([2 * T, 0, 2 * T])
      const s = expectKept(d, points)
      expect(s.parts).toHaveLength(1)
    })

    it('WELD lands on your stored object', () => {
      const { d, points } = ownWithLocalEdit()
      w().weld()
      const s = expectKept(d, points)
      expect(s.vertices).toHaveLength(points - 1)
    })

    it('SUBDIVIDE lands on your stored object', () => {
      const { d, points } = ownWithLocalEdit()
      w().setSelection([0, 1, 2])
      w().subdivideSelection()
      const s = expectKept(d, points)
      expect(s.faces.length).toBeGreaterThan(2)
    })

    it('placing yourself is refused against your own address while viewing', () => {
      const { d } = ownWithLocalEdit()
      w().setStampObject({ ref: ['a', `33331:${ME}:${d}`], name: 'me', shard: newShard('me') })
      w().placeObject([2 * T, 0, 2 * T])
      expect(w().notice).toBe('An object cannot place itself.')
      expect(w().current()!.parts ?? []).toHaveLength(0)
    })
  })

  describe("someone else's", () => {
    it('STAMP adopts a copy under a new id of your own, and the bench stays live', () => {
      w().view(feedCopy(THEM, 'theirs'), { d: 'theirs', own: false, address: 'naddr-theirs' })
      w().placeStamp([4 * T, 0, 0])
      expect(w().viewing).toBeNull()
      const s = w().current()!
      expect(s).not.toBeNull()
      expect(s.id).not.toContain(':')
      expect(w().shards.map((x) => x.id)).toEqual([s.id])
      expect(s.vertices).toHaveLength(5 + 8)
      // A later tap still reaches it.
      w().setTool('select')
      w().selectVertex(0)
      expect(w().selection.length).toBeGreaterThan(0)
    })

    it('WELD and SUBDIVIDE adopt too', () => {
      w().view(feedCopy(THEM, 'theirs'), { d: 'theirs', own: false, address: 'naddr-theirs' })
      w().weld()
      expect(w().viewing).toBeNull()
      expect(w().current()!.vertices).toHaveLength(4)
      w().setSelection([0, 1, 2])
      w().subdivideSelection()
      expect(w().shards).toHaveLength(1)
      expect(w().current()!.id).not.toContain(':')
    })
  })

  it('edit() refuses a result that is a different shard, loudly in development, and keeps the stored one', () => {
    const id = w().importText(JSON.stringify(SQUARE))!
    w().select(id)
    const stored = w().current()!
    // The old bug, recreated: an action reads a shard that is not the stored
    // one (as current() was while viewing) and builds its result from it.
    const stranger = { ...stored, id: `${THEM}:theirs` }
    const realCurrent = w().current
    useWorkshop.setState({ current: () => stranger })
    try {
      expect(() => w().weld()).toThrow(/edit refused/)
    } finally {
      useWorkshop.setState({ current: realCurrent })
    }
    expect(w().shards.map((x) => x.id)).toEqual([id])
    expect(w().current()!.vertices).toHaveLength(stored.vertices.length)
  })
})
