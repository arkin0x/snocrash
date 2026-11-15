/**
 * animPreview.ts - the bench's preview of an object's motion, which the
 * MOTION panel drives (ui/AnimEditor.tsx). As ONOSENDAI's store/animPreview.ts.
 *
 *   on        the bench draws the motion whatever the tool (VIEW always does)
 *   playing   on the world clock, as everyone else sees it
 *   paused    held at the moment it was paused at
 *   scrub     at a share 0..1 of the longest motion's cycle, chosen by hand,
 *             so drawn even under reduced motion
 *
 * `point` is the path point being edited, drawn larger on the bench.
 *
 * It outlives the panel, so a phone can close the panel and watch, and stops
 * when the object on the bench changes or the tool changes (an editing tool
 * needs the object at rest under its handles).
 */

import { create } from 'zustand'
import { worldNow } from '../lib/worldClock'
import { useWorkshop } from './useWorkshop'

export interface AnimPreview {
  on: boolean
  playing: boolean
  /** The moment a pause holds, Unix seconds. */
  frozen: number
  /** A share of one cycle chosen by hand, or null. */
  scrub: number | null
  /** The path point being edited: [motion index, point index], or null. */
  point: [number, number] | null
  play: () => void
  pause: () => void
  setScrub: (share: number | null) => void
  setPoint: (point: [number, number] | null) => void
  /** Preview off, back at rest. */
  stop: () => void
}

export const useAnimPreview = create<AnimPreview>((set) => ({
  on: false,
  playing: false,
  frozen: 0,
  scrub: null,
  point: null,
  play: () => set({ on: true, playing: true, scrub: null }),
  pause: () => set({ on: true, playing: false, frozen: worldNow(), scrub: null }),
  setScrub: (share) => set(share === null ? { scrub: null } : { on: true, playing: false, scrub: Math.max(0, Math.min(1, share)) }),
  setPoint: (point) => set({ point }),
  stop: () => set({ on: false, playing: false, scrub: null, point: null }),
}))

// What ends a preview: another object, another tool.
useWorkshop.subscribe((now, before) => {
  if (now.currentId !== before.currentId || now.tool !== before.tool) {
    if (useAnimPreview.getState().on || useAnimPreview.getState().point) useAnimPreview.getState().stop()
  }
})
