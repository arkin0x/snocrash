/**
 * glow.test.ts - the workshop's POINT SIZE and GLOW setters (DECK-0003 §1.15
 * and §1.16): written into `extra` through sno-core, one undo step per drag,
 * OFF and back restores the radius and strength, and what is published
 * carries both.
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

import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { drawnGlow, drawnPointSize } from 'sno-core/glow'
import { useWorkshop } from './useWorkshop'
import { GLOW_START } from '../lib/glowRows'

const w = () => useWorkshop.getState()
const cur = () => w().current() as ShardModel

beforeEach(() => {
  const s: ShardModel = { ...newShard('Forest'), mode: 'points', vertices: [{ p: [0, 0, 0], c: [0.2, 0.3, 0.2] }, { p: [1, 0, 0], c: [0.2, 0.3, 0.2] }], faces: [] }
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], selection: [], partSel: [], glowMemory: { ...GLOW_START } })
  w().endLive()
})

describe('POINT SIZE', () => {
  it('writes whole ticks into extra, 0 included, and AUTO removes it', () => {
    w().setPointSize(48)
    expect(cur().extra).toEqual({ pointsize: 48 })
    expect(drawnPointSize(cur())).toBe(48)
    w().setPointSize(0)
    expect(cur().extra).toEqual({ pointsize: 0 })
    w().setPointSize(undefined)
    expect(cur()).not.toHaveProperty('extra')
  })

  it('never writes a malformed value', () => {
    w().setPointSize(48)
    w().setPointSize(99999)
    expect(cur()).not.toHaveProperty('extra')
  })

  it('makes one drag one undo step', () => {
    w().setPointSize(12, true)
    w().setPointSize(18, true)
    w().setPointSize(24, true)
    w().endLive()
    expect(cur().extra).toEqual({ pointsize: 24 })
    expect(w().past).toHaveLength(1)
    w().undo()
    expect(cur()).not.toHaveProperty('extra')
  })

  it('makes a second drag a second step', () => {
    w().setPointSize(12, true)
    w().endLive()
    w().setPointSize(30, true)
    w().endLive()
    expect(w().past).toHaveLength(2)
    w().undo()
    expect(cur().extra).toEqual({ pointsize: 12 })
  })
})

describe('GLOW', () => {
  it('writes the glow as its wire form, and OFF removes it', () => {
    w().setGlow({ style: 'fog', radius: 240, strength: 35 })
    expect(cur().extra).toEqual({ glow: ['fog', 240, 35] })
    expect(drawnGlow(cur())).toEqual({ style: 'fog', radius: 240, strength: 35 })
    w().setGlow(undefined)
    expect(cur()).not.toHaveProperty('extra')
  })

  it('remembers the radius and strength for the session, so OFF and back brings them back', () => {
    expect(w().glowMemory).toEqual(GLOW_START)
    w().setGlow({ style: 'light', radius: 300, strength: 70 })
    w().setGlow(undefined)
    expect(w().glowMemory).toEqual({ radius: 300, strength: 70 })
  })

  it('keeps every other carried field, and is kept in SOLID', () => {
    useWorkshop.setState({ shards: [{ ...cur(), extra: { anim: [['turn', 'y', 1, 20, 0]] } }] })
    w().setGlow({ style: 'light', radius: 120, strength: 40 })
    w().setMode('solid')
    expect(cur().extra).toEqual({ anim: [['turn', 'y', 1, 20, 0]], glow: ['light', 120, 40] })
    // Kept, not drawn.
    expect(drawnGlow(cur())).toBeUndefined()
  })

  it('makes one drag of RADIUS one undo step', () => {
    w().setGlow({ style: 'fog', radius: 120, strength: 40 })
    w().setGlow({ style: 'fog', radius: 126, strength: 40 }, true)
    w().setGlow({ style: 'fog', radius: 132, strength: 40 }, true)
    w().endLive()
    expect(w().past).toHaveLength(2)
    w().undo()
    expect(cur().extra).toEqual({ glow: ['fog', 120, 40] })
  })

  it('is what the published payload carries, and reads back', () => {
    w().setPointSize(48)
    w().setGlow({ style: 'fog', radius: 240, strength: 35 })
    const wire = JSON.parse(JSON.stringify(toPayload(cur())))
    expect(wire.pointsize).toBe(48)
    expect(wire.glow).toEqual(['fog', 240, 35])
    const back = fromPayload(wire, 'x') as ShardModel
    expect(drawnPointSize(back)).toBe(48)
    expect(drawnGlow(back)).toEqual({ style: 'fog', radius: 240, strength: 35 })
  })

  it('is independent of OPACITY: an object at 0% keeps its glow', () => {
    w().setGlow({ style: 'light', radius: 120, strength: 60 })
    w().setOpacity(0)
    expect(cur().opacity).toBe(0)
    expect(drawnGlow(cur())).toEqual({ style: 'light', radius: 120, strength: 60 })
  })
})
