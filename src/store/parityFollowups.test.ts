/**
 * parityFollowups.test.ts - the non-blocking findings from the reviews of
 * parity #33 (2026-10-15), each pinned: the unit and grid steps, no-op edits,
 * the turn pivot's key, IMPORT's sizes, a no-op rename, a face colored the
 * color it has, and the credit an edited feed object keeps.
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

import { creditOf } from 'sno-core/feed'
import { fromPayload, hexToRgb, rgbToHex, type ShardModel } from 'sno-core/shards'
import { BUILT_IN, snapHex } from 'sno-core/snoPalette'
import { DEFAULT_PALETTE, useWorkshop } from './useWorkshop'
import { useNostr } from './useNostr'
import WORKSHOP from '../ui/Workshop.tsx?raw'

const w = () => useWorkshop.getState()
const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)

/** A one-unit square on the floor, as two triangles. */
const SQUARE = { v: 1, name: 'square', unit: 0, extent: 8, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], faces: [[0, 1, 2], [0, 2, 3]] }

/** The feed's copy of an object: the payload read back, under the feed's own id. */
function feedCopy(pubkey: string, d: string, payload: object = SQUARE): ShardModel {
  return fromPayload(payload, `${pubkey}:${d}`)!
}

/** Your own object stored as `local`, then opened from the feed as the relay has it (`relay`). */
function ownOpened(local: object, relay: object = SQUARE): string {
  const id = w().importText(JSON.stringify(local))!
  w().select(id)
  w().view(feedCopy(ME, id, relay), { d: id, own: true, address: `naddr-${id}` })
  return id
}

const CREDIT = { address: `33331:${THEM}:theirs`, relay: 'wss://relay.example' }
const openTheirs = (payload: object = SQUARE): void => {
  w().view(feedCopy(THEM, 'theirs', payload), { d: 'theirs', own: false, address: 'naddr-theirs', credit: CREDIT })
}

beforeEach(() => {
  useNostr.setState({ pubkey: ME } as never)
  useWorkshop.setState({
    shards: [], currentId: null, viewing: null, address: null, aimKey: null,
    selection: [], partSel: [], selectedFace: null, facePick: [], invert: false, turnPivot: null,
    palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [],
    aim: null, notice: null, tool: 'select', clip: null,
  })
})

