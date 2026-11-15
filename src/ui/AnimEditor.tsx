/**
 * AnimEditor.tsx - the MOTION panel: the editor for an object's `anim`
 * (DECK-0003 §1.14). sno-core/animEdit holds every rule, this only draws
 * them; ONOSENDAI's workshop/AnimEditor.tsx is the same editor in gibsons.
 * arkinox, 2026-11-14: "i don't want to ship animations without shipping
 * workshop tools to create and edit animations".
 *
 *   - ADD: presets with familiar names (SPIN, BOB, PENDULUM, BACK AND FORTH,
 *     ELEVATOR, FERRIS WHEEL, FOLLOW PATH) that write the canonical motions,
 *     sized for the object. The names live here, never in the data.
 *   - The list: up to four motions in order (the first innermost), each with
 *     move up, move down and remove, and its own controls: AXIS, SPEED in
 *     turns a minute (stored as c cycles every b seconds), REVERSE, its
 *     amount, REST for an elevator, START (the phase), and a path's points.
 *   - PREVIEW: PLAY, PAUSE, STOP and a scrub through one cycle, on the bench.
 *
 * Distances show in grid units, in the published frame the bench's axes and
 * the point readout use (+Z toward you), which is the field's own frame, so
 * nothing is negated. Every edit goes through the workshop's setAnim, one
 * undoable step that only ever stores what a reader can read. Numbers typed
 * into a field commit on Enter or when the field is left, not on each key.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Pause, Play, Repeat2, Square, X } from 'lucide-react'
import { TICKS_PER_UNIT, type ShardModel } from 'sno-core/shards'
import { MAX_MOTIONS, PATH_MAX, readAnim, type Motion } from 'sno-core/anim'
import {
  addPoint, addPreset, amountKind, amountOf, listOf, mayFlicker, MOTION_NAMES, moveMotion, movePoint, objectReach, perMinute, pointsOf, PRESETS,
  rawOf, removeMotion, removePoint, reverse, reversible, setAmount, setAxis, setPhase, setPoint, setRest, setSpeed, showNumber, SPEED_STEPS, stepSpeed,
  type Edited, type PresetId, type Waypoint,
} from 'sno-core/animEdit'
import { reducedMotionNow } from '../scene/animMotion'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { useAnimPreview } from '../store/animPreview'
import { useWorkshop } from '../store/useWorkshop'

const AXIS_NAMES = ['X', 'Y', 'Z'] as const
/** One press of a distance stepper: a quarter of a grid unit, in ticks. */
const DISTANCE_STEP = TICKS_PER_UNIT / 4
const units = (ticks: number): string => showNumber(ticks / TICKS_PER_UNIT)
const ticks = (u: number): number => Math.round(u * TICKS_PER_UNIT)

/** The raw field on a model: top level first, then where sno-core carries it. */
function rawAnim(s: ShardModel | null): unknown {
  return s ? (s as { anim?: unknown }).anim ?? s.extra?.anim : undefined
}

/** A number typed into a field, committed on Enter or blur; Escape puts the shown value back. */
function NumberField({ value, onCommit, label, width = '7ch', onFocus, signed = false }: { value: string; onCommit: (n: number) => void; label: string; width?: string; onFocus?: () => void; signed?: boolean }): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  // A stepper changed the value under a half-typed draft: the draft goes, so leaving the field cannot undo the press.
  const seen = useRef(value)
  useEffect(() => { if (seen.current !== value) { seen.current = value; setText(null) } }, [value])
  const commit = (): void => {
    if (text === null) return
    // A comma is a decimal mark too.
    const n = Number(text.trim().replace(',', '.'))
    setText(null)
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(n)
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>): void => {
    // The bench nudges the selection with the arrows and Escape closes the panel: these are the field's.
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); setText(null) }
  }
  return (
    <input
      className="ws__anim-num"
      style={{ flex: `0 0 ${width}`, width, minWidth: 0 }}
      // A phone's decimal keypad has no minus: a value that may be negative gets the full keyboard.
      inputMode={signed ? 'text' : 'decimal'}
      aria-label={label}
      value={text ?? value}
      spellCheck={false}
      onFocus={onFocus}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
    />
  )
}

