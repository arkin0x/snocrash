/**
 * ply.ts - an object as a PLY file, which is the first export worth having.
 *
 * PLY, from Stanford in 1994, is the format whose data model already is this
 * one: a list of vertices, a color on each, and a list of faces indexing them.
 * Blender, MeshLab and every 3D scanner read it. glTF needs the whole material
 * and scene-graph story before anything renders; PLY needs a header and two
 * lists, so a round trip through it proves the model is right in an afternoon.
 *
 * Positions go out in model units as decimals, because PLY has no notion of an
 * integer lattice and every reader expects floats. That is the one place this
 * conversion loses something: 1/120 is not exactly representable in binary
 * floating point, so a PLY of an object is a faithful picture of it and not a
 * substitute for the object. Anything that needs exactness reads the event.
 *
 * Colors go out as bytes, which is what `uchar red green blue` means and what
 * every reader expects, rather than as the floats the payload carries.
 */

import { TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'

/** A colour channel as PLY writes it: 0..255, clamped, rounded. */
function byte(c: number): number {
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

/**
 * The object as an ASCII PLY document.
 *
 * `comment` lines carry what PLY has nowhere to put: the object's name and its
 * scale exponent. They are the convention every PLY writer uses for exactly
 * this, and a reader that ignores them loses nothing but the label.
 */
export function toPly(shard: ShardModel): string {
  const lines: string[] = [
    'ply',
    'format ascii 1.0',
    `comment name ${shard.name.replace(/[\r\n]/g, ' ')}`,
    `comment unit ${shard.unit}`,
    'comment written by snocrash',
    `element vertex ${shard.vertices.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${shard.faces.length}`,
    'property list uchar int vertex_index',
    'end_header',
  ]
  for (const v of shard.vertices) {
    const [x, y, z] = ticksOf(v).map((t) => t / TICKS_PER_UNIT)
    const [r, g, b] = v.c.map(byte)
    lines.push(`${x} ${y} ${z} ${r} ${g} ${b}`)
  }
  for (const f of shard.faces) lines.push(`3 ${f[0]} ${f[1]} ${f[2]}`)
  return lines.join('\n') + '\n'
}

/** A filename for a downloaded object: its name, made safe, with an extension. */
export function fileNameFor(shard: ShardModel, ext: string): string {
  const base = shard.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'object'}.${ext}`
}
