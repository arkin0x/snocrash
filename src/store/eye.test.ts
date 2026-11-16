/**
 * eye.test.ts - the avatar eye (DECK-0003 §1.17) as snocrash keeps it.
 *
 * snocrash makes objects and publishes no avatars, so it has no editor for
 * the eye; it only has to keep one. An `eye` in a loaded payload rides in
 * `extra` (sno-core 0.1.31), and here it must survive an edit, a save to
 * this browser, a reload and the published payload, exactly as it came in.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { PAYLOAD_FIELDS, fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { autoEye, drawnEye, eyeChosen } from 'sno-core/eye'
import { useWorkshop } from './useWorkshop'
import { objectTemplate } from './useNostr'
import { normalizeOne } from './workshopStorage'

const w = () => useWorkshop.getState()
const cur = () => w().current() as ShardModel

/** A small avatar-shaped object, two units tall, as a pasted payload with `eye` set (or not). */
function pasted(eye?: unknown, v?: 1): string {
  const s: ShardModel = {
    ...newShard('Avatar'),
    mode: 'solid',
    vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 2, 0], c: [1, 1, 1] }],
    faces: [[0, 1, 2]],
  }
  const p = JSON.parse(JSON.stringify(toPayload(s))) as Record<string, unknown>
  if (eye !== undefined) p.eye = eye
  // A version 1 payload writes its colors as RGB in 0..1, one per vertex.
  if (v === 1) Object.assign(p, { v: 1, colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] })
  return JSON.stringify(p)
}

/** What a reload reads back: the stored JSON through the workshop's own reader. */
const reloaded = (s: ShardModel): ShardModel => normalizeOne(JSON.parse(JSON.stringify(s))) as ShardModel

/** The `eye` the published event's content carries. */
const published = (s: ShardModel): unknown => (JSON.parse(objectTemplate(s, 1).content) as { eye?: unknown }).eye

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, past: [], future: [], selection: [], partSel: [], viewing: null, notice: null })
})

describe('the eye through snocrash', () => {
  it('is a field sno-core 0.1.31 still carries in extra, not one it writes itself', () => {
    expect(PAYLOAD_FIELDS as readonly string[]).not.toContain('eye')
  })

  it('a pasted eye survives edits, a save, a reload and the published payload', () => {
    expect(w().importText(pasted([0, 150, -30]))).not.toBeNull()
    expect(cur().extra).toEqual({ eye: [0, 150, -30] })
    expect(eyeChosen(cur())).toBe(true)

    // Edits of every kind the workshop makes: geometry, mode, opacity, a glow.
    w().addVertex([TICKS(1), TICKS(1), 0])
    w().setSelection([0])
    w().moveSelected(0, 1)
    w().setMode('lines')
    w().setOpacity(50)
    w().setGlow({ style: 'light', radius: 120, strength: 40 })
    expect(cur().extra).toEqual({ eye: [0, 150, -30], glow: ['light', 120, 40] })

    // Undo and redo keep it too.
    w().undo()
    w().redo()
    expect(cur().extra?.eye).toEqual([0, 150, -30])

    const back = reloaded(cur())
    expect(back.extra?.eye).toEqual([0, 150, -30])
    expect(drawnEye(back)).toEqual([0, 150, -30])

    expect(published(back)).toEqual([0, 150, -30])
    expect(JSON.parse(w().exportCurrent() as string).eye).toEqual([0, 150, -30])
  })

  it('keeps [0, 0, 0] as written: the origin, chosen, not absent', () => {
    w().importText(pasted([0, 0, 0]))
    w().setMode('lines')
    expect(eyeChosen(cur())).toBe(true)
    expect(drawnEye(cur())).toEqual([0, 0, 0])
    expect(published(reloaded(cur()))).toEqual([0, 0, 0])
  })

  it('writes no eye for an object that never had one: AUTO follows the shape', () => {
    w().importText(pasted())
    expect(cur()).not.toHaveProperty('extra')
    // Two units tall: top 240, bottom 0, an eighth below the top is 210.
    expect(drawnEye(cur())).toEqual([0, 210, 0])
    w().setSelection([2])
    w().moveSelected(1, 1)
    expect(drawnEye(cur())).toEqual(autoEye(cur()))
    expect(eyeChosen(cur())).toBe(false)
    expect(published(reloaded(cur()))).toBeUndefined()
  })

  it('reads a malformed eye as AUTO, never a refusal, and never publishes it', () => {
    expect(w().importText(pasted([0, 1.5, 0]))).not.toBeNull()
    expect(eyeChosen(cur())).toBe(false)
    expect(drawnEye(cur())).toEqual([0, 210, 0])
    w().setMode('lines')
    expect(published(reloaded(cur()))).toBeUndefined()
  })

  it('a duplicate and a copy into the workshop keep it', () => {
    w().importText(pasted([10, 20, 30]))
    const id = w().duplicate(cur().id)
    expect(w().shards.find((s) => s.id === id)?.extra?.eye).toEqual([10, 20, 30])
    const model = fromPayload(JSON.parse(pasted([10, 20, 30])), 'x') as ShardModel
    const taken = w().importShard(model)
    expect(w().shards.find((s) => s.id === taken)?.extra?.eye).toEqual([10, 20, 30])
  })

  it('a version 1 payload\'s eye comes in the version 2 frame, and goes out in it', () => {
    w().importText(pasted([0, 150, 30], 1))
    expect(cur().extra?.eye).toEqual([0, 150, -30])
    expect(published(reloaded(cur()))).toEqual([0, 150, -30])
  })
})

function TICKS(units: number): number { return units * 120 }
