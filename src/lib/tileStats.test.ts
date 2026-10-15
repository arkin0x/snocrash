import { describe, expect, it } from 'vitest'
import { tileStats } from './tileStats'

describe('the stats line under a tile title', () => {
  it('names vertices, faces, mode and scale', () => {
    expect(tileStats({ vertices: [{}, {}, {}] as never, faces: [[0, 1, 2]], mode: 'solid', unit: 0 })).toBe('3 v · 1 f · SOLID · unit 2^0')
  })
  it('counts placed objects when there are any', () => {
    expect(tileStats({ vertices: [] as never, faces: [], parts: [{}, {}] as never, mode: 'lines', unit: 4 })).toBe('0 v · 0 f · 2 obj · LINES · unit 2^4')
  })
})