export function AnimEditor(): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const raw = rawAnim(shard)
  const list = Array.isArray(raw) ? listOf(raw) : []
  const preview = useAnimPreview()
  // Scroll-safe: the panel scrolls, and a scroll that starts on a stepper must not change it.
  const bind = useRepeatable({ scrollSafe: true })
  const [note, setNote] = useState<string | null>(null)
  const currentId = useWorkshop((s) => s.currentId)
  const reduced = reducedMotionNow()
  const rail = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  // Another object: the last one's message goes (the preview stops on its own, store/animPreview.ts).
  useEffect(() => { setNote(null) }, [currentId])
  // A key for each card that follows its motion through a reorder, so focus and typing stay with it.
  const keys = useRef<number[]>([])
  const nextKey = useRef(0)
  if (keys.current.length !== list.length) keys.current = list.map(() => nextKey.current++)

  const apply = (e: Edited, keyed?: (k: number[]) => number[]): void => {
    // A reorder or a removal: the point marked on the bench may now be another path's.
    if (keyed) { keys.current = keyed([...keys.current]); useAnimPreview.getState().setPoint(null) }
    useWorkshop.getState().setAnim(e.list.length ? rawOf(e.list) : undefined)
    setNote(e.note ?? null)
  }
  // Read again at the press, so a held stepper works from where it is now.
  const now = (): Motion[] => { const r = rawAnim(useWorkshop.getState().current()); return Array.isArray(r) ? listOf(r) : [] }
  const add = (id: PresetId): void => {
    if (!shard) return
    apply(addPreset(now(), id, objectReach(shard)), (k) => (k.length < MAX_MOTIONS ? [...k, nextKey.current++] : k))
    // Show it at once: picking a preset is asking to see it.
    if (!useAnimPreview.getState().on) useAnimPreview.getState().play()
  }
  const scrubTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    preview.setScrub((clientX - r.left) / r.width)
  }
  // Entries a reader ignores (malformed, unknown, past the fourth): the next edit writes the list without them.
  const ignored = Array.isArray(raw) ? raw.length - readAnim(raw).length : 0
  const share = preview.scrub ?? 0

  return (
    <div className="ws__anim" role="group" aria-label="Motions">
      {list.length > 0 && (
        <div className="workshop__row ws__anim-preview">
          <span className="workshop__label">PREVIEW</span>
          {preview.on && preview.playing
            ? <button className="workshop__btn ws__anim-play" title="Pause the preview" aria-label="Pause" onClick={() => preview.pause()}><Pause size={12} aria-hidden /> PAUSE</button>
            : <button className="workshop__btn ws__anim-play" title="Play the preview" aria-label="Play" onClick={() => preview.play()}><Play size={12} aria-hidden /> PLAY</button>}
          {/* Kept in place while off, so PLAY and the scrub never move. */}
          <button className="workshop__btn" style={preview.on ? undefined : { visibility: 'hidden' }} tabIndex={preview.on ? 0 : -1} title="Stop the preview and go back to rest" aria-label="Stop" onClick={() => preview.stop()}><Square size={11} aria-hidden /> STOP</button>
          <div
            className="ws__anim-rail"
            ref={rail}
            role="slider"
            tabIndex={0}
            aria-label="Scrub one cycle"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
            title="Scrub one cycle"
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); scrubbing.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrubTo(e.clientX) }}
            onPointerMove={(e) => { if (scrubbing.current) scrubTo(e.clientX) }}
            onPointerUp={() => { scrubbing.current = false }}
            onPointerCancel={() => { scrubbing.current = false }}
            onKeyDown={(e) => {
              const k = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0
              if (!k) return
              e.preventDefault(); e.stopPropagation()
              preview.setScrub(Math.max(0, Math.min(1, share + k)))
            }}
          >
            <span className="ws__anim-line" />
            <span className="ws__anim-walked" style={{ width: `${share * 100}%` }} />
            <span className="ws__anim-mark" style={{ left: `${share * 100}%` }} />
          </div>
        </div>
      )}
      {reduced && list.length > 0 && <div className="ws__explain">Reduced motion is on. Scrub to see it move.</div>}

      <div className="workshop__row" role="group" aria-label="Add a motion">
        <span className="workshop__label">ADD</span>
        <div className="workshop__modes">
          {PRESETS.map((p) => (
            <button key={p.id} className="workshop__mode" title={p.tip} disabled={list.length >= MAX_MOTIONS} onClick={() => add(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>
      {list.length === 0 && <div className="ws__explain">Pick one to make this object move. It loops forever and everyone sees it move at the same time.</div>}
      {list.length >= MAX_MOTIONS && <div className="ws__explain">Up to {MAX_MOTIONS} motions</div>}

      {list.map((m, i) => (
        <MotionCard key={keys.current[i]} m={m} i={i} count={list.length} bind={bind} apply={apply} now={now} />
      ))}

      {note && <div className="ws__explain ws__anim-note" role="status">{note}</div>}
      {ignored > 0 && <div className="ws__explain">{ignored === 1 ? '1 entry here cannot be read and goes on the next edit' : `${ignored} entries here cannot be read and go on the next edit`}</div>}
    </div>
  )
}

type Bind = ReturnType<typeof useRepeatable>
type Apply = (e: Edited, keyed?: (k: number[]) => number[]) => void
const swap = (i: number, j: number) => (k: number[]): number[] => { if (j >= 0 && j < k.length) [k[i], k[j]] = [k[j], k[i]]; return k }

function MotionCard({ m, i, count, bind, apply, now }: { m: Motion; i: number; count: number; bind: Bind; apply: Apply; now: () => Motion[] }): JSX.Element {
  const name = MOTION_NAMES[m.word] ?? m.word.toUpperCase()
  const speed = perMinute(m)
  const kind = amountKind(m)
  const amountLabel = m.word === 'orbit' ? 'RADIUS' : m.word === 'lift' ? 'TRAVEL' : 'REACH'
  const degrees = kind === 'degrees'
  const step = degrees ? 5 : DISTANCE_STEP
  const shown = degrees ? String(amountOf(m)) : units(amountOf(m))
  return (
    <div className="ws__anim-card" role="group" aria-label={`Motion ${i + 1}: ${name}`}>
      <div className="workshop__row">
        <span className="workshop__label ws__anim-name">{i + 1}. {name}</span>
        <button className="workshop__btn" title="Move up" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => apply(moveMotion(now(), i, -1), swap(i, i - 1))}><ArrowUp size={12} aria-hidden /></button>
        <button className="workshop__btn" title="Move down" aria-label={`Move ${name} down`} disabled={i === count - 1} onClick={() => apply(moveMotion(now(), i, 1), swap(i, i + 1))}><ArrowDown size={12} aria-hidden /></button>
        <button className="workshop__btn workshop__btn--danger" title="Remove" aria-label={`Remove ${name}`} onClick={() => apply(removeMotion(now(), i), (k) => k.filter((_, q) => q !== i))}><X size={12} aria-hidden /></button>
      </div>
      {m.axis >= 0 && (
        <div className="workshop__row" role="group" aria-label="Axis">
          <span className="workshop__label">AXIS</span>
          <div className="workshop__modes">
            {AXIS_NAMES.map((a, k) => (
              <button key={a} className={`workshop__mode workshop__btn--${a.toLowerCase()} ${m.axis === k ? 'is-on' : ''}`} aria-pressed={m.axis === k} title={`About ${a}`} onClick={() => apply(setAxis(now(), i, k as 0 | 1 | 2))}>{a}</button>
            ))}
          </div>
        </div>
      )}
      <div className="workshop__row" role="group" aria-label="Speed">
        <span className="workshop__label">SPEED</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); if (Math.abs(perMinute(l[i])) > SPEED_STEPS[0]) apply(setSpeed(l, i, stepSpeed(perMinute(l[i]), -1))) })} disabled={Math.abs(speed) <= SPEED_STEPS[0]} aria-label="Slower" title="Slower">−</button>
        <NumberField label="Speed, per minute" value={showNumber(Math.abs(speed))} onCommit={(n) => apply(setSpeed(now(), i, (speed < 0 ? -1 : 1) * Math.abs(n)))} />
        <span className="workshop__value">/MIN</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setSpeed(l, i, stepSpeed(perMinute(l[i]), 1))) })} disabled={Math.abs(speed) >= SPEED_STEPS[SPEED_STEPS.length - 1]} aria-label="Faster" title="Faster">+</button>
        {/* A swing or a slide run backward is the same back and forth from another start (§1.14 writes it with a positive c): no REVERSE for them. */}
        {reversible(m) && <button className={`workshop__btn ${m.c < 0 ? 'is-on' : ''}`} aria-pressed={m.c < 0} title="Run it the other way" aria-label="Reverse" onClick={() => apply(reverse(now(), i))}><Repeat2 size={12} aria-hidden /></button>}
        <span className="ws__explain">{Math.abs(m.c)} every {m.b} s</span>
      </div>
      {mayFlicker(m) && <div className="ws__explain ws__anim-note">This may flicker more than 3 times a second</div>}
      {kind && (
        <div className="workshop__row" role="group" aria-label={amountLabel}>
          <span className="workshop__label">{amountLabel}</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setAmount(l, i, amountOf(l[i]) - step)) })} aria-label="Less" title="Less">−</button>
          <NumberField label={`${amountLabel}, ${degrees ? 'degrees' : 'grid units'}`} value={shown} signed={m.word === 'lift'} onCommit={(n) => apply(setAmount(now(), i, degrees ? n : ticks(n)))} />
          <span className="workshop__value">{degrees ? '°' : 'UNITS'}</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setAmount(l, i, amountOf(l[i]) + step)) })} aria-label="More" title="More">+</button>
        </div>
      )}
      {m.word === 'lift' && (
        <div className="workshop__row" role="group" aria-label="Rest">
          <span className="workshop__label">REST</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setRest(l, i, l[i].p[1] - 5)) })} disabled={m.p[1] <= 0} aria-label="Shorter rests" title="Shorter rests">−</button>
          <span className="workshop__value">{m.p[1]}%</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setRest(l, i, l[i].p[1] + 5)) })} disabled={m.p[1] >= 49} aria-label="Longer rests" title="Longer rests">+</button>
          <span className="ws__explain">at each stop</span>
        </div>
      )}
      <div className="workshop__row" role="group" aria-label="Start">
        <span className="workshop__label">START</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setPhase(l, i, l[i].phi - 15)) })} aria-label="Start earlier" title="Earlier">−</button>
        <NumberField label="Start, degrees" value={String(m.phi)} onCommit={(n) => apply(setPhase(now(), i, n))} width="5ch" />
        <span className="workshop__value">°</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setPhase(l, i, l[i].phi + 15)) })} aria-label="Start later" title="Later">+</button>
      </div>
      {m.word === 'path' && <PathPoints m={m} i={i} apply={apply} now={now} />}
    </div>
  )
}

