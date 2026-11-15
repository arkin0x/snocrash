/** opacityStep.test.ts - the workshop's OPACITY stepper moves in fives from 0 to solid, with no floor. */

import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { opacityPercent, stepOpacity, withOpacity } from './opacityStep'

describe('the OPACITY stepper', () => {
  it('reads no opacity as solid', () => {
    expect(opacityPercent(undefined)).toBe(100)
    expect(opacityPercent(40)).toBe(40)
    // No floor: a stored 5 is 5, and 0 is 0.
    expect(opacityPercent(5)).toBe(5)
    expect(opacityPercent(0)).toBe(0)
  })

  it('steps in fives, and stops at 0 and at solid', () => {
    expect(stepOpacity(undefined, -1)).toBe(95)
    expect(stepOpacity(95, 1)).toBe(100)
    expect(stepOpacity(100, 1)).toBe(100)
    expect(stepOpacity(10, -1)).toBe(5)
    expect(stepOpacity(5, -1)).toBe(0)
    expect(stepOpacity(0, -1)).toBe(0)
    expect(stepOpacity(0, 1)).toBe(5)
  })

  it('takes a value off the fives to the next five in the direction asked', () => {
    expect(stepOpacity(33, 1)).toBe(35)
    expect(stepOpacity(33, -1)).toBe(30)
    expect(stepOpacity(3, 1)).toBe(5)
    expect(stepOpacity(3, -1)).toBe(0)
  })
})

describe('setting an opacity (withOpacity)', () => {
  const base: ShardModel = newShard('Water')

  it('keeps a percent between 0 and 99, and stores solid as none', () => {
    expect(withOpacity(base, 40).opacity).toBe(40)
    expect(withOpacity(base, 3).opacity).toBe(3)
    expect(withOpacity(base, 0).opacity).toBe(0)
    expect(withOpacity(base, -4).opacity).toBe(0)
    expect(withOpacity(withOpacity(base, 40), 100)).not.toHaveProperty('opacity')
    expect(withOpacity(base, Number.NaN)).not.toHaveProperty('opacity')
  })

  it('drops an opacity an older sno-core carried in extra, and extra with it when it empties', () => {
    const old: ShardModel = { ...base, extra: { opacity: 30 } }
    expect(withOpacity(old, 60)).not.toHaveProperty('extra')
    expect(withOpacity(old, 60).opacity).toBe(60)
    expect(withOpacity(old, 100)).not.toHaveProperty('extra')
    expect(withOpacity(old, 100)).not.toHaveProperty('opacity')
  })

  it('keeps every other carried field', () => {
    const old: ShardModel = { ...base, extra: { opacity: 30, sheen: 2 } }
    expect(withOpacity(old, 60).extra).toEqual({ sheen: 2 })
  })
})
