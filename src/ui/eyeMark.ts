/**
 * eyeMark.ts - where the bench shows an object's avatar eye (DECK-0003 §1.17).
 *
 * An object worn as an avatar is seen out of from its eye: the `eye` its
 * author chose (CHOSEN), or one eighth of its height below its top, straight
 * above its origin (AUTO), which moves as the shape is edited. snocrash has
 * no editor for the eye; it keeps one that came in a payload, and while the
 * FIRST-PERSON EYE switch is on, it marks where the eye is, so a shard built
 * here for an avatar shows where its wearer would look from.
 *
 * The label is one small sprite, a ring with a dot and the word, drawn once
 * per word on a canvas and shared. Null where there is no document (tests,
 * workers).
 */

import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'
import { drawnEye, eyeChosen } from 'sno-core/eye'
import { TICKS_PER_UNIT, type ShardModel } from 'sno-core/shards'

export type EyeWord = 'AUTO' | 'CHOSEN'

/**
 * Whether the bench draws the eye marker: the switch is on, the object has
 * something in it (vertices or placements), and nothing is moving under it.
 * During a drag the label could cover the handle being aimed at; during
 * motion (VIEW or the MOTION preview) the object moves and the marker would
 * stay at rest, so it goes until both stop.
 */
export function eyeMarkShown(o: { on: boolean; shard: Pick<ShardModel, 'vertices' | 'parts'> | null | undefined; dragging: boolean; moving: boolean }): boolean {
  if (!o.on || !o.shard || o.dragging || o.moving) return false
  return o.shard.vertices.length > 0 || (o.shard.parts?.length ?? 0) > 0
}

/**
 * Where the eye marker sits on the bench (render units) and which word it
 * carries. `drawnEye` is in the payload frame (version 2: +Z toward the
 * viewer), which over 120 is already the render frame, so it is drawn as it
 * is and never through `toRender`, which is for the model's own frame
 * (sno-core eyeModelTicks).
 */
export function eyeMark(s: Pick<ShardModel, 'vertices'> & Partial<Pick<ShardModel, 'extra'>>): { at: [number, number, number]; word: EyeWord } {
  const [x, y, z] = drawnEye(s)
  return { at: [x / TICKS_PER_UNIT, y / TICKS_PER_UNIT, z / TICKS_PER_UNIT], word: eyeChosen(s) ? 'CHOSEN' : 'AUTO' }
}

/** The label's height in CSS pixels on screen; its width follows the word. */
export const EYE_LABEL_PX = 16
/** The label's opacity: half, so a handle dot behind it still shows through. */
export const EYE_LABEL_OPACITY = 0.5

/** A drawn label: its texture, its width in CSS pixels, and the ring's centre across it as a share of that width (the sprite's anchor, so the ring sits on the eye). */
export interface EyeLabel { texture: Texture; width: number; anchor: number }

/** Draw the label for `word` on `canvas`; null when the canvas has no 2D context. */
export function drawEyeLabel(word: EyeWord, canvas: HTMLCanvasElement): EyeLabel | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const h = EYE_LABEL_PX * 4
  const text = `EYE ${word}`
  const font = `${Math.round(h * 0.62)}px ui-monospace, Menlo, Consolas, monospace`
  ctx.font = font
  const r = h * 0.36
  const gap = h * 0.3
  const w = Math.ceil(h + gap + ctx.measureText(text).width + h * 0.2)
  // Resizing a canvas resets its context, so the font is set again below.
  canvas.width = w
  canvas.height = h
  // White, as the size reference is drawn; a dark edge so it reads on a light face.
  const edge = 'rgba(5,7,13,0.9)'
  ctx.lineWidth = h * 0.09
  ctx.strokeStyle = edge
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(h / 2, h / 2, r + ctx.lineWidth / 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(h / 2, h / 2, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(h / 2, h / 2, r * 0.38, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.lineWidth = h * 0.12
  ctx.strokeStyle = edge
  ctx.strokeText(text, h + gap, h / 2)
  ctx.fillText(text, h + gap, h / 2)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return { texture, width: (w / h) * EYE_LABEL_PX, anchor: h / 2 / w }
}

const cache = new Map<EyeWord, EyeLabel | null>()

/** The shared label for `word`, drawn on first use. */
export function eyeLabel(word: EyeWord): EyeLabel | null {
  if (cache.has(word)) return cache.get(word) ?? null
  const label = typeof document === 'undefined' ? null : drawEyeLabel(word, document.createElement('canvas'))
  cache.set(word, label)
  return label
}
