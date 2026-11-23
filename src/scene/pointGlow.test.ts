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
  HALO_CAP_COARSE,
  HALO_MAX_SCREEN,
  HALO_ORDER,
  HALO_SCREENS,
  haloMaxScreen,
  setCoreOpacity,
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
      expect(shardDraws({ mode }, 1)).toEqual({ own: true, hitPoints: false, hitFaces: false, faint: false, defaultPoints: true, coreSize: null, halo: null })
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
    for (const mode of ['solid', 'lines'] as const) expect(shardDraws({ ...forest, mode }, 1)).toMatchObject({ own: true, defaultPoints: true, coreSize: null, halo: null })
  })

  it('at opacity 0, nothing of its own, and the glow at full strength', () => {
    const shard: Look = { ...forest, opacity: 0 }
    const d = shardDraws(shard, shardOpacity(shard))
    expect(d).toMatchObject({ own: false, defaultPoints: false, coreSize: null, halo: { radius: 2, strength: 0.35, light: 0 } })
  })

  it('never multiplies the glow by the object\'s opacity', () => {
    for (const opacity of [0, 10, 40, 99]) {
      const shard: Look = { ...forest, opacity }
      expect(shardDraws(shard, shardOpacity(shard)).halo?.strength).toBe(0.35)
    }
  })

  it('reads a malformed field as absent, never a reason to draw less', () => {
    expect(shardDraws({ mode: 'points', extra: { pointsize: 1.5, glow: ['Light', 240, 35] } }, 1)).toMatchObject({ own: true, defaultPoints: true, coreSize: null, halo: null })
  })
})

describe('what a tap meets', () => {
  it('the points, unseen, whenever the default disc is not drawn, so a placed object stays tappable', () => {
    expect(shardDraws(forest, 1).hitPoints).toBe(true)
    expect(shardDraws({ mode: 'points', extra: { pointsize: 0 } }, 1).hitPoints).toBe(true)
    expect(shardDraws({ mode: 'solid' }, 0).hitPoints).toBe(true)
    expect(shardDraws({ mode: 'points' }, 1).hitPoints).toBe(false)
  })

  it('the faces, unseen, at 0% in SOLID', () => {
    expect(shardDraws({ mode: 'solid' }, 0).hitFaces).toBe(true)
    expect(shardDraws({ mode: 'solid' }, 0.5).hitFaces).toBe(false)
    expect(shardDraws({ mode: 'lines' }, 0).hitFaces).toBe(false)
  })

  it('a 0% object shows faint dots only in the workshop, for its author', () => {
    expect(shardDraws({ mode: 'solid' }, 0, { editing: true }).faint).toBe(true)
    expect(shardDraws({ mode: 'solid' }, 0).faint).toBe(false)
    expect(shardDraws({ mode: 'solid' }, 0.4, { editing: true }).faint).toBe(false)
  })
})

describe('sizes', () => {
  it('are ticks of the object\'s lattice, 120 to a unit; the unit and a placement\'s step reach them through the model-view', () => {
    expect(ticksToModel(120)).toBe(1)
    expect(ticksToModel(48)).toBeCloseTo(0.4)
    expect(haloLook({ style: 'light', radius: 7680, strength: 100 })).toEqual({ radius: 64, strength: 1, light: 1 })
    // The farthest a radius reaches, the 4,096-unit position bound (DECK-0003 §1.8).
    expect(haloLook({ style: 'light', radius: 491520, strength: 100 }).radius).toBe(4096)
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
    expect(shardDraws(forest, 0.45, { ghost: true, ghostOpacity: 0.45 }).halo?.strength).toBeCloseTo(0.1575)
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

  it('opaque points write depth with a hard rim, so large ones overlap in their true order; see-through ones do not', () => {
    const m = createCoreMaterial(0.4, 1)
    expect(m.depthWrite).toBe(true)
    expect(m.uniforms.uHard.value).toBe(1)
    setCoreOpacity(m, 0.5)
    expect(m.depthWrite).toBe(false)
    expect(m.uniforms.uHard.value).toBe(0)
    expect(m.uniforms.uOpacity.value).toBe(0.5)
  })

  it('fades a near halo by the radius it is drawn at, after the screen cap', () => {
    const v = createHaloMaterial({ radius: 2, strength: 0.35, light: 0 }).vertexShader
    expect(v.indexOf('min(uRadius * modelScale(), uMaxScreen')).toBeGreaterThan(-1)
    expect(v.indexOf('min(uRadius * modelScale(), uMaxScreen')).toBeLessThan(v.indexOf('vFade = smoothstep'))
  })
})

describe('the halo budget', () => {
  it('fewer halos on a coarse pointer (a phone or tablet)', () => {
    expect(HALO_CAP_COARSE).toBeLessThan(HALO_CAP)
    expect(HALO_CAP_COARSE).toBeLessThanOrEqual(1000)
  })

  it('shrinks the largest halo so one object covers no more than HALO_SCREENS screens', () => {
    expect(haloMaxScreen(1, 1)).toBe(HALO_MAX_SCREEN)
    expect(haloMaxScreen(0, 1)).toBe(HALO_MAX_SCREEN)
    for (const [n, aspect] of [[1000, 0.46], [4096, 1.6], [200, 1]] as const) {
      const r = haloMaxScreen(n, aspect)
      expect(r).toBeLessThan(HALO_MAX_SCREEN)
      expect(n * Math.PI * r * r).toBeCloseTo(HALO_SCREENS * aspect)
    }
  })

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