describe('the unit and grid − and + step the shard the edit lands on (1)', () => {
  it('a step of unit counts from your stored object, not the relay copy on view', () => {
    // Stored at unit 1 (an unpublished edit); the relay still says 0.
    const id = ownOpened({ ...SQUARE, unit: 1 })
    expect(w().current()!.unit).toBe(0)
    w().stepUnit(1)
    expect(w().current()!.id).toBe(id)
    expect(w().current()!.unit).toBe(2)
    w().stepUnit(-1)
    expect(w().current()!.unit).toBe(1)
  })

  it('a step of grid counts from your stored object, and stops at what the points need', () => {
    ownOpened({ ...SQUARE, extent: 12 })
    w().stepExtent(1)
    expect(w().current()!.extent).toBe(13)
    useWorkshop.setState({ past: [] })
    // Down to the floor the points allow, and no further, with no step stored past it.
    for (let i = 0; i < 40; i++) w().stepExtent(-1)
    const floor = w().current()!.extent
    const steps = w().past.length
    w().stepExtent(-1)
    expect(w().current()!.extent).toBe(floor)
    expect(w().past).toHaveLength(steps)
  })

  it("on someone else's object, a step adopts it once; a step that changes nothing adopts nothing", () => {
    openTheirs({ ...SQUARE, unit: 0 })
    w().stepUnit(-1)
    expect(w().shards).toHaveLength(0)
    w().stepUnit(1)
    expect(w().shards).toHaveLength(1)
    expect(w().current()!.unit).toBe(1)
  })

  it('the workshop buttons step, rather than send a size read off the copy on view', () => {
    expect(WORKSHOP).toMatch(/w\(\)\.stepUnit\(-1\)/)
    expect(WORKSHOP).toMatch(/w\(\)\.stepUnit\(1\)/)
    expect(WORKSHOP).toMatch(/w\(\)\.stepExtent\(-1\)/)
    expect(WORKSHOP).toMatch(/w\(\)\.stepExtent\(1\)/)
    expect(WORKSHOP).not.toMatch(/setUnit\(\(w\(\)\.current\(\)/)
    expect(WORKSHOP).not.toMatch(/setExtent\(\(w\(\)\.current\(\)/)
  })

  it('the steppers show and stop at the sizes of the shard they change (review of #35)', () => {
    expect(WORKSHOP).toMatch(/const held = useWorkshop\(\(s\) => s\.target\(\)\)/)
    expect(WORKSHOP).toMatch(/const extent = held\?\.extent/)
    expect(WORKSHOP).toMatch(/neededExtent\(held\)/)
    expect(WORKSHOP).toMatch(/disabled=\{unit <= 0\} aria-label="Smaller unit"/)
    expect(WORKSHOP).toMatch(/<span className="workshop__value">\{unit\}<\/span>/)
    // The info line and the LEVEL stack's edge read the same shard (review of #35).
    expect(WORKSHOP).toMatch(/unit 2\^\{unit\} = \{formatCellSize\(unit\)\}/)
    expect(WORKSHOP).toMatch(/const extentTicks = useWorkshop\(\(s\) => \(s\.target\(\)\?\.extent/)
    expect(WORKSHOP).not.toMatch(/s\.current\(\)\?\.extent/)
  })
})

describe('a no-op on the stored shard is not a step (2)', () => {
  it('a change to the relay copy that your stored object already has adds no undo entry', () => {
    // The relay says unit 0, your stored object is already at 1: setting 1 changes the view, not the object.
    const id = ownOpened({ ...SQUARE, unit: 1 })
    w().setUnit(1)
    expect(w().current()!.id).toBe(id)
    expect(w().past).toHaveLength(0)
  })

  it('a turn that moves points on the relay copy but none on your stored object adds no undo entry', () => {
    // Stored: corners 0 and 1 stacked on one spot, so a turn of the two about their middle moves nothing.
    const stacked = { ...SQUARE, vertices: [[0, 0, 0], [0, 0, 0], [1, 0, 1], [0, 0, 1]] }
    ownOpened(stacked)
    w().setSelection([0, 1])
    w().rotateSelected(1)
    expect(w().past).toHaveLength(0)
    expect(w().current()!.vertices[1].p).toEqual([0, 0, 0])
  })
})

describe('the turn pivot belongs to one shard (3)', () => {
  it("its key names the shard, so another object's same indices start a pivot of their own", () => {
    const a = w().importText(JSON.stringify(SQUARE))!
    w().select(a)
    w().setSelection([1, 2])
    w().rotateSelected(1)
    expect(w().turnPivot!.key.startsWith(`${a}:`)).toBe(true)
    // Another object, reached without select() (as importText, create and
    // duplicate did), with points elsewhere under the same indices.
    const far = { ...SQUARE, name: 'far', vertices: [[0, 0, 0], [5, 0, 0], [5, 0, 5], [0, 0, 5]] }
    const b = w().importText(JSON.stringify(far))!
    const stale = w().turnPivot
    useWorkshop.setState({ currentId: b, selection: [1, 2], turnPivot: stale })
    w().rotateSelected(1)
    const withStale = w().current()!.vertices.map((v) => v.p)
    // The same turn from a clean start.
    const c = w().importText(JSON.stringify(far))!
    useWorkshop.setState({ currentId: c, selection: [1, 2], turnPivot: null })
    w().rotateSelected(1)
    expect(withStale).toEqual(w().current()!.vertices.map((v) => v.p))
  })
})

describe('IMPORT sizes from the shard it lands in (4)', () => {
  it('target() is your stored object while its relay copy is on view, and the feed copy otherwise', () => {
    const id = ownOpened({ ...SQUARE, unit: 1, extent: 12 })
    expect(w().current()!.unit).toBe(0)
    expect(w().target()!.id).toBe(id)
    expect(w().target()!.unit).toBe(1)
    expect(w().target()!.extent).toBe(12)
    // Reading it adopts nothing.
    expect(w().viewing).not.toBeNull()
    openTheirs()
    expect(w().target()).toBe(w().viewing!.shard)
  })

  it("the workshop's IMPORT reads its fit, unit and palette from target()", () => {
    const body = WORKSHOP.slice(WORKSHOP.indexOf('const importFromFiles'), WORKSHOP.indexOf('const draggingFiles'))
    expect(body).toMatch(/const s = w\(\)\.target\(\)/)
    expect(body).toMatch(/importFitFor\(s\.extent\), unit: s\.unit, palette: s\.palette/)
  })
})

describe('a rename to the name it has changes nothing (5)', () => {
  it("leaves someone else's object un-adopted", () => {
    openTheirs()
    w().rename(w().current()!.id, 'square')
    expect(w().shards).toHaveLength(0)
    expect(w().viewing).not.toBeNull()
    w().rename(w().current()!.id, 'mine now')
    expect(w().shards).toHaveLength(1)
    expect(w().current()!.name).toBe('mine now')
  })

  it('leaves your stored object untouched, its time included', () => {
    const id = w().importText(JSON.stringify(SQUARE))!
    const before = w().shards.find((s) => s.id === id)!
    w().rename(id, 'square')
    expect(w().shards.find((s) => s.id === id)).toBe(before)
  })
})

describe('a face colored the color it has is a no-op (6)', () => {
  it('adds no undo entry on your object, and adopts nothing on theirs', () => {
    const id = w().importText(JSON.stringify(SQUARE))!
    w().select(id)
    w().colorFace(0, [1, 0, 0])
    expect(w().past).toHaveLength(1)
    w().colorFace(0, [1, 0, 0])
    expect(w().past).toHaveLength(1)
    const colored = toWire(w().current()!)
    openTheirs(colored)
    w().colorFace(0, [1, 0, 0])
    expect(w().shards).toHaveLength(1)
    expect(w().viewing).not.toBeNull()
  })
})

describe('an edited feed object credits its author, as REMIX does (7)', () => {
  it("someone else's object adopted by an edit carries the credit", () => {
    openTheirs()
    w().setMode('points')
    expect(creditOf(w().current()!)).toEqual(CREDIT)
  })

  it('your own object, an original, adopted by an edit carries none', () => {
    w().view(feedCopy(ME, 'mine'), { d: 'mine', own: true, address: 'naddr-mine' })
    w().setMode('points')
    expect(w().current()!.id).toBe('mine')
    expect(creditOf(w().current()!)).toBeUndefined()
  })

  it('your own remix, adopted from the feed in a browser without it, keeps the credit it was published with (review of #35)', () => {
    w().view(feedCopy(ME, 'mine'), { d: 'mine', own: true, address: 'naddr-mine', credit: CREDIT })
    w().setMode('points')
    expect(w().current()!.id).toBe('mine')
    expect(creditOf(w().current()!)).toEqual(CREDIT)
  })

  it("the workshop opens someone else's object with the credit REMIX gives, and your own with its event's credit", () => {
    expect(WORKSHOP).toMatch(/mine \? readCredit\(o\.event\.tags\) \?\? undefined : \{ address: o\.address, relay: o\.seen\?\.\[0\] \}/)
  })

})

describe('a color off the palette painted with its nearest entry lands (review of #35, blocking 1)', () => {
  /** The palette entry the wire would snap a color to. */
  const nearest = (c: [number, number, number]): [number, number, number] => hexToRgb(snapHex(BUILT_IN, rgbToHex(c))!)
  const OFF: [number, number, number] = [0.5, 0.31, 0.77]
  /** A v1 square whose corner 0 is the literal color OFF, which no palette entry is. */
  const V1 = { ...SQUARE, colors: [OFF, [1, 1, 1], [1, 1, 1], [1, 1, 1]] }

  it('a v1 literal color painted with its nearest entry changes the color, with an undo entry', () => {
    const id = w().importText(JSON.stringify(V1))!
    w().select(id)
    const before = w().current()!.vertices[0].c
    expect(before).not.toEqual(nearest(before))
    w().setSelection([0])
    w().colorSelected(nearest(before))
    expect(w().current()!.vertices[0].c).toEqual(nearest(before))
    expect(w().past).toHaveLength(1)
  })

  it('a SUBDIVIDE midpoint painted with its nearest entry lands', () => {
    // Corners of two palette colors far apart, so the midpoint between them is on neither.
    const id = w().importText(JSON.stringify({ ...SQUARE, colors: [[1, 0, 0], [0, 0, 1], [1, 1, 1], [1, 1, 1]] }))!
    w().select(id)
    w().setSelection([0, 1])
    w().subdivideSelection()
    const s = w().current()!
    const mid = s.vertices.length - 1
    const c = s.vertices[mid].c
    expect(c).not.toEqual(nearest(c))
    const steps = w().past.length
    w().setSelection([mid])
    w().colorSelected(nearest(c))
    expect(w().current()!.vertices[mid].c).toEqual(nearest(c))
    expect(w().past).toHaveLength(steps + 1)
  })

  it("on someone else's object, the same paint adopts it and lands", () => {
    openTheirs(V1)
    const before = w().current()!.vertices[0].c
    w().setSelection([0])
    w().colorSelected(nearest(before))
    expect(w().shards).toHaveLength(1)
    expect(w().viewing).toBeNull()
    expect(w().current()!.vertices[0].c).toEqual(nearest(before))
  })
})

/** A shard as the wire has it, for opening it again as a feed copy. */
function toWire(s: ShardModel): object {
  return JSON.parse(w().exportCurrent() ?? JSON.stringify(s))
}
