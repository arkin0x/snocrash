/**
 * GlowRows.tsx - POINT SIZE, GLOW, RADIUS and GLOW STRENGTH, the four rows
 * under DRAW and OPACITY in MENU (DECK-0003 §1.15 and §1.16, owner rulings
 * 2026-11-15, parity with ONOSENDAI's SHARD sheet).
 *
 * All four are always there, so nothing below them moves. They are greyed but
 * keep their values unless MODE is POINTS, and RADIUS and GLOW STRENGTH are
 * greyed while GLOW is OFF. Sliders show on the bench as they move, and one
 * drag is one undo step; − and + repeat while held, as the other steppers do.
 * There is no color picker: painting the points colors the glow.
 */

import type { ShardModel } from 'sno-core/shards'
import { CloudFog, Sun } from 'lucide-react'
import { useRepeatable } from '../hooks/useRepeatable'
import { useWorkshop } from '../store/useWorkshop'
import {
  AUTO_POINT_TICKS,
  POINT_SLIDER_MAX,
  RADIUS_SLIDER_MAX,
  SIZE_STEP,
  clampTicks,
  glowOf,
  glowRowState,
  pointSizeOf,
  sizeLabel,
  stepPointSize,
  stepStrength,
  stepTicks,
  suggestedStyle,
} from '../lib/glowRows'
import type { GlowStyle } from 'sno-core/glow'

const w = () => useWorkshop.getState()

/**
 * What ends a slider's drag, so the next change is an undo step of its own.
 * The pointer is captured on the press and a release anywhere on the page
 * ends it too, so a finger lifted off the slider never leaves the drag open.
 */
const endDrag = {
  onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => {
    w().endLive()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not every browser captures on a range */ }
    const end = (): void => {
      w().endLive()
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  },
  onPointerUp: () => w().endLive(),
  onPointerCancel: () => w().endLive(),
  onLostPointerCapture: () => w().endLive(),
  onKeyUp: () => w().endLive(),
  onBlur: () => w().endLive(),
}

const STYLE_ICON = { light: Sun, fog: CloudFog } as const
const STYLE_TIP: Record<GlowStyle, string> = {
  light: 'Adds the points\' color to what is behind, like sunlight',
  fog: 'Lays the points\' color over what is behind, like mist or smog',
}

