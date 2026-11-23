/**
 * glowRows.ts - the workshop's POINT SIZE, GLOW, RADIUS and GLOW STRENGTH rows
 * (DECK-0003 §1.15 and §1.16, owner rulings 2026-11-15), as plain data and
 * steps a test can read. The rows themselves are in ui/Workshop.tsx.
 *
 * Sizes are in ticks of the object's own lattice (120 to a unit) and shown in
 * units, as every other distance in this workshop is (LEVEL, the selected
 * point). All four rows are always there; they are greyed unless MODE is
 * POINTS, and RADIUS and GLOW STRENGTH are greyed while GLOW is OFF.
 */

import { TICKS_PER_UNIT, unitsLabel, type ShardModel } from 'sno-core/shards'
import { GLOW_REACH, readGlow, readPointSize, suggestGlowStyle, type Glow, type GlowStyle } from 'sno-core/glow'

/** The steps of POINT SIZE and RADIUS: a twentieth of a unit. */
export const SIZE_STEP = 6

/** POINT SIZE's slider reaches 4 units across; − and + go on to the position bound (GLOW_REACH, 4,096 units). */
export const POINT_SLIDER_MAX = 4 * TICKS_PER_UNIT

/** RADIUS's slider reaches 8 units; − and + go on to the position bound (GLOW_REACH, 4,096 units). */
export const RADIUS_SLIDER_MAX = 8 * TICKS_PER_UNIT

/** GLOW STRENGTH's − and + step in fives, as OPACITY's do; the slider moves by one. */
export const STRENGTH_STEP = 5

/**
 * What POINT SIZE's − and + start from when the object has none: 36 ticks,
 * 0.3 of a unit, the width the default disc asks for in world units (pointDisc
 * SHARD_POINTS size) before it is held between 1.6 and 10 pixels on screen. On
 * screen the default can look smaller or larger than this; it is a starting
 * point, not the same size.
 */
export const AUTO_POINT_TICKS = 36

/** A glow's radius and strength when it is first turned on: one unit, 40%. */
export const GLOW_START = { radius: TICKS_PER_UNIT, strength: 40 } as const

/** Which rows can be used for this object: all of them only in POINTS mode, RADIUS and GLOW STRENGTH only with a glow. */
export function glowRowState(s: Pick<ShardModel, 'mode' | 'extra'>): { points: boolean; glowOn: boolean } {
  const points = s.mode === 'points'
  return { points, glowOn: points && readGlow(s.extra?.glow) !== undefined }
}

/** The point size the object carries, in ticks, in any mode (kept in SOLID and LINES), or undefined for AUTO. */
export function pointSizeOf(s: Pick<ShardModel, 'extra'>): number | undefined {
  return readPointSize(s.extra?.pointsize)
}

/** The glow the object carries, in any mode, or undefined for OFF. */
export function glowOf(s: Pick<ShardModel, 'extra'>): Glow | undefined {
  return readGlow(s.extra?.glow)
}

/** A tick distance as the rows show it, in units: "2/5", "1 1/2". AUTO when there is none. */
export function sizeLabel(ticks: number | undefined): string {
  return ticks === undefined ? 'AUTO' : unitsLabel(ticks)
}

/** Up to here, 64 units, − and + step in twentieths of a unit, as they always have. */
export const FINE_STEPS_UP_TO = 64 * TICKS_PER_UNIT

/**
 * Past 64 units the steps double to the bound: 64, 128 ... 2,048 units, then
 * GLOW_REACH (4,096 units since 2026-11-23, DECK-0003 §1.8), as ONOSENDAI's
 * ladders do. In twentieths that would be 80,000 presses; this way one press
 * never jumps from 64 units to 4,096 either.
 */
export const PAST_64 = [7680, 15360, 30720, 61440, 122880, 245760, GLOW_REACH] as const

/**
 * One step of a tick distance in `dir`, between `min` and the position bound
 * (GLOW_REACH): twentieths of a unit up to 64 units, doubling past that. A
 * value off the steps goes to the next step in the direction asked, as the
 * OPACITY stepper does.
 */
export function stepTicks(current: number, dir: -1 | 1, min: number): number {
  let next: number
  if (dir > 0 && current >= FINE_STEPS_UP_TO) next = PAST_64.find((x) => x > current) ?? GLOW_REACH
  else if (dir < 0 && current > FINE_STEPS_UP_TO) next = [...PAST_64].reverse().find((x) => x < current) ?? FINE_STEPS_UP_TO
  else next = dir > 0 ? Math.floor(current / SIZE_STEP) * SIZE_STEP + SIZE_STEP : Math.ceil(current / SIZE_STEP) * SIZE_STEP - SIZE_STEP
  return Math.min(GLOW_REACH, Math.max(min, next))
}

/** One step of POINT SIZE from what the object carries; from AUTO it starts at the size the points draw at now. */
export function stepPointSize(current: number | undefined, dir: -1 | 1): number {
  return stepTicks(current ?? AUTO_POINT_TICKS, dir, 0)
}

/** One step of GLOW STRENGTH, 1 to 100. */
export function stepStrength(current: number, dir: -1 | 1): number {
  const next = dir > 0 ? Math.floor(current / STRENGTH_STEP) * STRENGTH_STEP + STRENGTH_STEP : Math.ceil(current / STRENGTH_STEP) * STRENGTH_STEP - STRENGTH_STEP
  return Math.min(100, Math.max(1, next))
}

/** A whole number of ticks from a slider or a typed value, inside the bounds, or undefined when it is not a number. */
export function clampTicks(raw: number, min: number): number | undefined {
  if (!Number.isFinite(raw)) return undefined
  return Math.min(GLOW_REACH, Math.max(min, Math.round(raw)))
}

/** The mean colour of the object's points, or undefined when it has none. */
export function meanColor(s: Pick<ShardModel, 'vertices'>): [number, number, number] | undefined {
  if (s.vertices.length === 0) return undefined
  const sum = [0, 0, 0]
  for (const v of s.vertices) for (let i = 0; i < 3; i++) sum[i] += v.c[i]
  return [sum[0] / s.vertices.length, sum[1] / s.vertices.length, sum[2] / s.vertices.length]
}

/**
 * The style the GLOW row pre-picks while it is OFF: LIGHT for bright points
 * and FOG for dark ones (sno-core suggestGlowStyle), read from the mean colour
 * of the object's points, since painting the points is what colours the glow.
 * An object with no points yet goes by the colour in hand.
 */
export function suggestedStyle(s: Pick<ShardModel, 'vertices'>, inHand: [number, number, number]): GlowStyle {
  return suggestGlowStyle(meanColor(s) ?? inHand)
}
