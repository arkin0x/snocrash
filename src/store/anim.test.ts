/**
 * anim.test.ts - the workshop's MOTION (DECK-0003 §1.14): setAnim is one
 * undoable step that stores only what a reader reads, canonically; none
 * removes the field; what is published carries it; the bench's preview clock
 * plays, pauses and scrubs; and the preview stops on another tool.
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { animOf } from 'sno-core/anim'
import { useWorkshop } from './useWorkshop'
import { useAnimPreview } from './animPreview'
import { benchClock } from '../ui/Bench'

const w = () => useWorkshop.getState()
const cur = () => w().current() as ShardModel
const wire = () => JSON.parse(JSON.stringify(toPayload(cur()))) as Record<string, unknown>

beforeEach(() => {
  const s: ShardModel = { ...newShard('Hoop'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [0, 0, 1] }, { p: [1, 0, 0], c: [0, 0, 1] }, { p: [0, 0, 1], c: [0, 0, 1] }], faces: [[0, 1, 2]] }
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], selection: [], partSel: [], tool: 'view' })
  useAnimPreview.getState().stop()
})

describe('MOTION', () => {
  it('sets motions in one undoable step, canonically', () => {
    w().setAnim([['turn', 'y', 2, 40, 0]])
    expect(wire().anim).toEqual([['turn', 'y', 1, 20, 0]])
    expect(w().past).toHaveLength(1)
    w().undo()
    expect(wire()).not.toHaveProperty('anim')
  })

  it('stores nothing a reader would ignore, and none removes the field', () => {
    w().setAnim([['turn', 'y', 1, 20, 0], ['spin', 'y', 1, 1, 0], ['turn', 'y', 9, 1, 0]])
    expect(wire().anim).toEqual([['turn', 'y', 1, 20, 0]])
    w().setAnim(undefined)
    expect(wire()).not.toHaveProperty('anim')
  })

  it('is no step when nothing changes', () => {
    w().setAnim([['turn', 'y', 1, 20, 0]])
    w().setAnim([['turn', 'y', 1, 20, 0]])
    expect(w().past).toHaveLength(1)
  })

  it('is what the published payload carries, and reads back', () => {
    w().setAnim([['lift', 'y', 1440, 25, 1, 20, 0]])
    const back = fromPayload(wire(), 'x')!
    expect(animOf(back).map((m) => m.word)).toEqual(['lift'])
  })
})

describe('the bench preview clock', () => {
  const shared = { t: 1_795_132_801.5, version: 3, nowS: 9, chosen: false }
  it('plays on the world clock, holds a pause, and scrubs through the longest cycle as a time chosen by hand', () => {
    w().setAnim([['turn', 'y', 1, 6, 0], ['slide', 'x', 120, 1, 2, 0]])
    expect(benchClock(shared)).toMatchObject({ t: shared.t, chosen: false })
    useAnimPreview.setState({ on: true, playing: false, frozen: 1000, scrub: null })
    expect(benchClock(shared).t).toBe(1000)
    useAnimPreview.getState().setScrub(0.5)
    expect(benchClock(shared)).toMatchObject({ t: 3, chosen: true, version: 3 })
  })
  it('stops on another tool', () => {
    useAnimPreview.getState().play()
    w().setTool('select')
    expect(useAnimPreview.getState().on).toBe(false)
  })
})