export function GlowRows({ shard, inHand }: { shard: ShardModel; inHand: [number, number, number] }): JSX.Element {
  const bind = useRepeatable()
  const memory = useWorkshop((s) => s.glowMemory)
  const { points, glowOn } = glowRowState(shard)
  const size = pointSizeOf(shard)
  const glow = glowOf(shard)
  const suggested = suggestedStyle(shard, inHand)
  // What RADIUS and GLOW STRENGTH show while GLOW is OFF: what it will turn on with.
  const radius = glow?.radius ?? memory.radius
  const strength = glow?.strength ?? memory.strength
  const setRadius = (r: number, live = false): void => { const g = glowOf(w().current() ?? shard); if (g) w().setGlow({ ...g, radius: r }, live ? 'radius' : undefined) }
  const setStrength = (p: number, live = false): void => { const g = glowOf(w().current() ?? shard); if (g) w().setGlow({ ...g, strength: p }, live ? 'strength' : undefined) }
  const turnOn = (style: GlowStyle): void => { w().setGlow({ style, radius: glow?.radius ?? memory.radius, strength: glow?.strength ?? memory.strength }) }
  const current = (): ShardModel => w().current() ?? shard

  return (
    <div className="ws__glow" role="group" aria-label="Point size and glow">
      <div className={`workshop__row ${points ? '' : 'is-dim'}`} role="group" aria-label="Point size">
        <span className="workshop__label">POINT SIZE</span>
        <button className={`workshop__mode ${size === undefined ? 'is-on' : ''}`} aria-pressed={size === undefined} disabled={!points} onClick={() => w().setPointSize(undefined)} title="The size points draw at when the object sets none">AUTO</button>
        <button className="workshop__btn" {...bind(() => w().setPointSize(stepPointSize(pointSizeOf(current()), -1)))} disabled={!points || size === 0} aria-label="Smaller points" title="Smaller points">−</button>
        <input
          className="ws__slider"
          type="range"
          min={0}
          max={POINT_SLIDER_MAX}
          step={SIZE_STEP}
          value={Math.min(size ?? AUTO_POINT_TICKS, POINT_SLIDER_MAX)}
          disabled={!points}
          aria-label="Point size"
          onChange={(e) => { const t = clampTicks(Number(e.currentTarget.value), 0); if (t !== undefined) w().setPointSize(t, true) }}
          {...endDrag}
        />
        <button className="workshop__btn" {...bind(() => w().setPointSize(stepPointSize(pointSizeOf(current()), 1)))} disabled={!points} aria-label="Larger points" title="Larger points">+</button>
        <span className="workshop__value ws__glow-value" title="Across, in units of this object's grid. 0 draws no points.">{sizeLabel(size)}</span>
      </div>
      <div className={`workshop__row ${points ? '' : 'is-dim'}`}>
        <span className="workshop__label">GLOW</span>
        <div className="workshop__modes" role="group" aria-label="Glow">
          <button className={`workshop__mode ${glow ? '' : 'is-on'}`} aria-pressed={!glow} disabled={!points} onClick={() => w().setGlow(undefined)}>OFF</button>
          {(['light', 'fog'] as const).map((style) => {
            const Icon = STYLE_ICON[style]
            const on = glow?.style === style
            const pick = !glow && style === suggested
            return (
              <button
                key={style}
                className={`workshop__mode workshop__tool ${on ? 'is-on' : ''} ${pick ? 'is-suggested' : ''}`}
                aria-pressed={on}
                disabled={!points}
                title={pick ? `${STYLE_TIP[style]}. Suggested for these colors.` : STYLE_TIP[style]}
                onClick={() => turnOn(style)}
              >
                <Icon size={12} strokeWidth={2.25} aria-hidden />{style.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>
      <div className={`workshop__row ${glowOn ? '' : 'is-dim'}`} role="group" aria-label="Glow radius">
        <span className="workshop__label">RADIUS</span>
        <button className="workshop__btn" {...bind(() => { const g = glowOf(current()); if (g) setRadius(stepTicks(g.radius, -1, 1)) })} disabled={!glowOn || radius <= 1} aria-label="Smaller glow" title="Smaller glow">−</button>
        <input
          className="ws__slider"
          type="range"
          min={SIZE_STEP}
          max={RADIUS_SLIDER_MAX}
          step={SIZE_STEP}
          value={Math.min(radius, RADIUS_SLIDER_MAX)}
          disabled={!glowOn}
          aria-label="Glow radius"
          onChange={(e) => { const t = clampTicks(Number(e.currentTarget.value), 1); if (t !== undefined) setRadius(t, true) }}
          {...endDrag}
        />
        <button className="workshop__btn" {...bind(() => { const g = glowOf(current()); if (g) setRadius(stepTicks(g.radius, 1, 1)) })} disabled={!glowOn} aria-label="Larger glow" title="Larger glow">+</button>
        <span className="workshop__value ws__glow-value" title="How far the glow reaches from each point, in units of this object's grid">{sizeLabel(radius)}</span>
      </div>
      <div className={`workshop__row ${glowOn ? '' : 'is-dim'}`} role="group" aria-label="Glow strength">
        <span className="workshop__label">GLOW STRENGTH</span>
        <button className="workshop__btn" {...bind(() => { const g = glowOf(current()); if (g) setStrength(stepStrength(g.strength, -1)) })} disabled={!glowOn || strength <= 1} aria-label="Fainter glow" title="Fainter glow">−</button>
        <input
          className="ws__slider"
          type="range"
          min={1}
          max={100}
          step={1}
          value={strength}
          disabled={!glowOn}
          aria-label="Glow strength"
          onChange={(e) => { const p = Math.round(Number(e.currentTarget.value)); if (p >= 1 && p <= 100) setStrength(p, true) }}
          {...endDrag}
        />
        <button className="workshop__btn" {...bind(() => { const g = glowOf(current()); if (g) setStrength(stepStrength(g.strength, 1)) })} disabled={!glowOn || strength >= 100} aria-label="Stronger glow" title="Stronger glow">+</button>
        <span className="workshop__value ws__glow-value" title="How strong the glow is at each point. OPACITY does not change it.">{strength}%</span>
      </div>
      <span className="workshop__unit-size ws__glow-note">POINTS only. Painting the points colors the glow.</span>
    </div>
  )
}
