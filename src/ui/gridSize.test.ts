/**
 * GRID SIZE's stepper (gridSize.ts): ones to 64 as it always was, then
 * sixteenths of each doubling to MAX_EXTENT, 4,096 since 2026-11-23
 * (DECK-0003 §1.8), as ONOSENDAI's stepper does.
 */
import { describe, expect, it } from 'vitest'
import { MAX_EXTENT, MIN_EXTENT } from 'sno-core/shards'
import { stepExtent } from './gridSize'

describe('stepExtent', () => {
  it('counts in ones up to 64, exactly as before', () => {
    for (let e = MIN_EXTENT; e < 64; e++) {
      expect(stepExtent(e, 1)).toBe(e + 1)
      expect(stepExtent(e + 1, -1)).toBe(e)
    }
  })

  it('past 64 counts in sixteenths of the current power of two', () => {
    expect(stepExtent(64, 1)).toBe(68)
    expect(stepExtent(124, 1)).toBe(128)
    expect(stepExtent(128, 1)).toBe(136)
    expect(stepExtent(2048, 1)).toBe(2176)
    expect(stepExtent(3968, 1)).toBe(4096)
  })

  it('going down takes the step of the stop below', () => {
    expect(stepExtent(68, -1)).toBe(64)
    expect(stepExtent(65, -1)).toBe(64)
    expect(stepExtent(128, -1)).toBe(124)
    expect(stepExtent(4096, -1)).toBe(3968)
  })

  it('a size off the stops goes to the next stop in the direction asked', () => {
    expect(stepExtent(70, 1)).toBe(72)
    expect(stepExtent(70, -1)).toBe(68)
    expect(stepExtent(130, 1)).toBe(136)
    expect(stepExtent(130, -1)).toBe(128)
  })

  it('holds at the ends', () => {
    expect(MAX_EXTENT).toBe(4096)
    expect(stepExtent(MAX_EXTENT, 1)).toBe(MAX_EXTENT)
    expect(stepExtent(MIN_EXTENT, -1)).toBe(MIN_EXTENT)
  })

  it('walks from 64 to the top in a few hundred presses, every stop a round number, and back down the same stops', () => {
    const up: number[] = [64]
    while (up[up.length - 1] < MAX_EXTENT) up.push(stepExtent(up[up.length - 1], 1))
    expect(up.length - 1).toBe(96)
    for (const e of up) expect(Number.isInteger(e)).toBe(true)
    const down: number[] = [MAX_EXTENT]
    while (down[down.length - 1] > 64) down.push(stepExtent(down[down.length - 1], -1))
    expect(down.reverse()).toEqual(up)
  })
})
