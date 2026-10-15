/**
 * Escape in the workshop (escape.ts), in ONOSENDAI's order: the palette
 * sheet's confirmation, the sheet, the key, the menu, the open panel, the
 * view pad, what is in hand, and then nothing. Never the workshop itself.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkshop } from '../store/useWorkshop'
import { holding, letGo, sheetEscape, typingIn, workshopEscape } from './escape'
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

  const none = { sheet: false, confirm: false, confirmBusy: false, login: false, loginBusy: false, menu: false, making: true, typing: false, panel: false, viewOpen: false, holding: false }

  it('closes one thing per press, topmost first: the key, the menu, the panel, the view pad, what is in hand', () => {
    // Everything up at once, then each press with the one above it gone.
    // (The menu's CHANGE closes the menu as it opens the key, so the two are
    // never up together in the app; the order still says which goes first.)
    let s = { ...none, login: true, menu: true, panel: true, viewOpen: true, holding: true }
    const order: string[] = []
    for (let step = workshopEscape(s); step !== null; step = workshopEscape(s)) {
      order.push(step)
      if (step === 'login') s = { ...s, login: false }
      if (step === 'menu') s = { ...s, menu: false }
      if (step === 'panel') s = { ...s, panel: false }
      if (step === 'view') s = { ...s, viewOpen: false }
      if (step === 'selection') s = { ...s, holding: false }
    }
    expect(order).toEqual(['login', 'menu', 'panel', 'view', 'selection'])
    expect(workshopEscape(none)).toBeNull()
  })

  it("RETRACT's confirmation closes first, as its CANCEL would, and stays while its deletion is going out", () => {
    expect(workshopEscape({ ...none, confirm: true, menu: true, panel: true, holding: true })).toBe('confirm')
    expect(workshopEscape({ ...none, confirm: true, confirmBusy: true, panel: true, holding: true })).toBeNull()
    expect(WORKSHOP).toMatch(/confirm: retractAsk, confirmBusy: retracting/)
    expect(WORKSHOP).toMatch(/if \(step === 'confirm'\) setRetractAsk\(false\)/)
  })

  it('leaves the key alone while it is WORKING, and everything under it', () => {
    expect(workshopEscape({ ...none, login: true, loginBusy: true, menu: true, panel: true, holding: true })).toBeNull()
    expect(WORKSHOP).toMatch(/loginBusy: useNostr\.getState\(\)\.loggingIn/)
  })

  it('leaves everything to the palette sheet while it is up', () => {
    expect(workshopEscape({ ...none, sheet: true, login: true, menu: true, panel: true, viewOpen: true, holding: true })).toBeNull()
  })

  it('closes the menu and the key from the feed too, and from their own fields, but leaves the bench alone off it', () => {
    expect(workshopEscape({ ...none, making: false, menu: true })).toBe('menu')
    expect(workshopEscape({ ...none, making: false, login: true })).toBe('login')
    expect(workshopEscape({ ...none, typing: true, menu: true })).toBe('menu')
    expect(workshopEscape({ ...none, typing: true, login: true })).toBe('login')
    expect(workshopEscape({ ...none, making: false, panel: true, holding: true })).toBeNull()
  })

  it('in the palette sheet, closes a confirmation before the sheet, then folds the sheet', () => {
    expect(sheetEscape(true)).toBe('confirm')
    expect(sheetEscape(false)).toBe('fold')
    // The sheet listens for the key itself, and the workshop counts it as cover.
    expect(PALETTE).toMatch(/sheetEscape\(switching !== null \|\| forgetting !== null\)/)
    expect(WORKSHOP).toMatch(/sheet: pickerOpen, confirm: retractAsk/)
    expect(WORKSHOP).toMatch(/login: loginOpen, loginBusy: [^,]+, menu: menuOpen/)
  })

  it('on the bench, leaves a key typed into a field alone', () => {
    expect(workshopEscape({ ...none, typing: true, panel: true, holding: true })).toBeNull()
    expect(typingIn({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'CANVAS', isContentEditable: false } as unknown as EventTarget)).toBe(false)
    expect(typingIn(null)).toBe(false)
    expect(WORKSHOP).toMatch(/escape\.current\(typingIn\(e\.target\)\)/)
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
