/**
 * ply.test.ts - EXPORT PLY and IMPORT are each other's inverse.
 *
 * The export used to write the model's own frame, which is the published one
 * mirrored in Z (sno-core shards), so every exported object came out mirrored
 * and inside out (DECK-0003 §2). It writes the published frame now, and a
 * PLY saved here imports back as the same object, fronts and all.
 */

import { describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, fromPayload, ticksOf, toPayload } from 'sno-core/shards'
import { importMesh } from 'sno-core/importFile'
import { toPly } from './ply'

/** An asymmetric tetrahedron on the wire, its corner at +Z, every face wound to look out. */
const TETRA = { v: 2, name: 'tetra', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 4]], colors: [238, 235, 239, 225], faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] }

describe('EXPORT PLY', () => {
  it('writes the published frame: the corner at +Z on the wire is at +Z in the file', () => {
    const s = fromPayload(TETRA, 't')!
    const rows = toPly(s).split('\n')
    const body = rows.slice(rows.indexOf('end_header') + 1)
    expect(body[3].split(' ').slice(0, 3).map(Number)).toEqual([0, 0, 4])
  })

  it('imports back as the same object: the same points and faces, the same fronts', () => {
    const s = fromPayload(TETRA, 't')!
    // Fit to the tetra's own size (4 units), so the import lands on the same ticks.
    const r = importMesh({ files: [{ name: 'tetra.ply', bytes: new TextEncoder().encode(toPly(s)) }], options: { fit: 4 * T } })
    if (!r.ok) throw new Error(r.error)
    const back = toPayload(r.shard)
    const orig = toPayload(s)
    // The import centers X and Z and stands on Y = 0; the tetra is 2 wide and 4 deep, so it moves by (-1, 0, -2).
    expect(back.vertices).toEqual(orig.vertices.map(([x, y, z]) => [x - 1, y, z - 2]))
    expect(back.faces).toEqual(orig.faces)
    expect(r.shard.vertices.map((v) => v.c)).toEqual(s.vertices.map((v) => v.c))
    expect(r.shard.vertices.map(ticksOf).map((t) => t[2])).toEqual(s.vertices.map(ticksOf).map((t) => t[2] + 2 * T))
  })
})
