/**
 * Compass3D - which way X, Y and Z are pointing, live.
 *
 * Three arrows in their own tiny scene, with a camera that copies the bench
 * camera's orientation every frame. It follows a free orbit rather than only
 * the quarter turns, so it answers the question a still icon cannot: after
 * dragging the view around, which way is up, and which way does a nudge send
 * a point.
 *
 * The labels are not in the 3D scene. Each arrow tip is projected to screen
 * space and an ordinary span is placed there, so the letters stay upright and
 * legible at any angle instead of turning edge-on and vanishing.
 *
 * This is ONOSENDAI's compass with its world taken out. There, the arrows are
 * drawn along the cyberspace axes, which the scene permutes as the view turns,
 * so the component asks a store which permutation is current. The bench never
 * permutes anything: X is right, Y is up, Z is toward the viewer, fixed, and
 * the only thing that moves is the camera. So the directions are handed in and
 * there is no store to consult.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { Quaternion, Vector3 } from 'three'

interface LabelPosition {
  axis: 'x' | 'y' | 'z'
  screen: { x: number; y: number }
}

const CAMERA_DISTANCE = 5
const ARROW_LENGTH = 1.2
const ARROW_THICKNESS = 0.08
const CONE_RADIUS = ARROW_THICKNESS * 2
const CONE_HEIGHT = 0.3
const LABEL_OFFSET = 0.2

/**
 * The frame the compass names: X right, Y up, Z toward the viewer.
 *
 * This is glTF's frame and three.js's, and it is the frame an object is
 * published in, so the arrows say what a reader of the file will find.
 * ONOSENDAI's compass points its Z arrow the other way because its labels name
 * cyberspace axes, where +Z is away from the viewer; this app has no cyberspace
 * to name.
 */
export const BENCH_DIRS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }

const UP = new Vector3(0, 1, 0)

function Arrow({ dir, color }: { dir: Vector3; color: string }): JSX.Element {
  const q = useMemo(() => new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()), [dir])
  return (
    <group quaternion={q}>
      <mesh position={[0, ARROW_LENGTH / 2, 0]}>
        <cylinderGeometry args={[ARROW_THICKNESS, ARROW_THICKNESS, ARROW_LENGTH, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, ARROW_LENGTH, 0]}>
        <coneGeometry args={[CONE_RADIUS, CONE_HEIGHT, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
    </group>
  )
}

type Dirs = Record<'x' | 'y' | 'z', Vector3>

function CompassScene({ onLabelsUpdate, pose, dirs }: { onLabelsUpdate: (labels: LabelPosition[]) => void; pose: Quaternion; dirs: Dirs }): JSX.Element {
  const { camera, size } = useThree()

  useFrame(() => {
    camera.quaternion.copy(pose)
    camera.position.copy(new Vector3(0, 0, CAMERA_DISTANCE).applyQuaternion(pose))

    const labels: LabelPosition[] = (['x', 'y', 'z'] as const).map((axis) => {
      const world = dirs[axis].clone().multiplyScalar(ARROW_LENGTH + LABEL_OFFSET)
      const projected = world.project(camera)
      return {
        axis,
        screen: {
          x: (projected.x * 0.5 + 0.5) * size.width,
          y: (-projected.y * 0.5 + 0.5) * size.height,
        },
      }
    })
    onLabelsUpdate(labels)
  })

  return (
    <group>
      <Arrow dir={dirs.x} color="#ff4444" />
      <Arrow dir={dirs.y} color="#44ff44" />
      <Arrow dir={dirs.z} color="#4488ff" />
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
    </group>
  )
}

export function Compass3D({ onTap, pose, dirs = BENCH_DIRS }: { onTap?: () => void; pose: Quaternion; dirs?: Dirs }): JSX.Element {
  const [labels, setLabels] = useState<LabelPosition[]>([])

  // Every frame recomputes the label positions, and a fresh array each time
  // would re-render on every one of them. Half a pixel is below what anyone
  // can see, so anything smaller keeps the previous array and paints nothing.
  const handleLabelsUpdate = (next: LabelPosition[]): void => {
    setLabels((prev) => (
      prev.length === next.length
      && prev.every((p, i) => Math.abs(p.screen.x - next[i].screen.x) < 0.5 && Math.abs(p.screen.y - next[i].screen.y) < 0.5)
        ? prev
        : next
    ))
  }

  return (
    <div
      className={`compass-3d compass-3d--bench${onTap ? ' compass-3d--tappable' : ''}`}
      onPointerDown={onTap ? (e) => { e.preventDefault(); e.stopPropagation(); onTap() } : undefined}
      role={onTap ? 'button' : undefined}
      aria-label={onTap ? 'Grid controls' : 'Which way X, Y and Z point'}
    >
      <Canvas camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 40 }} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <CompassScene onLabelsUpdate={handleLabelsUpdate} pose={pose} dirs={dirs} />
      </Canvas>
      {labels.map(({ axis, screen }) => (
        <span key={axis} className={`compass-label compass-label--${axis}`} style={{ left: `${screen.x}px`, top: `${screen.y}px` }}>
          {axis.toUpperCase()}
        </span>
      ))}
    </div>
  )
}
