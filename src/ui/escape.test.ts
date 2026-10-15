/**
 * Escape in the workshop (escape.ts), in ONOSENDAI's order: the palette
 * sheet's confirmation, the sheet, the open panel, the view pad, what is in
 * hand, and then nothing. Never the workshop itself.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkshop } from '../store/useWorkshop'
import { benchEscape, holding, letGo, sheetEscape, typingIn } from './escape'
import BENCH from './Bench.tsx?raw'
import ESCAPE from './escape.ts?raw'
import PALETTE from './PaletteModal.tsx?raw'
import WORKSHOP from './Workshop.tsx?raw'

const w = () => useWorkshop.getState()
const QUAD = JSON.stringify({ v: 1, type: 'shard', name: 'q', unit: 0, extent: 15, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], ticks: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], faces: [[0, 1, 2], [0, 2, 3]] })

describe('Escape in the workshop', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], aim: null, notice: null, tool: 'select' })
  })

  it('closes one thing per press, topmost first: the panel, then the view pad, then what is in hand', () => {
    // Everything up at once, then each press with the one above it gone.
    let s = { covered: false, panel: true, viewOpen: true, holding: true }
    const order: string[] = []
    for (let step = benchEscape(s); step !== null; step = benchEscape(s)) {
      order.push(step)
      if (step === 'panel') s = { ...s, panel: false }
      if (step === 'view') s = { ...s, viewOpen: false }
      if (step === 'selection') s = { ...s, holding: false }
    }
    expect(order).toEqual(['panel', 'view', 'selection'])
    expect(benchEscape({ covered: false, panel: false, viewOpen: false, holding: false })).toBeNull()
  })

  it('leaves the bench alone while the palette sheet, the menu or the key is over it', () => {
    expect(benchEscape({ covered: true, panel: true, viewOpen: true, holding: true })).toBeNull()
  })

  it('in the palette sheet, closes a confirmation before the sheet, then folds the sheet', () => {
    expect(sheetEscape(true)).toBe('confirm')
    expect(sheetEscape(false)).toBe('fold')
    // The sheet listens for the key itself, and the workshop counts it as cover.
    expect(PALETTE).toMatch(/sheetEscape\(switching !== null \|\| forgetting !== null\)/)
    expect(WORKSHOP).toMatch(/covered: pickerOpen \|\| menuOpen \|\| loginOpen/)
  })

  it('leaves a key typed into a field alone', () => {
    expect(typingIn({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'CANVAS', isContentEditable: false } as unknown as EventTarget)).toBe(false)
    expect(typingIn(null)).toBe(false)
    expect(WORKSHOP).toMatch(/e\.code !== 'Escape' \|\| typingIn\(e\.target\)/)
  })

  it('lets go of points and a face, and the workshop stays open', () => {
    w().openWorkshop()
    w().create('t')
    const id = w().importText(QUAD)!
    w().select(id)
    w().selectFace(0)
    expect(holding()).toBe(true)
    letGo()
    expect(holding()).toBe(false)
    expect(w().selection).toEqual([])
    expect(w().selectedFace).toBeNull()
    expect(w().open).toBe(true)
  })

  it('never closes the workshop: no Escape path reaches closeWorkshop, and Bench no longer handles the key', () => {
    for (const src of [ESCAPE, WORKSHOP, BENCH, PALETTE]) expect(src).not.toMatch(/closeWorkshop/)
    expect(BENCH).not.toMatch(/['"]Escape['"]/)
  })
})
