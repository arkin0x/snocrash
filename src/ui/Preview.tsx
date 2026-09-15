/**
 * Preview.tsx - one object, drawn small, in its own canvas.
 *
 * The feed is a wall of these. Each is a fixed camera looking at the object's
 * own bounds, so a gibson-sized trinket and a monument both fill their tile:
 * the feed is about what something looks like, not how big its author said it
 * was. Turning slowly, because a still low-poly object reads as a flat shape
 * and a turning one reads as a thing.
 */

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { BG } from '../lib/palette'
import { TICKS_PER_UNIT, centroid, ticksOf, type ShardModel } from '../lib/shards'
import { ShardMesh } from '../scene/ShardMesh'

/** How far the object reaches from its own centre, in model units. */
function reach(shard: ShardModel): number {
  const c = centroid(shard)
  let far = 0.5
  for (const v of shard.vertices) {
    const t = ticksOf(v)
    for (let a = 0; a < 3; a++) far = Math.max(far, Math.abs(t[a] / TICKS_PER_UNIT - c[a] / TICKS_PER_UNIT))
  }
  return far
}

function Turning({ shard, spin }: { shard: ShardModel; spin: boolean }): JSX.Element {
  const g = useRef<Group>(null)
  const c = useMemo(() => centroid(shard), [shard])
  useFrame((_, dt) => { if (g.current && spin) g.current.rotation.y += dt * 0.45 })
  return (
    <group ref={g}>
      {/* Centred on the object's own middle, so it turns about itself. */}
      <group position={[-c[0] / TICKS_PER_UNIT, -c[1] / TICKS_PER_UNIT, c[2] / TICKS_PER_UNIT]}>
        <ShardMesh shard={shard} lit />
      </group>
    </group>
  )
}

export function Preview({ shard, spin = true, height = 160 }: { shard: ShardModel; spin?: boolean; height?: number }): JSX.Element {
  const far = reach(shard)
  // Far enough that the whole object is in the tile at a 45 degree lens.
  const d = Math.max(2, far * 3.2)
  return (
    <div className="preview" style={{ height }}>
      <Canvas camera={{ fov: 45, position: [d * 0.75, d * 0.6, d * 0.9], near: 0.01, far: d * 40 }} style={{ background: BG }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[6, 8, 6]} intensity={1.1} />
        <Turning shard={shard} spin={spin} />
      </Canvas>
    </div>
  )
}