function PathPoints({ m, i, apply, now }: { m: Motion; i: number; apply: Apply; now: () => Motion[] }): JSX.Element {
  const points = pointsOf(m)
  const editing = useAnimPreview((s) => s.point)
  const focus = (j: number): void => useAnimPreview.getState().setPoint([i, j])
  const cell = (j: number, key: keyof Waypoint, label: string, width: string): JSX.Element => (
    <NumberField
      label={`Point ${j + 1} ${label}`}
      width={width}
      signed={key !== 'time'}
      value={key === 'time' ? String(points[j].time) : units(points[j][key])}
      onFocus={() => focus(j)}
      onCommit={(n) => apply(setPoint(now(), i, j, key, key === 'time' ? n : ticks(n)))}
    />
  )
  return (
    <div className="ws__anim-points" role="group" aria-label="Path points">
      <div className="workshop__row">
        <span className="workshop__label">POINTS</span>
        <span className="ws__explain">X Y Z are in grid units. T is each leg&apos;s share of the time.</span>
      </div>
      {points.map((_, j) => (
        <div key={j} className={`workshop__row ws__anim-point ${editing && editing[0] === i && editing[1] === j ? 'is-on' : ''}`} role="group" aria-label={`Point ${j + 1}`}>
          <span className="workshop__value">{j + 1}</span>
          <span className="ws__anim-axis workshop__btn--x">X</span>{cell(j, 'x', 'X', '6ch')}
          <span className="ws__anim-axis workshop__btn--y">Y</span>{cell(j, 'y', 'Y', '6ch')}
          <span className="ws__anim-axis workshop__btn--z">Z</span>{cell(j, 'z', 'Z', '6ch')}
          <span className="ws__anim-axis">T</span>{cell(j, 'time', 'time', '4ch')}
          <button className="workshop__btn" title="Move up" aria-label={`Move point ${j + 1} up`} disabled={j === 0} onClick={() => apply(movePoint(now(), i, j, -1))}><ArrowUp size={12} aria-hidden /></button>
          <button className="workshop__btn" title="Move down" aria-label={`Move point ${j + 1} down`} disabled={j === points.length - 1} onClick={() => apply(movePoint(now(), i, j, 1))}><ArrowDown size={12} aria-hidden /></button>
          <button className="workshop__btn workshop__btn--danger" title="Remove" aria-label={`Remove point ${j + 1}`} disabled={points.length <= 2} onClick={() => apply(removePoint(now(), i, j))}><X size={12} aria-hidden /></button>
        </div>
      ))}
      <div className="workshop__row">
        <button className="workshop__btn" disabled={points.length >= PATH_MAX} title="Add a point before the last" onClick={() => { apply(addPoint(now(), i)); focus(points.length - 1) }}>ADD POINT</button>
        {points.length >= PATH_MAX && <span className="ws__explain">Up to {PATH_MAX} points</span>}
      </div>
    </div>
  )
}
