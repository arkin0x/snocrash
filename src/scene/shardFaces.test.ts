/**
 * shardFaces.test.ts - a see-through shard (DECK-0003 §1.11) blends without
 * touching the alpha under it, draws after every opaque face, writes no
 * depth, and keeps one pass for both sides; opaque shards are exactly as they
 * were; a placed object takes its own opacity. Ported from ONOSENDAI.
 */

import { describe, expect, it } from 'vitest'
import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor, ZeroFactor } from 'three'
import { DOTS_ORDER, GHOST_OPACITY, OVERLAY_ORDER, TAG_BLEND, TRANSLUCENT_ORDER, basicFaceProps, benchOrders, lineProps, litFaceProps, seeThrough, shardOpacity, shardOrder } from './shardFaces'

// The sources read as text, the way singlePass.test.ts reads them: by module
// path rather than the working directory, so the test runs from anywhere.
const sources = import.meta.glob(['./ShardMesh.tsx', '../ui/Bench.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = (name: string): string => {
  const hit = Object.entries(sources).find(([f]) => f.endsWith(name))
  if (!hit) throw new Error(`no source ${name}`)
  return hit[1]
}

describe('what a shard is drawn at', () => {
  it('is its own opacity with the 10% floor, 1 when it has none', () => {
    expect(shardOpacity({})).toBe(1)
    expect(shardOpacity({ opacity: 50 })).toBe(0.5)
    expect(shardOpacity({ opacity: 3 })).toBe(0.1)
  })

  it('multiplies a ghost by the object\'s own', () => {
    expect(shardOpacity({}, { ghost: true })).toBe(GHOST_OPACITY)
    expect(shardOpacity({ opacity: 50 }, { ghost: true })).toBeCloseTo(GHOST_OPACITY * 0.5)
  })
})

describe('a see-through face', () => {
  const p = basicFaceProps(0.5, { ghost: false, world: true })

  it('keeps one pass for both sides, writes no depth, draws after every opaque face', () => {
    expect(p.forceSinglePass).toBe(true)
    expect(p.depthWrite).toBe(false)
    expect(shardOrder(0.5, false)).toBe(TRANSLUCENT_ORDER)
    expect(TRANSLUCENT_ORDER).toBeGreaterThan(0)
  })

  it('drawn `world`, blends its colour and leaves the alpha under it as it was', () => {
    expect(p).toMatchObject({ transparent: true, opacity: 0.5, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor })
  })

  it('is one pass at every opacity from the floor to solid', () => {
    for (let pct = 10; pct <= 100; pct += 5) for (const world of [true, false]) expect(basicFaceProps(pct / 100, { ghost: false, world }).forceSinglePass).toBe(true)
  })
})

describe('opaque faces and ghosts are as they were', () => {
  it('opaque, world: the alpha-0 tag, depth written, the default order', () => {
    const p = basicFaceProps(1, { ghost: false, world: true })
    expect(p).toMatchObject({ ...TAG_BLEND, transparent: true, opacity: 1, forceSinglePass: true })
    expect(p).not.toHaveProperty('depthWrite')
    expect(shardOrder(1, false)).toBe(0)
  })

  it('opaque, not world: plain blending', () => {
    expect(basicFaceProps(1, { ghost: false, world: false })).toEqual({ transparent: true, opacity: 1, forceSinglePass: true })
  })

  it('a ghost: two passes, ordinary blending, depth written, at its own opacity too', () => {
    expect(basicFaceProps(0.45 * 0.5, { ghost: true, world: true })).toEqual({ transparent: true, opacity: 0.45 * 0.5, forceSinglePass: false })
    expect(seeThrough(0.2, true)).toBe(false)
  })
})

describe('lines and the bench', () => {
  it('a see-through line or lit face writes no depth; an opaque one does', () => {
    expect(lineProps(0.5, false)).toEqual({ transparent: true, opacity: 0.5, depthWrite: false })
    expect(lineProps(1, false)).toEqual({ transparent: true, opacity: 1 })
    expect(litFaceProps(0.5, false)).toEqual({ transparent: true, opacity: 0.5, depthWrite: false })
  })
})

describe('where it is wired (ShardMesh)', () => {
  const mesh = source('/ShardMesh.tsx')

  it('every face, line and point material takes the one opacity, and every mesh the one order', () => {
    expect(mesh).toMatch(/const opacity = shardOpacity\(given, \{ ghost \}\)/)
    // transparent and forceSinglePass before the spread: singlePass.test.ts's scan ends a declaration at its first "})".
    expect(mesh).toMatch(/<meshBasicMaterial[^>]*transparent forceSinglePass=\{!ghost\} \{\.\.\.basicFaceProps\(opacity, \{ ghost, world \}\)\}/)
    expect((mesh.match(/litFaceProps\(opacity, ghost\)/g) ?? []).length).toBe(2)
    expect((mesh.match(/lineProps\(opacity, ghost\)/g) ?? []).length).toBe(2)
    expect((mesh.match(/renderOrder=\{order\}/g) ?? []).length).toBe(1)
    expect(mesh).toMatch(/name="shard-faces"[^>]*renderOrder=\{lit \? bench\.front : order\}/)
    expect(mesh).toMatch(/geometry=\{inside\}[^>]*renderOrder=\{bench\.inside\}/)
    expect(mesh).toMatch(/<points [^>]*renderOrder=\{DOTS_ORDER\}/)
    expect(mesh).toMatch(/createDiscMaterial\([^)]*\? opacity : opacity \* 0\.55\)/)
  })

  it('a placed object is drawn from its own model, never with its parent\'s opacity (§1.10)', () => {
    expect(mesh).toMatch(/body = <ShardMesh shard=\{model\} nested=\{r\.children\}[^>]*\/>/)
    expect(mesh).not.toMatch(/body = <ShardMesh[^>]*opacity=\{opacity\}/)
  })
})

