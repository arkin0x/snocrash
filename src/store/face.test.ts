/**
 * face.test.ts - the avatar facing (DECK-0003 §1.18) as snocrash keeps it.
 *
 * A `face` in a loaded payload rides in `extra` (sno-core 0.1.32, like
 * `eye`), and here it must survive an edit, a save to this browser (local
 * storage and IndexedDB), a reload, the clipboard and the published payload,
 * exactly as it came in. An unknown name rides on untouched; a value that is
 * not a string stays off the wire. FACING (setFace) writes through withFace.
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { PAYLOAD_FIELDS, fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { drawnFace } from 'sno-core/face'
import { useWorkshop } from './useWorkshop'
import { objectTemplate } from './useNostr'
import { normalizeOne } from './workshopStorage'
import { commit, openWorkshopDb, readAll } from '../lib/workshopDb'

const w = () => useWorkshop.getState()
const cur = () => w().current() as ShardModel

/** A small avatar-shaped object as a pasted payload, with `face` set (or not). */
function pasted(face?: unknown): string {
  const s: ShardModel = {
    ...newShard('Avatar'),
    mode: 'solid',
    vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 2, 0], c: [1, 1, 1] }],
    faces: [[0, 1, 2]],
  }
  const p = JSON.parse(JSON.stringify(toPayload(s))) as Record<string, unknown>
  if (face !== undefined) p.face = face
  return JSON.stringify(p)
}

/** What a reload reads back: the stored JSON through the workshop's own reader. */
const reloaded = (s: ShardModel): ShardModel => normalizeOne(JSON.parse(JSON.stringify(s))) as ShardModel

/** The `face` the published event's content carries, or a marker when it has none. */
const published = (s: ShardModel): unknown => {
  const c = JSON.parse(objectTemplate(s, 1).content) as Record<string, unknown>
  return 'face' in c ? c.face : 'ABSENT'
}

/** The `face` the clipboard copy carries, or a marker when it has none. */
const copied = (): unknown => {
  const c = JSON.parse(w().exportCurrent() as string) as Record<string, unknown>
  return 'face' in c ? c.face : 'ABSENT'
}

/** A shard put into the workshop's IndexedDB and read back, as a reload in another tab reads it. */
async function throughDb(s: ShardModel): Promise<ShardModel> {
  const db = await openWorkshopDb()
  try {
    await commit(db, [{ id: s.id, seq: 1, updatedAt: 1, json: JSON.stringify(s) }], [])
    const { records } = await readAll(db)
    const r = records.find((x) => x.id === s.id)
    return normalizeOne(JSON.parse(r!.json)) as ShardModel
  } finally { db.close() }
}

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, past: [], future: [], selection: [], partSel: [], viewing: null, notice: null })
})

describe('face through snocrash', () => {
  it('is a field sno-core 0.1.32 still carries in extra, not one it writes itself', () => {
    expect(PAYLOAD_FIELDS as readonly string[]).not.toContain('face')
  })

  it('a pasted "upright" survives edits, undo, a save, a reload, the clipboard and the published payload', async () => {
    expect(w().importText(pasted('upright'))).not.toBeNull()
    expect(cur().extra).toEqual({ face: 'upright' })
    expect(drawnFace(cur())).toBe('upright')

    w().addVertex([120, 120, 0])
    w().setSelection([0])
    w().moveSelected(0, 1)
    w().setMode('lines')
    w().setOpacity(50)
    w().setConstrain('all')
    expect(cur().extra?.face).toBe('upright')
    w().undo()
    w().redo()
    expect(cur().extra?.face).toBe('upright')

    expect(copied()).toBe('upright')
    const back = reloaded(cur())
    expect(drawnFace(back)).toBe('upright')
    expect(published(back)).toBe('upright')
    expect(published(await throughDb(cur()))).toBe('upright')
  })

  it('an unknown name rides on untouched, and reads as PATH', async () => {
    w().importText(pasted('spin'))
    expect(drawnFace(cur())).toBe('path')
    w().setMode('lines')
    // PATH is what it already reads as, so pressing it is no edit and keeps the name.
    w().setFace('path')
    expect(cur().extra?.face).toBe('spin')
    expect(copied()).toBe('spin')
    expect(published(reloaded(cur()))).toBe('spin')
    expect(published(await throughDb(cur()))).toBe('spin')
  })

  it('a value not shaped like a name is left off the wire, and reads as PATH', () => {
    for (const bad of [1, true, ['upright'], { mode: 'upright' }, null, 'UPRIGHT', 'Upright', '', 'a'.repeat(33), '1up']) {
      w().importText(pasted(bad))
      expect(drawnFace(cur())).toBe('path')
      w().setMode('lines')
      expect(published(reloaded(cur()))).toBe('ABSENT')
      expect(copied()).toBe('ABSENT')
    }
  })

  it('writes no face for an object that never had one', () => {
    w().importText(pasted())
    expect(cur()).not.toHaveProperty('extra')
    expect(published(reloaded(cur()))).toBe('ABSENT')
  })

  it('a duplicate and a copy into the workshop keep it', () => {
    w().importText(pasted('upright'))
    const id = w().duplicate(cur().id)
    expect(w().shards.find((s) => s.id === id)?.extra?.face).toBe('upright')
    const taken = w().importShard(fromPayload(JSON.parse(pasted('upright')), 'x') as ShardModel)
    expect(w().shards.find((s) => s.id === taken)?.extra?.face).toBe('upright')
  })
})

describe('setFace (FACING)', () => {
  it('UPRIGHT writes "upright"; PATH removes the field; both undo', () => {
    w().importText(pasted())
    w().setFace('upright')
    expect(cur().extra).toEqual({ face: 'upright' })
    expect(published(cur())).toBe('upright')
    w().setFace('path')
    expect(cur()).not.toHaveProperty('extra')
    expect(published(cur())).toBe('ABSENT')
    w().undo()
    expect(cur().extra?.face).toBe('upright')
    w().undo()
    expect(cur()).not.toHaveProperty('extra')
  })

  it('keeps the other fields in extra when it adds or removes face', () => {
    w().importText(pasted())
    w().setConstrain('all')
    w().setFace('upright')
    expect(cur().extra).toEqual({ constrain: 'all', face: 'upright' })
    w().setFace('path')
    expect(cur().extra).toEqual({ constrain: 'all' })
  })

  it('pressing the mode already on is no undo step', () => {
    w().importText(pasted('upright'))
    const before = w().past.length
    w().setFace('upright')
    expect(w().past.length).toBe(before)
  })

  it('UPRIGHT replaces an unknown name', () => {
    w().importText(pasted('spin'))
    w().setFace('upright')
    expect(cur().extra?.face).toBe('upright')
  })
})
