/**
 * animMotion.tsx - an object's `anim` drawn on the world clock (DECK-0003
 * §1.14; sno-core/anim for the motions, sno-core/animClock for the ease,
 * lib/worldClock.ts for the clock). ShardMesh mounts AnimGroups only for an
 * object that moves, so a still one pays nothing, and a placed object moves
 * in its own frame inside a parent that carries it.
 *
 * Each frame: one shared clock reading, each motion's phase, the ease when
 * the clock's correction changes, the motions composed into one matrix in the
 * render frame, and that matrix written into a group above the mesh. Nothing
 * is allocated per frame.
 *
 * Under reduced motion the object is drawn as written, its rest pose, unless
 * the bench's preview is scrubbed (a time the viewer chose by hand).
 * ONOSENDAI's scene/animMotion.ts is the same, with its world's pose and
 * region walls around it.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { composeRender, motionPose, newPose, type Motion } from 'sno-core/anim'
import { newPhaseState, stepPhases, type ClockReading } from 'sno-core/animClock'
import { noteMoving, readClock } from '../lib/worldClock'

let reducedQuery: MediaQueryList | null | undefined
let reduced = false
/** Whether the viewer prefers reduced motion: one media query and one listener for the whole page. */
export function reducedMotionNow(): boolean {
  if (reducedQuery === undefined) {
    try { reducedQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null } catch { reducedQuery = null }
    reduced = reducedQuery?.matches ?? false
    reducedQuery?.addEventListener?.('change', () => { reduced = reducedQuery?.matches ?? false })
  }
  return reduced
}

/**
 * A canvas's own say over the clock its moving objects read: the bench's
 * preview (play, pause, scrub). Given the frame's shared reading, it returns
 * the reading to draw by. Absent everywhere else.
 */
export type ClockOverride = (shared: ClockReading) => ClockReading
export const AnimClock = createContext<ClockOverride | null>(null)

/** The group above a moving object, and the per-frame work that moves it. */
export function AnimGroups({ motions, children }: { motions: readonly Motion[]; children: ReactNode }): JSX.Element {
  const group = useRef<Group>(null)
  const clock = useContext(AnimClock)
  const n = motions.length
  const st = useMemo(() => newPhaseState(n), [n, motions])
  const poses = useMemo(() => Array.from({ length: n }, newPose), [n])
  useEffect(() => { noteMoving(1); return () => noteMoving(-1) }, [])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const r = readClock(state.clock, state.clock.elapsedTime)
    stepPhases(motions, clock ? clock(r) : r, reducedMotionNow(), st)
    if (st.held) g.matrix.identity()
    else {
      for (let i = 0; i < n; i++) motionPose(motions[i], st.shown[i], poses[i])
      composeRender(poses, n, g.matrix.elements)
    }
    g.matrixWorldNeedsUpdate = true
  })
  return <group ref={group} matrixAutoUpdate={false}>{children}</group>
}
