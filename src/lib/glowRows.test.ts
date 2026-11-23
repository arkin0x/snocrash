/** glowRows.test.ts - the steps, labels and greyed states behind POINT SIZE, GLOW, RADIUS and GLOW STRENGTH. */

import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { GLOW_REACH } from 'sno-core/glow'
import { AUTO_POINT_TICKS, FINE_STEPS_UP_TO, PAST_64, clampTicks, glowRowState, meanColor, sizeLabel, stepPointSize, stepStrength, stepTicks, suggestedStyle } from './glowRows'

const base = (over: Partial<ShardModel> = {}): ShardModel => ({ ...newShard('Forest'), ...over })

describe('which rows can be used', () => {
  it('all of them only in POINTS mode, RADIUS and GLOW STRENGTH only with a glow', () => {
    expect(glowRowState(base({ mode: 'points' }))).toEqual({ points: true, glowOn: false })
    expect(glowRowState(base({ mode: 'points', extra: { glow: ['fog', 240, 35] } }))).toEqual({ points: true, glowOn: true })
    for (const mode of ['solid', 'lines'] as const) {
      expect(glowRowState(base({ mode, extra: { glow: ['fog', 240, 35], pointsize: 48 } }))).toEqual({ points: false, glowOn: false })
    }
  })

  it('reads a malformed glow as OFF', () => {
    expect(glowRowState(base({ mode: 'points', extra: { glow: ['smog', 240, 35] } })).glowOn).toBe(false)
    expect(glowRowState(base({ mode: 'points', extra: { glow: ['light', 0, 35] } })).glowOn).toBe(false)
  })
})

describe('the steps', () => {
  it('moves a size in twentieths of a unit, from AUTO at the size points draw at now', () => {
    expect(stepPointSize(undefined, 1)).toBe(AUTO_POINT_TICKS + 6)
    expect(stepPointSize(undefined, -1)).toBe(AUTO_POINT_TICKS - 6)
    expect(stepPointSize(6, -1)).toBe(0)
    expect(stepPointSize(0, -1)).toBe(0)
    expect(stepPointSize(GLOW_REACH, 1)).toBe(GLOW_REACH)
  })

  it('steps in twentieths to 64 units, then doubles to the 4,096-unit bound, so no press jumps from 64 units to 4,096', () => {
    expect(GLOW_REACH).toBe(491520)
    expect(FINE_STEPS_UP_TO).toBe(7680)
    expect(stepTicks(7674, 1, 0)).toBe(7680)
    expect(stepTicks(7680, -1, 0)).toBe(7674)
    // Up from 64 units, one press each: 128, 256 ... 2,048 units, then the bound.
    const up: number[] = []
    for (let v = 7680; v < GLOW_REACH;) { v = stepTicks(v, 1, 0); up.push(v) }
    expect(up).toEqual([15360, 30720, 61440, 122880, 245760, 491520])
    expect([...PAST_64]).toEqual([7680, ...up])
    // And back down the same stops to 64 units, then twentieths again.
    const down: number[] = []
    for (let v = GLOW_REACH; v > 7680;) { v = stepTicks(v, -1, 0); down.push(v) }
    expect(down).toEqual([245760, 122880, 61440, 30720, 15360, 7680])
    // A value between stops goes to the next stop in the direction asked.
    expect(stepTicks(10000, 1, 1)).toBe(15360)
    expect(stepTicks(10000, -1, 1)).toBe(7680)
    expect(stepTicks(GLOW_REACH, 1, 1)).toBe(GLOW_REACH)
  })

  it('takes a size off the steps to the next step in the direction asked', () => {
    expect(stepTicks(50, 1, 0)).toBe(54)
    expect(stepTicks(50, -1, 0)).toBe(48)
    expect(stepTicks(6, -1, 1)).toBe(1)
  })

  it('moves GLOW STRENGTH in fives between 1 and 100', () => {
    expect(stepStrength(40, 1)).toBe(45)
    expect(stepStrength(5, -1)).toBe(1)
    expect(stepStrength(1, 1)).toBe(5)
    expect(stepStrength(100, 1)).toBe(100)
    expect(stepStrength(33, -1)).toBe(30)
  })

  it('keeps a slider or typed value whole and inside the bounds', () => {
    expect(clampTicks(47.6, 0)).toBe(48)
    expect(clampTicks(-5, 0)).toBe(0)
    expect(clampTicks(0, 1)).toBe(1)
    expect(clampTicks(99999, 1)).toBe(99999)
    expect(clampTicks(491521, 1)).toBe(GLOW_REACH)
    expect(clampTicks(Number.NaN, 0)).toBeUndefined()
  })
})

describe('labels', () => {
  it('shows ticks as units, and no size as AUTO', () => {
    expect(sizeLabel(undefined)).toBe('AUTO')
    expect(sizeLabel(0)).toBe('0')
    expect(sizeLabel(48)).toBe('2/5')
    expect(sizeLabel(180)).toBe('1 1/2')
  })
})

describe('the pre-pick', () => {
  it('suggests LIGHT for bright points and FOG for dark ones', () => {
    const bright = base({ vertices: [{ p: [0, 0, 0], c: [1, 0.9, 0.4] }] })
    const dark = base({ vertices: [{ p: [0, 0, 0], c: [0.1, 0.15, 0.1] }, { p: [1, 0, 0], c: [0.2, 0.2, 0.15] }] })
    expect(suggestedStyle(bright, [0, 0, 0])).toBe('light')
    expect(suggestedStyle(dark, [1, 1, 1])).toBe('fog')
  })

  it('goes by the color in hand when there are no points yet', () => {
    expect(suggestedStyle(base(), [1, 1, 1])).toBe('light')
    expect(suggestedStyle(base(), [0.05, 0.05, 0.05])).toBe('fog')
    expect(meanColor(base())).toBeUndefined()
  })
})
