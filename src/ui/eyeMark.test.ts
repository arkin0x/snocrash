/**
 * eyeMark.test.ts - where the bench marks an object's avatar eye (DECK-0003
 * §1.17), and which word it carries: CHOSEN for an `eye` its author wrote,
 * AUTO for the automatic one, which follows the shape; when it shows; and
 * how its label is laid out.
 */

import { describe, expect, it } from 'vitest'
import { newShard, ticksOf, toPayload, toRender, type ShardModel } from 'sno-core/shards'
import { eyeModelTicks } from 'sno-core/eye'
import { EYE_LABEL_PX, drawEyeLabel, eyeLabel, eyeMark, eyeMarkShown } from './eyeMark'

/** Two units tall: Y from 0 to 240 ticks. */
const tall = (extra?: Record<string, unknown>): ShardModel => ({
  ...newShard('Avatar'),
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 2, 0], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
  ...(extra ? { extra } : {}),
})

describe('eyeMark', () => {
  it('AUTO: an eighth of the height below the top, straight above the origin', () => {
    const m = eyeMark(tall())
    expect(m.word).toBe('AUTO')
    expect(m.at[0]).toBeCloseTo(0)
    expect(m.at[1]).toBeCloseTo(210 / 120)
    expect(m.at[2]).toBeCloseTo(0)
  })

  it('CHOSEN: at the eye written, payload frame drawn as it is (+Z toward the viewer is render +Z)', () => {
    const m = eyeMark(tall({ eye: [60, 180, 120] }))
    expect(m.word).toBe('CHOSEN')
    expect(m.at).toEqual([0.5, 1.5, 1])
  })

  it('stands where the vertex the eye names stands: the model frame through toRender is the same point', () => {
    // A vertex at model Z = -1 unit is written to the wire at Z = +1 unit, +120 ticks.
    const s: ShardModel = { ...tall(), vertices: [...tall().vertices, { p: [0, 1, -1], c: [1, 1, 1] }] }
    const wireZ = (JSON.parse(JSON.stringify(toPayload(s))) as { vertices: number[][] }).vertices[3][2] * 120
    expect(wireZ).toBe(120)
    const m = eyeMark({ ...s, extra: { eye: [0, 120, wireZ] } })
    expect(m.at).toEqual(toRender(ticksOf(s.vertices[3])))
    expect(eyeModelTicks({ ...s, extra: { eye: [0, 120, wireZ] } })).toEqual(ticksOf(s.vertices[3]))
  })

  it('CHOSEN at [0, 0, 0]: the origin on purpose', () => {
    const m = eyeMark(tall({ eye: [0, 0, 0] }))
    expect(m.word).toBe('CHOSEN')
    expect(m.at).toEqual([0, 0, 0])
  })

  it('a malformed eye is AUTO', () => {
    for (const eye of [[0, 1.5, 0], [0, 0], 'up', null, [0, 99999, 0]]) expect(eyeMark(tall({ eye })).word).toBe('AUTO')
  })

  it('draws no label where there is no document', () => {
    expect(eyeLabel('AUTO')).toBeNull()
  })

})

describe('eyeMarkShown', () => {
  const base = { on: true, shard: tall(), dragging: false, moving: false }

  it('shows with the switch on, something in the object, no drag and no motion', () => {
    expect(eyeMarkShown(base)).toBe(true)
  })

  it('hides with the switch off, which is the default', () => {
    expect(eyeMarkShown({ ...base, on: false })).toBe(false)
  })

  it('hides during a drag and while the object moves', () => {
    expect(eyeMarkShown({ ...base, dragging: true })).toBe(false)
    expect(eyeMarkShown({ ...base, moving: true })).toBe(false)
  })

  it('hides with no object, and for an object with no vertices and nothing placed', () => {
    expect(eyeMarkShown({ ...base, shard: null })).toBe(false)
    expect(eyeMarkShown({ ...base, shard: { vertices: [] } })).toBe(false)
    expect(eyeMarkShown({ ...base, shard: { vertices: [], parts: [] } })).toBe(false)
  })

  it('shows for an object of placements only', () => {
    const parts = [{ ref: 0, p: [0, 0, 0] }] as unknown as ShardModel['parts']
    expect(eyeMarkShown({ ...base, shard: { vertices: [], parts } })).toBe(true)
  })
})

describe('drawEyeLabel', () => {
  /** A canvas whose 2D context measures every character 20 pixels wide and draws nothing. */
  function stubCanvas(): HTMLCanvasElement {
    const noop = (): void => {}
    const ctx = {
      font: '', lineWidth: 1, strokeStyle: '', fillStyle: '', textBaseline: '',
      measureText: (t: string) => ({ width: t.length * 20 }),
      beginPath: noop, arc: noop, stroke: noop, fill: noop, strokeText: noop, fillText: noop,
    }
    return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
  }

  it('anchors the sprite on the ring, and sizes the width to the word', () => {
    // 64 pixels tall on the canvas (16 at 4x): the ring is a square of 64, a gap
    // of 19.2, "EYE AUTO" 160, and a tail of 12.8, 256 in all.
    const canvas = stubCanvas()
    const auto = drawEyeLabel('AUTO', canvas)!
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(64)
    expect(auto.anchor).toBe(32 / 256)
    expect(auto.width).toBe(64)
    // "EYE CHOSEN", 200: ceil(296) wide.
    const chosen = drawEyeLabel('CHOSEN', stubCanvas())!
    expect(chosen.width).toBe((296 / 64) * EYE_LABEL_PX)
    expect(chosen.anchor).toBe(32 / 296)
  })

  it('draws nothing on a canvas with no 2D context', () => {
    expect(drawEyeLabel('AUTO', { getContext: () => null } as unknown as HTMLCanvasElement)).toBeNull()
  })
})
