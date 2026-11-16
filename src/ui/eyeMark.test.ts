/**
 * eyeMark.test.ts - where the bench marks an object's avatar eye (DECK-0003
 * §1.17), and which word it carries: CHOSEN for an `eye` its author wrote,
 * AUTO for the automatic one, which follows the shape. Shown only with the
 * size reference.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newShard, ticksOf, toPayload, toRender, type ShardModel } from 'sno-core/shards'
import { eyeModelTicks } from 'sno-core/eye'
import { eyeLabel, eyeMark } from './eyeMark'

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
    expect(m.at).toEqual(toRender(ticksOf(s.vertices[3])).map((n) => n + 0))
    expect(eyeModelTicks({ ...s, extra: { eye: [0, 120, wireZ] } })).toEqual(ticksOf(s.vertices[3]))
  })

  it('CHOSEN at [0, 0, 0]: the origin on purpose', () => {
    const m = eyeMark(tall({ eye: [0, 0, 0] }))
    expect(m.word).toBe('CHOSEN')
    expect(m.at.map((n) => n + 0)).toEqual([0, 0, 0])
  })

  it('a malformed eye is AUTO', () => {
    for (const eye of [[0, 1.5, 0], [0, 0], 'up', null, [0, 99999, 0]]) expect(eyeMark(tall({ eye })).word).toBe('AUTO')
  })

  it('draws no label where there is no document', () => {
    expect(eyeLabel('AUTO')).toBeNull()
  })

  it('shows only with the size reference', () => {
    const bench = readFileSync(join(__dirname, 'Bench.tsx'), 'utf8')
    expect(bench).toMatch(/\{showAvatar && <EyeMark \/>\}/)
  })
})
