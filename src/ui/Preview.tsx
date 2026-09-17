/**
 * Preview.tsx - one object, drawn small, and the one canvas they all share.
 *
 * The feed is a wall of these. Each is a fixed camera looking at the object's
 * own bounds, so a gibson-sized trinket and a monument both fill their tile:
 * the feed is about what something looks like, not how big its author said it
 * was. Turning slowly, because a still low-poly object reads as a flat shape
 * and a turning one reads as a thing.
 *
 * ONE CANVAS, NOT ONE EACH
 *
 * Every tile used to mount its own <Canvas>, and a canvas is a WebGL context,
 * and a browser keeps only so many of those alive. Past its cap it does not
 * refuse the next one: it evicts the OLDEST, whose canvas goes black and then
 * shows the lost-context icon. The oldest tile is the one at the top of the
 * feed, which is the newest object. Measured in Chromium with the cap at 8,
 * which is where phones sit: eight tiles all live, nine lose tile 0, twelve
 * lose tiles 0 to 3, and it made no difference what the objects were. A feed of
 * nine on a phone lost exactly its first card, and every object published
 * after that would have taken one more card off the top (arkinox's Triforce,
 * 2026-09-17, was only first in line).
 *
 * So there is one canvas, PreviewStage, laid over the feed, and each Preview
 * is a drei View: an ordinary div in the page whose contents that one canvas
 * draws, scissored to the div's rectangle each frame and skipped while it is
 * off screen. Any number of tiles costs one context, and the shaders compile
 * once instead of once per tile.
 */

import { Canvas, useFrame } from '@react-three/fiber'
import { PerspectiveCamera, View } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { TICKS_PER_UNIT, centroid, ticksOf, type ShardModel } from 'sno-core/shards'
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

/**
 * The one canvas every Preview on screen is drawn by. Render it once, beside
 * the scrolling list rather than inside it, so it stays put while the tiles
 * move under it. Transparent, so each tile's own background shows through
 * wherever there is no object, and deaf to the pointer, so every button under
 * it still works.
 */
export function PreviewStage(): JSX.Element {
  return (
    <div className="preview-stage" aria-hidden>
      {/* pointerEvents on the Canvas itself, not only on the wrapper above.
          react-three-fiber writes `pointer-events: auto` INLINE on the div it
          wraps the canvas in, and an explicit value on a child beats one it
          would otherwise inherit, so .preview-stage's `none` stopped at that
          div. The stage covers the whole feed, so for as long as that held,
          every tap on the feed landed on this canvas: the tiles, their remix,
          copy and download buttons, and REFRESH. Canvas merges `style` into
          that same div, which is the one place the value actually sticks. */}
      <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 2]} style={{ pointerEvents: 'none' }}>
        <View.Port />
      </Canvas>
    </div>
  )
}

export function Preview({ shard, spin = true, height = 160, onOpen }: {
  shard: ShardModel
  spin?: boolean
  height?: number
  /** When given, the preview is a button that opens the object. */
  onOpen?: () => void
}): JSX.Element {
  const far = reach(shard)
  // Far enough that the whole object is in the tile at a 45 degree lens.
  const d = Math.max(2, far * 3.2)
  // The View is a real div in the page (the shared canvas above it ignores the
  // pointer), so it can be the button itself: the whole picture is the target.
  const open = onOpen
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': `Open ${shard.name} in the workshop`,
        title: `Open ${shard.name}`,
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } },
      }
    : {}
  return (
    <View className={`preview${onOpen ? ' preview--open' : ''}`} style={{ height }} {...open}>
      {/* Each tile has its own camera: a default one belongs to the shared
          canvas and would frame every object from the same distance. Pointed
          at the origin by hand, because a camera made here is not aimed the
          way the canvas's own default camera is. */}
      <PerspectiveCamera
        makeDefault
        fov={45}
        near={0.01}
        far={d * 40}
        position={[d * 0.75, d * 0.6, d * 0.9]}
        onUpdate={(cam) => cam.lookAt(0, 0, 0)}
      />
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 8, 6]} intensity={1.1} />
      <Turning shard={shard} spin={spin} />
    </View>
  )
}
