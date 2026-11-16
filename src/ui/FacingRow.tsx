/**
 * FacingRow.tsx - FACING, how the object turns as it moves when worn as an
 * avatar (DECK-0003 §1.18, sno-core/face), under the avatar eye in MENU.
 *
 * Two half-width buttons, PATH and UPRIGHT, in the order sno-core's
 * FACE_MODES gives them. PATH, the default, writes no field; UPRIGHT writes
 * `"upright"`. An object whose `face` is a name this version does not know
 * shows PATH, as every reader reads it, and keeps the name until UPRIGHT is
 * pressed (store/useWorkshop.ts setFace).
 */

import type { ShardModel } from 'sno-core/shards'
import { FACE_MODES, drawnFace, type FaceMode } from 'sno-core/face'
import { useWorkshop } from '../store/useWorkshop'

const w = () => useWorkshop.getState()

/** Each mode's tooltip, in plain words. */
export const FACE_TIPS: Readonly<Record<FaceMode, string>> = {
  path: 'Points its front along the way it moves, and tilts with it',
  upright: 'Stays upright and only turns left or right',
}

/** The hint under the row: what the lit mode does when worn, short enough for one line on a phone (a tooltip never shows on touch). */
export const FACE_HINTS: Readonly<Record<FaceMode, string>> = {
  path: 'Worn, it tilts with each move.',
  upright: 'Worn, it stays upright.',
}

export function FacingRow({ shard }: { shard: Pick<ShardModel, 'extra'> }): JSX.Element {
  const face = drawnFace(shard)
  return (
    <div className="workshop__row ws__facing">
      <span className="workshop__label">FACING</span>
      <div className="workshop__modes ws__facing-modes" role="group" aria-label="Facing">
        {FACE_MODES.map((m) => (
          <button key={m} className={`workshop__mode ${face === m ? 'is-on' : ''}`} aria-pressed={face === m} title={FACE_TIPS[m]} onClick={() => w().setFace(m)}>{m.toUpperCase()}</button>
        ))}
      </div>
      <span className="ui-field__hint ws__facing-hint">{FACE_HINTS[face]}</span>
    </div>
  )
}
