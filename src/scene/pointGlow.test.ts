/**
 * pointGlow.test.ts - point size and glow in POINTS mode: what a shard draws
 * at each opacity, sizes in ticks of its own lattice, the glow never
 * multiplied by the object's opacity, the halo budget and the blend.
 */

import { describe, expect, it } from 'vitest'
import { FrontSide, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { shardOpacity } from './shardFaces'
import {
  DOTS_ORDER,
  TRANSLUCENT_ORDER,
} from './shardFaces'
import {
  HALO_BLEND,
  HALO_CAP,
  HALO_ORDER,
  createCoreMaterial,
  createHaloMaterial,
  fillPicked,
  haloLook,
  haloPicks,
  quadGeometry,
  shardDraws,
  ticksToModel,
} from './pointGlow'

type Look = Pick<ShardModel, 'mode' | 'extra' | 'opacity'>
const forest: Look = { mode: 'points', extra: { pointsize: 48, glow: ['fog', 240, 35] } }

describe('what a shard draws', () => {
  it('without the fields, the default points and no glow, as before', () => {
    for (const mode of ['points', 'solid', 'lines'] as const) {
      expect(shardDraws({ mode }, 1)).toEqual({ own: true, defaultPoints: true, coreSize: null, halo: null })
    }
  })

  it('in POINTS mode, the points at their size and the glow', () => {
    const d = shardDraws(forest, 1)
    expect(d.defaultPoints).toBe(false)
    expect(d.coreSize).toBeCloseTo(0.4)
    expect(d.halo).toEqual({ radius: 2, strength: 0.35, light: 0 })
  })

  it('at POINT SIZE 0, no points at all', () => {
    const d = shardDraws({ mode: 'points', extra: { pointsize: 0 } }, 1)
    expect(d).toMatchObject({ own: true, defaultPoints: false, coreSize: null })
  })

  it('in SOLID and LINES, the default dots and never a glow', () => {
    for (const mode of ['solid', 'lines'] as const) expect(shardDraws({ ...forest, mode }, 1)).toEqual({ own: true, defaultPoints: true, coreSize: null, halo: null })
  })

  it('at opacity 0, nothing of its own, and the glow at full strength', () => {
    const shard: Look = { ...forest, opacity: 0 }
    const d = shardDraws(shard, shardOpacity(shard))
    expect(d).toEqual({ own: false, defaultPoints: false, coreSize: null, halo: { radius: 2, strength: 0.35, light: 0 } })
  })

  it('never multiplies the glow by the object\'s opacity', () => {
    for (const opacity of [0, 10, 40, 99]) {
      const shard: Look = { ...forest, opacity }
      expect(shardDraws(shard, shardOpacity(shard)).halo?.strength).toBe(0.35)
    }
  })

  it('reads a malformed field as absent, never a reason to draw less', () => {
    expect(shardDraws({ mode: 'points', extra: { pointsize: 1.5, glow: ['Light', 240, 35] } }, 1)).toEqual({ own: true, defaultPoints: true, coreSize: null, halo: null })
  })
})

describe('sizes', () => {
  it('are ticks of the object\'s lattice, 120 to a unit; the unit and a placement\'s step reach them through the model-view', () => {
    expect(ticksToModel(120)).toBe(1)
    expect(ticksToModel(48)).toBeCloseTo(0.4)
    expect(haloLook({ style: 'light', radius: 7680, strength: 100 })).toEqual({ radius: 64, strength: 1, light: 1 })
  })

  it('reads the model-view scale in the shaders, so a scaled object keeps its proportions', () => {
    for (const m of [createCoreMaterial(0.4, 1), createHaloMaterial({ radius: 2, strength: 0.35, light: 0 })]) {
      expect(m.vertexShader).toContain('length(modelViewMatrix[0].xyz)')
    }
  })

  it('keeps a point at least about a pixel and a half across, and caps a halo on screen', () => {
    const core = createCoreMaterial(0.4, 1)
    expect(core.uniforms.uMinPx.value).toBeGreaterThanOrEqual(1)
    expect(core.uniforms.uMinPx.value).toBeLessThanOrEqual(1.5)
    expect(createHaloMaterial({ radius: 2, strength: 0.35, light: 0 }).uniforms.uMaxScreen.value).toBeLessThanOrEqual(0.5)
  })
})

describe('the halo', () => {
  it('a ghost dims, the object\'s opacity does not', () => {
    expect(haloLook({ style: 'fog', radius: 240, strength: 50 }, true, 0.45).strength).toBeCloseTo(0.225)
  })

  it('one premultiplied blend for LIGHT and FOG, depth tested, no depth written, one pass', () => {
    const m = createHaloMaterial({ radius: 1, strength: 0.4, light: 1 })
    expect(m).toMatchObject({ ...HALO_BLEND, transparent: true, depthTest: true, depthWrite: false, side: FrontSide })
    expect(HALO_BLEND.blendSrc).toBe(OneFactor)
    expect(HALO_BLEND.blendDst).toBe(OneMinusSrcAlphaFactor)
    // LIGHT writes alpha 0 (adds); FOG writes its alpha (lays over).
    expect(m.fragmentShader).toContain('a * (1.0 - uLight)')
  })

  it('draws after see-through faces and under its points', () => {
    expect(HALO_ORDER).toBeGreaterThan(TRANSLUCENT_ORDER + 0.5)
    expect(HALO_ORDER).toBeLessThan(DOTS_ORDER)
  })

  it('the points at the object\'s opacity, which reaches them', () => {
    expect(createCoreMaterial(0.4, 0.3).uniforms.uOpacity.value).toBe(0.3)
  })
})

describe('the halo budget', () => {
  it('every point up to the cap', () => {
    expect(Array.from(haloPicks(5))).toEqual([0, 1, 2, 3, 4])
    expect(haloPicks(0)).toHaveLength(0)
  })

  it('past it, the cap, spread evenly through the points', () => {
    const p = haloPicks(HALO_CAP * 3)
    expect(p).toHaveLength(HALO_CAP)
    expect(p[0]).toBe(0)
    expect(p[1]).toBe(3)
    expect(p[p.length - 1]).toBe(HALO_CAP * 3 - 3)
    expect(Array.from(haloPicks(10, 4))).toEqual([0, 2, 5, 7])
  })

  it('copies the picked points\' positions and colours', () => {
    const out = new Float32Array(6)
    fillPicked([0, 0, 0, 1, 1, 1, 2, 2, 2], new Uint32Array([0, 2]), out)
    expect(Array.from(out)).toEqual([0, 0, 0, 2, 2, 2])
  })

  it('one quad per point, instanced', () => {
    const g = quadGeometry(new Float32Array(9), new Float32Array(9))
    expect(g.instanceCount).toBe(3)
    expect(g.getAttribute('iPos').itemSize).toBe(3)
    g.dispose()
  })
})
