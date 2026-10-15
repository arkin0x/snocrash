/**
 * selection.test.ts - ported from ONOSENDAI's useWorkshop tests (parity,
 * 2026-10-15): a face picks its corners so the pad moves it, and INVERT
 * makes taps and boxes take away.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TICKS_PER_UNIT as T, ticksOf } from 'sno-core/shards'
import { DEFAULT_PALETTE, nextSelection, useWorkshop } from './useWorkshop'

const w = () => useWorkshop.getState()

/** A square of two triangles, plus a fifth vertex standing on vertex 0's point (a stamp's own corner). */
const QUAD = JSON.stringify({ v: 1, type: 'shard', name: 'q', unit: 0, extent: 15, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]], ticks: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], faces: [[0, 1, 2], [0, 2, 3]] })

describe('a face picks its corners', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], selectedFace: null, facePick: [], palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [], aim: null, notice: null, tool: 'stamp', stampKind: 'block', stampSize: 1, stampFacing: 0 })
    w().create('t')
  })

  it('selecting a face selects its corners, every vertex on their points, and selecting it again lets them go (2026-10-10)', () => {
    const id = w().importText(QUAD)
    expect(id).not.toBeNull()
    w().select(id!)
    w().selectFace(0)
    // Corners 0, 1, 2, and vertex 4, which stands on corner 0's point.
    expect(w().selection).toEqual([0, 1, 2, 4])
    expect(w().selectedFace).toBe(0)
    // The second face adds its own corner; the shared ones are already in hand.
    w().selectFace(1)
    expect(w().selection).toEqual([0, 1, 2, 3, 4])
    expect(w().selectedFace).toBe(1)
    // A face whose corners are all in hand is taken back out, and is no longer the selected face.
    w().selectFace(1)
    expect(w().selection).toEqual([1])
    expect(w().selectedFace).toBeNull()
    // Then the pad moves what is selected: the remaining corner, one unit along X.
    w().selectFace(0)
    const before = w().current()!.vertices.map((v) => ticksOf(v))
    w().moveSelected(0, T)
    const after = w().current()!.vertices.map((v) => ticksOf(v))
    for (const i of [0, 1, 2, 4]) expect(after[i][0] - before[i][0]).toBe(T)
    expect(after[3]).toEqual(before[3])
  })

})

describe('selection under INVERT', () => {
  /** Two placed objects and no points of its own, as snocrash builds a wall of columns. */
  const PARTS = JSON.stringify({ v: 2, name: 'wall', unit: 0, extent: 10, mode: 'solid', vertices: [], ticks: [], colors: [], refs: [['a', '33331:e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a:fce13d24']], parts: [[0, 0, 0, 0, 0, 0, 0, 0], [0, 480, 0, 0, 0, 0, 0, 0]], faces: [] })
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFace: null, facePick: [], invert: false, past: [], future: [], aim: null, notice: null, tool: 'select' })
  })
  const open = (payload: string): void => { const id = w().importText(payload); expect(id).not.toBeNull(); w().select(id!) }

  it('nextSelection adds what a box holds, or takes it out under INVERT, sorted and deduped', () => {
    expect(nextSelection([], [3, 1, 3], false)).toEqual([1, 3])
    expect(nextSelection([2, 5], [1, 5], false)).toEqual([1, 2, 5])
    expect(nextSelection([5, 2, 5], [], false)).toEqual([2, 5])
    expect(nextSelection([1, 2, 3, 5], [2, 5, 9], true)).toEqual([1, 3])
    expect(nextSelection([], [1], true)).toEqual([])
    expect(nextSelection([4, 1, 1], [], true)).toEqual([1, 4])
    // Pure: neither argument is touched.
    const base = [3, 1]
    const inside = [2]
    nextSelection(base, inside, false)
    expect(base).toEqual([3, 1])
    expect(inside).toEqual([2])
  })

  it('a point tapped under INVERT comes out whole, and a tap never adds', () => {
    open(QUAD)
    w().setSelection([0, 1, 2, 3])
    expect(w().selection).toEqual([0, 1, 2, 3, 4])
    w().setInvert(true)
    // Vertex 4 stands on vertex 0's point: the whole point goes.
    w().toggleVertex(0)
    expect(w().selection).toEqual([1, 2, 3])
    // Not in hand: left alone, not added.
    w().toggleVertex(0)
    expect(w().selection).toEqual([1, 2, 3])
    w().toggleVertex(4)
    expect(w().selection).toEqual([1, 2, 3])
    // Off INVERT the tap adds again.
    w().setInvert(false)
    w().toggleVertex(0)
    expect(w().selection).toEqual([0, 1, 2, 3, 4])
  })

  it('a face tapped under INVERT loses its corners and selects no face', () => {
    open(QUAD)
    w().setSelection([0, 1, 2, 3])
    w().setInvert(true)
    // Face 1 is corners 0, 2, 3, and vertex 4 on corner 0's point.
    w().selectFace(1)
    expect(w().selection).toEqual([1])
    expect(w().selectedFace).toBeNull()
    // Nothing of it in hand any more: nothing is added, and no face is selected.
    w().selectFace(1)
    expect(w().selection).toEqual([1])
    expect(w().selectedFace).toBeNull()
    // A face only partly in hand still loses what it had.
    w().setInvert(false)
    w().selectFace(0)
    expect(w().selection).toEqual([0, 1, 2, 4])
    expect(w().selectedFace).toBe(0)
    w().setInvert(true)
    w().toggleVertex(1)
    w().selectFace(0)
    expect(w().selection).toEqual([])
    expect(w().selectedFace).toBeNull()
  })

  it('a placed object tapped under INVERT comes out and never goes in', () => {
    open(PARTS)
    w().togglePart(0); w().togglePart(1)
    expect(w().partSel).toEqual([0, 1])
    w().setInvert(true)
    w().togglePart(0)
    expect(w().partSel).toEqual([1])
    w().togglePart(0)
    expect(w().partSel).toEqual([1])
    w().setInvert(false)
    w().togglePart(0)
    expect(w().partSel).toEqual([0, 1])
  })

  it('INVERT goes off with the tool', () => {
    w().setInvert(true)
    expect(w().invert).toBe(true)
    w().setTool('face')
    expect(w().invert).toBe(false)
    w().setInvert(true)
    w().setTool('select')
    expect(w().invert).toBe(false)
    w().setInvert(true)
    w().setTool('view')
    expect(w().invert).toBe(false)
  })
})
