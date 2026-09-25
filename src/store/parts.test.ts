/**
 * Placed objects in the workshop (DECK-0003 §1.10): OBJECT places one by
 * reference, and SELECT treats each as one whole thing that moves, turns,
 * copies, pastes and deletes with the points around it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TICKS_PER_UNIT as T, fromPayload, toPayload, vertexAt, type Ref, type ShardModel } from 'sno-core/shards'
import { newShard } from 'sno-core/shards'
import { DEFAULT_PALETTE, useWorkshop } from './useWorkshop'
import { useNostr } from './useNostr'

const w = () => useWorkshop.getState()
const cur = (): ShardModel => w().current()!
const ME = 'ab'.repeat(32)
const TILE: Ref = ['a', `33331:${'cd'.repeat(32)}:tile`]
const ROCK: Ref = ['a', `33331:${'cd'.repeat(32)}:rock`]

const object = (ref: Ref, name = 'tile'): { ref: Ref; name: string; shard: ShardModel } => ({
  ref, name, shard: { ...newShard(name), vertices: [vertexAt([0, 0, 0], [1, 1, 1]), vertexAt([T, 0, 0], [1, 1, 1])] },
})

describe('placed objects in the workshop', () => {
  beforeEach(() => {
    useNostr.setState({ pubkey: ME })
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFace: null, facePick: [], palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [], aim: null, notice: null, tool: 'stamp', stampKind: 'block', stampSize: 1, stampFacing: 0, stampMode: 'shape', stampObject: null, picking: false, clip: null })
    w().select(w().create('t'))
  })

  it('OBJECT asks for an object first, then places it by reference, turned by FACING', () => {
    w().setStampMode('object')
    w().placeObject([0, 0, 0])
    expect(cur().parts).toBeUndefined()
    expect(w().notice).toMatch(/Choose an object/)
    w().setStampObject(object(TILE))
    w().turnStamp()
    w().placeObject([2 * T, 0, 0])
    w().placeObject([4 * T, 0, 0])
    expect(cur().refs).toEqual([TILE])
    expect(cur().parts).toEqual([
      { ref: 0, at: [2 * T, 0, 0], turn: [0, 90, 0], step: 0 },
      { ref: 0, at: [4 * T, 0, 0], turn: [0, 90, 0], step: 0 },
    ])
    // What goes on the wire, and back.
    const back = fromPayload(toPayload(cur()), 'x')!
    expect(back.parts).toEqual(cur().parts)
    expect(back.refs).toEqual([TILE])
  })

  it('refuses to place an object inside itself', () => {
    w().setStampObject(object(['a', `33331:${ME}:${cur().id}`], 'me'))
    w().placeObject([0, 0, 0])
    expect(cur().parts).toBeUndefined()
    expect(w().notice).toMatch(/cannot place itself/)
  })

  it('moves and turns a placed object with the points selected beside it', () => {
    w().setStampObject(object(TILE))
    w().placeObject([T, 0, 0])
    w().setTool('add')
    w().addVertex([-T, 0, 0])
    w().setTool('select')
    w().setSelection([0])
    w().togglePart(0)
    expect(w().partSel).toEqual([0])
    w().moveSelected(1, T)
    expect(cur().parts![0].at).toEqual([T, T, 0])
    expect(cur().vertices[0].p).toEqual([-1, 1, 0])
    // A quarter turn on the floor, about the pair's middle: both swing, and the
    // object takes the same quarter itself.
    w().rotateSelected(1)
    const turned = cur()
    expect(turned.parts![0].turn).not.toEqual([0, 0, 0])
    const pivot = [(T + -T) / 2, 0]
    expect(turned.parts![0].at[1]).toBe(T)
    expect(Math.abs(turned.parts![0].at[0] - pivot[0]) + Math.abs(turned.parts![0].at[2])).toBe(T)
    // Four quarters bring it home.
    w().rotateSelected(1); w().rotateSelected(1); w().rotateSelected(1)
    expect(cur().parts![0]).toEqual({ ref: 0, at: [T, T, 0], turn: [0, 0, 0], step: 0 })
  })

  it('copies and pastes a placed object as another placement of the same object, and deletes cleanly', () => {
    w().setStampObject(object(TILE))
    w().placeObject([0, 0, 0])
    w().setStampObject(object(ROCK, 'rock'))
    w().placeObject([2 * T, 0, 0])
    w().setTool('select')
    w().selectPart(0)
    w().duplicateSelection()
    expect(cur().parts).toHaveLength(3)
    expect(cur().refs).toEqual([TILE, ROCK])
    expect(cur().parts![2]).toEqual({ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })
    expect(w().partSel).toEqual([2])
    // The copy moves off alone.
    w().moveSelected(0, T)
    expect(cur().parts![0].at).toEqual([0, 0, 0])
    expect(cur().parts![2].at).toEqual([T, 0, 0])
    // Cut the rock: its reference goes with its only placement.
    w().selectPart(1)
    w().cutSelection()
    expect(cur().refs).toEqual([TILE])
    expect(cur().parts!.map((p) => p.ref)).toEqual([0, 0])
    expect(w().clip?.parts).toHaveLength(1)
    // Pasted back, it brings its reference with it.
    w().pasteClip('exact')
    expect(cur().refs).toEqual([TILE, ROCK])
    expect(cur().parts![2]).toMatchObject({ ref: 1, at: [2 * T, 0, 0] })
    // Delete every placement: no refs, no parts, and a payload with neither.
    w().setPartSelection([0, 1, 2])
    w().deleteSelected()
    expect(cur().parts).toBeUndefined()
    expect(cur().refs).toBeUndefined()
    expect(toPayload(cur()).refs).toBeUndefined()
    // Undo brings them all back.
    w().undo()
    expect(cur().parts).toHaveLength(3)
  })

  it('a selection that no longer exists is dropped, and a tap away lets go of objects too', () => {
    w().setStampObject(object(TILE))
    w().placeObject([0, 0, 0])
    w().setTool('select')
    w().selectPart(0)
    w().undo()
    w().redo()
    w().selectPart(0)
    w().selectVertex(null)
    expect(w().partSel).toEqual([])
  })
})
