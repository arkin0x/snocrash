/**
 * The bench camera's reach and depth for the grid (benchReach.ts). GRID SIZE
 * runs to 4,096 (DECK-0003 §1.8, 2026-11-23): an empty grid that size must fit
 * the view, while the default grid keeps the 60 and the planes it always had.
 */
import { describe, expect, it } from 'vitest'
import { GRID_HALF, MAX_EXTENT } from 'sno-core/shards'
import { BASE_FAR, BASE_NEAR, MIN_REACH, clipPlanes, fitDistance, gridSphere, nextMaxDistance, reachFor, reachRadius } from './benchReach'

/** The bench's lens (Bench.tsx Canvas). */
const FOV = 50
/** A desktop window and a phone held upright. */
const DESKTOP = 1280 / 800
const PHONE = 390 / 844
const ORIGIN = { x: 0, y: 0, z: 0 }

/** Whether a sphere of `radius` fits the narrower half field of view from `distance`. */
function fits(radius: number, distance: number, aspect: number): boolean {
  const v = (FOV * Math.PI) / 360
  const half = Math.min(v, Math.atan(Math.tan(v) * aspect))
  return Math.asin(radius / distance) <= half + 1e-12
}

/** The orbit's reach as Bench Reach sets it, for a grid of `extent` aimed at its centre. */
const reachOf = (extent: number, aspect: number): number => reachFor(reachRadius(gridSphere(extent, 1, 0), ORIGIN), FOV, aspect)

describe('the bench as it opens', () => {
  it('keeps the planes and the reach the bench always had', () => {
    expect(BASE_NEAR).toBe(0.05)
    expect(BASE_FAR).toBe(200)
    expect(MIN_REACH).toBe(60)
  })
})

describe('gridSphere', () => {
  it('lies in its plane at the level, the outermost lines included', () => {
    expect(gridSphere(8, 1, 3)).toEqual({ center: [0, 3, 0], radius: Math.SQRT2 * 8.5 })
    expect(gridSphere(8, 0, 3).center).toEqual([3, 0, 0])
    // Render Z is model Z mirrored.
    expect(gridSphere(8, 2, 3).center).toEqual([0, 0, -3])
  })
})

describe('reachRadius', () => {
  it('grows with how far the target stands off, by no more than the sphere\'s own radius', () => {
    const s = gridSphere(8, 1, 0)
    expect(reachRadius(s, ORIGIN)).toBe(s.radius)
    expect(reachRadius(s, { x: 3, y: 4, z: 0 })).toBeCloseTo(s.radius + 5, 9)
    expect(reachRadius(s, { x: 1000, y: 0, z: 0 })).toBe(2 * s.radius)
  })
})

describe('the reach', () => {
  it('keeps the 60 the bench always had for small grids on a desktop, the default among them', () => {
    for (const e of [1, GRID_HALF, 15]) expect(reachOf(e, DESKTOP)).toBe(MIN_REACH)
  })

  it('lets the whole of the largest grid fit the view, on a desktop and on a phone', () => {
    for (const aspect of [DESKTOP, PHONE]) {
      const d = reachOf(MAX_EXTENT, aspect)
      expect(d).toBeGreaterThan(MIN_REACH * 100)
      expect(fits(gridSphere(MAX_EXTENT, 1, 0).radius, d, aspect)).toBe(true)
    }
  })

  it('fits by the narrower side, so an upright phone fits the grid across', () => {
    expect(fitDistance(10, FOV, PHONE)).toBeGreaterThan(fitDistance(10, FOV, DESKTOP) * 1.8)
  })

  it('never drops below where the camera stands, so a smaller grid does not yank the view in', () => {
    expect(nextMaxDistance(60, 300)).toBe(300)
    expect(nextMaxDistance(900, 300)).toBe(900)
  })
})

describe('the clip planes', () => {
  it('are exactly what the bench opened with for the default grid anywhere within the old reach', () => {
    const r = reachRadius(gridSphere(GRID_HALF, 1, 0), { x: 1000, y: 0, z: 0 })
    for (const d of [0.6, 5, 18, 40, MIN_REACH]) expect(clipPlanes(d, r)).toEqual({ near: BASE_NEAR, far: BASE_FAR })
  })

  it('draw the whole of the largest grid from the far end, with depth to sort it', () => {
    const r = gridSphere(MAX_EXTENT, 1, 0).radius
    for (const aspect of [DESKTOP, PHONE]) {
      const d = reachOf(MAX_EXTENT, aspect)
      const { near, far } = clipPlanes(d, r)
      expect(far).toBeGreaterThan(d + r)
      expect(near).toBeLessThan(d - r)
      expect(far / near).toBeLessThan(4000)
    }
  })

  it('pull the near plane out smoothly past the old reach, never in', () => {
    expect(clipPlanes(MIN_REACH * 2, 0).near).toBeCloseTo(BASE_NEAR * 2, 12)
    expect(clipPlanes(MIN_REACH * 1.0001, 0).near).toBeGreaterThan(BASE_NEAR)
  })
})
