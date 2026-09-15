/**
 * What these prove: every stamp is a clean piece of geometry before it ever
 * reaches a shard.
 *
 * The bug these were written for: half of a block's twelve triangles were
 * listed the other way round. The box was closed and its points were right, so
 * it looked correct in a viewer that draws both sides of a face and looked
 * torn in one that does not, which is what the bench is (ShardMesh draws
 * fronts in colour and backs in grey). Every solid stamp had it, worst of all
 * the pyramid, whose four sides all faced inward.
 *
 * Winding is not a rendering detail here. An object published as SNO is read
 * by tools that have never seen this app, and a front face is the only thing
 * that tells them which side of a surface is the outside.
 */
import { describe, expect, it } from 'vitest'
import { MAX_SIZE, MIN_SIZE, STAMPS, preview, stamp, type Facing, type StampKind } from './stamps'
import { TICKS_PER_UNIT, ticksOf, type ShardModel } from './shards'

const SIZES = Array.from({ length: MAX_SIZE - MIN_SIZE + 1 }, (_, i) => MIN_SIZE + i)
const FACINGS: Facing[] = [0, 1, 2, 3]
/** The ones that enclose a volume, as against the flat ones drawn on the level. */
const SOLID: StampKind[] = ['block', 'column', 'pyramid', 'wedge']

type V3 = [number, number, number]

function geometry(kind: StampKind, size: number, facing: Facing): { points: V3[]; faces: Array<[number, number, number]> } {
  const g = preview(kind, size, facing, [1, 1, 1])
  return { points: g.vertices.map((v) => ticksOf(v) as V3), faces: g.faces }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
const dot = (u: V3, v: V3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]

/** Twice the area of a triangle, as a vector along its normal. */
function areaVector(a: V3, b: V3, c: V3): V3 {
  return cross(sub(b, a), sub(c, a))
}

describe.each(STAMPS)('the %s stamp', (kind) => {
  it.each(SIZES)('at size %i has no degenerate or repeated triangle', (size) => {
    const { points, faces } = geometry(kind, size, 0)
    for (const f of faces) {
      const key = f.map((i) => points[i].join(','))
      expect(new Set(key).size, `triangle ${f.join(',')} has a repeated corner`).toBe(3)
      expect(areaVector(points[f[0]], points[f[1]], points[f[2]]).some((n) => n !== 0), `triangle ${f.join(',')} has no area`).toBe(true)
    }
    const keys = faces.map((f) => f.map((i) => points[i].join(',')).sort().join('|'))
    expect(new Set(keys).size, 'the same three corners appear twice').toBe(keys.length)
  })

  it.each(SIZES)('at size %i carries no vertex it does not use', (size) => {
    const { points, faces } = geometry(kind, size, 0)
    // A shape with no faces is a loop: its closing point repeats the first on
    // purpose, so LINES draws it shut. Anything with faces has no such excuse.
    if (faces.length === 0) return
    const used = new Set(faces.flat())
    expect(used.size, 'a vertex no triangle refers to').toBe(points.length)
    const seen = points.map((p) => p.join(','))
    expect(new Set(seen).size, 'two vertices at the same place').toBe(seen.length)
  })
})

describe.each(SOLID)('the %s stamp encloses a volume', (kind) => {
  it.each(SIZES)('at size %i is closed: every edge used once each way', (size) => {
    const { faces } = geometry(kind, size, 0)
    const edges = new Map<string, number>()
    for (const f of faces) {
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
        edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1)
      }
    }
    for (const [e, n] of edges) {
      const [a, b] = e.split('>')
      expect(n, `edge ${e} appears ${n} times in the same direction`).toBe(1)
      expect(edges.get(`${b}>${a}`), `edge ${e} has no partner facing the other way, so there is a hole`).toBe(1)
    }
  })

  it.each(FACINGS)('facing %i has every triangle facing outward', (facing) => {
    for (const size of SIZES) {
      const { points, faces } = geometry(kind, size, facing)
      const used = [...new Set(faces.flat())]
      const middle = [0, 1, 2].map((a) => used.reduce((sum, i) => sum + points[i][a], 0) / used.length) as V3
      for (const f of faces) {
        const [a, b, c] = f.map((i) => points[i])
        const outward = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - middle[k]) as V3
        // These are all convex, so away from the middle is away from the shape.
        expect(dot(areaVector(a, b, c), outward), `${kind} size ${size} facing ${facing}: triangle ${f.join(',')} faces inward`).toBeGreaterThan(0)
      }
    }
  })
})

describe('the flat stamps tile their outline exactly', () => {
  it.each(['star', 'arrow'] as StampKind[])('%s leaves no hole and no overlap', (kind) => {
    for (const size of SIZES) {
      const { points, faces } = geometry(kind, size, 0)
      // On the level, so the outline's area is its shoelace sum over X and Z,
      // and the triangles must add up to exactly that: less is a hole, more is
      // an overlap. The outline is the points in the order they were made.
      const loop = points
      let twiceOutline = 0
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length]
        twiceOutline += a[0] * b[2] - b[0] * a[2]
      }
      const twiceTris = faces.reduce((sum, f) => {
        const [a, b, c] = f.map((i) => points[i])
        return sum + ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]))
      }, 0)
      expect(Math.abs(twiceTris), `${kind} at size ${size}`).toBe(Math.abs(twiceOutline))
    }
  })
})

describe('the cull between touching stamps', () => {
  // The reason each side is split along the diagonal its neighbour would
  // choose: two boxes that share a wall must produce the same pair of
  // triangles there, or the wall stays inside the object as two coincident
  // surfaces. Reversing a side to face outward had to keep that diagonal, and
  // this is what says it did.
  const empty: ShardModel = {
    id: 't', name: 't', unit: 0, extent: 8, mode: 'solid', up: false, spin: 0,
    vertices: [], faces: [], updatedAt: 0,
  }

  it('drops the wall where two blocks meet, both copies of it', () => {
    const one = stamp(empty, 'block', 2, 0, [0, 0, 0], [1, 1, 1])
    expect(one).not.toBeNull()
    // The next block along X, exactly one block away, so they share a face.
    const two = stamp(one!.shard, 'block', 2, 0, [2 * TICKS_PER_UNIT, 0, 0], [1, 1, 1])
    expect(two).not.toBeNull()
    // Two triangles gone from each side of the shared wall.
    expect(two!.culled).toBe(4)
    expect(two!.shard.faces.length).toBe(12 + 12 - 4)
  })

  it('leaves both whole when they do not touch', () => {
    const one = stamp(empty, 'block', 2, 0, [0, 0, 0], [1, 1, 1])
    const two = stamp(one!.shard, 'block', 2, 0, [6 * TICKS_PER_UNIT, 0, 0], [1, 1, 1])
    expect(two!.culled).toBe(0)
    expect(two!.shard.faces.length).toBe(24)
  })
})
