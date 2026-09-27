/**
 * colorTools.test.ts - the dropper, the recent row, and the clipboard keys
 * ported from ONOSENDAI (arkinox, 2026-09-27).
 *
 * The dropper takes the one selected point's color, or a selected face's as
 * the average of its corners, snapped onto the object's palette, into hand and
 * onto the front of the recent row. The recent row holds only colors somebody
 * picked: it starts empty, and the starter swatches older builds seeded are
 * dropped unless they were picked. COPY holds the selection without moving it
 * and CLEAR CLIPBOARD lets it go.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { hexToRgb, newShard, rgbToHex, type ShardModel } from 'sno-core/shards'
import { BUILT_IN, hexAt, snapHex } from 'sno-core/snoPalette'
import { DEFAULT_PALETTE, unseeded, useWorkshop } from './useWorkshop'

const w = () => useWorkshop.getState()
const RED = hexAt(BUILT_IN, 238)
const BLUE = hexAt(BUILT_IN, 239)
const WHITE = hexAt(BUILT_IN, 225)

function bench(): ShardModel {
  const s: ShardModel = {
    ...newShard('Tri'),
    vertices: [
      { p: [0, 0, 0], c: hexToRgb(RED) },
      { p: [1, 0, 0], c: hexToRgb(BLUE) },
      { p: [0, 1, 0], c: hexToRgb(WHITE) },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [s], currentId: s.id, selection: [], partSel: [], selectedFace: null, palette: [], clip: null, color: [0, 0.9, 1] })
  return s
}

beforeEach(() => { bench() })

describe('the dropper', () => {
  it('takes the one selected point\'s color into hand and onto the front of the recent row', () => {
    useWorkshop.setState({ selection: [1] })
    w().sampleColor()
    expect(rgbToHex(w().color)).toBe(BLUE)
    expect(w().palette[0]).toBe(BLUE)
  })

  it('takes a selected face\'s color as the average of its corners, snapped onto the palette', () => {
    useWorkshop.setState({ selectedFace: 0 })
    w().sampleColor()
    const cs = [RED, BLUE, WHITE].map(hexToRgb)
    const mean = [0, 1, 2].map((k) => (cs[0][k] + cs[1][k] + cs[2][k]) / 3) as [number, number, number]
    const want = snapHex(BUILT_IN, rgbToHex(mean))!
    expect(rgbToHex(w().color)).toBe(want)
    expect(w().palette).toEqual([want])
  })

  it('does nothing with several points, or none, in hand, and paints nothing ever', () => {
    const before = w().current()!.vertices
    useWorkshop.setState({ selection: [0, 1] })
    w().sampleColor()
    useWorkshop.setState({ selection: [] })
    w().sampleColor()
    expect(w().palette).toEqual([])
    expect(w().current()!.vertices).toBe(before)
  })
})

describe('the recent row', () => {
  it('drops the old starter swatches nobody picked, and keeps what was picked', () => {
    expect(unseeded([...DEFAULT_PALETTE])).toEqual([])
    // A picked color goes to the front; the seeds behind it were never picked.
    expect(unseeded(['#123456', ...DEFAULT_PALETTE])).toEqual(['#123456'])
    // A seed that was picked moved to the front, so it stays; the rest go.
    const picked = DEFAULT_PALETTE[3]
    expect(unseeded([picked, ...DEFAULT_PALETTE.filter((h) => h !== picked)])).toEqual([picked])
    // A list that never had the seeds is untouched.
    expect(unseeded(['#123456', '#abcdef'])).toEqual(['#123456', '#abcdef'])
  })
})

describe('COPY and CLEAR CLIPBOARD', () => {
  it('COPY holds the selection and leaves it where it is; CLEAR lets it go', () => {
    const before = w().current()!.vertices
    useWorkshop.setState({ selection: [0, 1] })
    w().copySelection()
    expect(w().clip?.points).toHaveLength(2)
    expect(w().current()!.vertices).toBe(before)
    w().clearClip()
    expect(w().clip).toBeNull()
  })
})
