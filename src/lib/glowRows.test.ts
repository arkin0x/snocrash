/** glowRows.test.ts - the steps, labels and greyed states behind POINT SIZE, GLOW, RADIUS and GLOW STRENGTH. */

import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { AUTO_POINT_TICKS, clampTicks, glowRowState, meanColor, sizeLabel, stepPointSize, stepStrength, stepTicks, suggestedStyle } from './glowRows'

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
    expect(stepPointSize(7680, 1)).toBe(7680)
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
    expect(clampTicks(99999, 1)).toBe(7680)
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
