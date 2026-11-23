/**
 * benchReach.ts: how far the bench camera may pull back, and how deep it
 * sees, for the grid on it. The grid half of ONOSENDAI's benchReach.ts.
 *
 * The orbit's reach was a flat 60 units and the far plane a flat 200, which
 * fits a grid about 15 units a side at the bench's 50 degree lens. GRID SIZE
 * now runs to 4,096 (DECK-0003 §1.8, owner ruling 2026-11-23), so the reach
 * is whatever fits the whole grid, with a little room, and never less than
 * the 60 it was; the far plane goes out past the grid, and the near plane
 * out with the distance so the depth buffer keeps its precision. The default
 * grid (8) on a screen at least as wide as it is tall keeps the 60 and both
 * planes exactly; a phone held upright may pull back a few units more, so the
 * grid fits across its narrow side.
 *
 * Pure, so the numbers are tested without a canvas (benchReach.test.ts).
 */

/** The bench's reach before it knew the grid's size: a small grid keeps it. */
export const MIN_REACH = 60
/** The camera's near and far planes as the bench opens. */
export const BASE_NEAR = 0.05
export const BASE_FAR = 200
/** Room round a fitted grid: it fills the narrower side of the view to about 87%. */
const FIT_MARGIN = 1.15

/** A sphere in render units. */
export interface Sphere { center: [number, number, number]; radius: number }

/**
 * The sphere round the grid on the bench: GRID SIZE each side of the origin,
 * and the half unit the outermost lines are drawn past it, lying in its plane
 * (0 faces X, 1 the floor, 2 faces Z) at the level, in units. Centred as the
 * bench draws it, with render Z mirrored (Bench Grid).
 */
export function gridSphere(extent: number, plane: number, level: number): Sphere {
  const center: [number, number, number] = plane === 0 ? [level, 0, 0] : plane === 2 ? [0, 0, -level] : [0, level, 0]
  return { center, radius: Math.SQRT2 * (Math.max(0, extent) + 0.5) }
}

/**
 * The radius round the orbit's target that holds the whole sphere: the
 * camera turns about its target, not the grid's centre (a pan moves the
 * target), so the sphere grows by how far that target stands off, but by no
 * more than its own radius. Unclamped it runs away: a pan moves the target
 * farther the farther out the camera is, so each pinch at the limit would
 * raise the limit again, without end (ONOSENDAI, review of #636).
 */
export function reachRadius(sphere: Sphere, target: { x: number; y: number; z: number }): number {
  const [x, y, z] = sphere.center
  return sphere.radius + Math.min(sphere.radius, Math.hypot(target.x - x, target.y - y, target.z - z))
}

/**
 * The distance from a sphere's centre at which it just fits the view, with a
 * little room round it: in the narrower of the vertical field of view and the
 * horizontal one the aspect makes of it, so a phone held upright, whose width
 * is the narrow side, fits it across as a desktop fits it top to bottom.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 360
  const h = Math.atan(Math.tan(v) * aspect)
  const half = Math.min(v, h)
  return (Math.max(0, radius) / Math.sin(half)) * FIT_MARGIN
}

/** How far the orbit may pull back to see a grid of `radius` whole, never less than the bench always allowed. */
export function reachFor(radius: number, fovDeg: number, aspect: number): number {
  return Math.max(MIN_REACH, fitDistance(radius, fovDeg, aspect))
}

/**
 * The orbit's max distance from what fits and where the camera stands now.
 * It grows with the grid at once; when the grid shrinks it never drops below
 * the camera's own distance, since the controls would clamp the camera in to
 * it on their next update and yank the view out from under you. It comes in
 * the rest of the way as you do.
 */
export function nextMaxDistance(fit: number, distance: number): number {
  return Math.max(fit, distance)
}

/**
 * The near and far planes for a camera `distance` from its target with a
 * sphere `reach` round that target: far enough past the target to keep the
 * whole grid in front of the far plane, and the near plane pulled out in
 * proportion once the camera stands farther than the bench always allowed.
 * Within that distance the near plane is what the bench opened with, and the
 * far plane is too while the grid is small (up to about 25 units a side), so a
 * small grid draws exactly as it did.
 */
export function clipPlanes(distance: number, reach: number): { near: number; far: number } {
  return {
    near: Math.max(BASE_NEAR, (distance * BASE_NEAR) / MIN_REACH),
    far: Math.max(BASE_FAR, (distance + reach) * 1.5),
  }
}