describe('the draw order (reviews of #41 and ONOSENDAI #452)', () => {
  it('opaque < see-through < bench front < dots < overlays', () => {
    expect(0).toBeLessThan(TRANSLUCENT_ORDER)
    expect(TRANSLUCENT_ORDER).toBeLessThan(benchOrders(0.5, false).front)
    expect(benchOrders(0.5, false).front).toBeLessThan(DOTS_ORDER)
    expect(DOTS_ORDER).toBeLessThan(OVERLAY_ORDER)
  })

  it('a see-through lit face draws its inside first, then its front; opaque stays at 0 for both', () => {
    expect(benchOrders(0.5, false)).toEqual({ inside: TRANSLUCENT_ORDER, front: TRANSLUCENT_ORDER + 0.5 })
    expect(benchOrders(1, false)).toEqual({ inside: 0, front: 0 })
    expect(benchOrders(0.2, true)).toEqual({ inside: 0, front: 0 })
  })

  it('the bench\'s translucent overlays draw at OVERLAY_ORDER, so a see-through face never hides them', () => {
    const bench = source('/Bench.tsx')
    expect(bench).toMatch(/<mesh geometry=\{lit\.g\} frustumCulled=\{false\} renderOrder=\{OVERLAY_ORDER\}>/)
    expect(bench).toMatch(/edge\.renderOrder = OVERLAY_ORDER/)
    expect(bench).toMatch(/LineBasicMaterial\(\{ color: WARN, toneMapped: false, transparent: true \}\)/)
    expect(bench).toMatch(/<sprite [^>]*renderOrder=\{OVERLAY_ORDER\}>/)
    expect(bench).toMatch(/l\.renderOrder = OVERLAY_ORDER/)
    expect(bench).toMatch(/<mesh position=\{UP\(aim\)\} renderOrder=\{OVERLAY_ORDER\}>/)
  })
})
