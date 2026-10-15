/**
 * escape.ts - what one Escape press closes in the workshop, in ONOSENDAI's
 * order (arkinox, 2026-10-01: "ESC should exit modals, then exit menu, then
 * close ui overlay chips").
 *
 * ONOSENDAI keeps a stack every closable thing registers on (useEscape).
 * snocrash has few enough of them to name: the palette sheet, with its own
 * confirmations over it, then the open panel, then the view pad, then what
 * is in hand. One press closes one of them, the topmost. Nothing past that:
 * the workshop is this app's home, so Escape never closes it.
 *
 * The decisions are plain functions so they can be tested without a page;
 * Workshop and PaletteModal listen for the key and do what they say.
 */

import { useWorkshop } from '../store/useWorkshop'

/** What the workshop's own Escape closes, or null when it leaves the press alone. */
export type BenchEscape = 'panel' | 'view' | 'selection' | null

/**
 * The workshop's step, under whatever sits over the bench. `covered` is
 * anything that owns Escape while it is up (the palette sheet folds itself;
 * the menu and the key take the press and do nothing with it), so the bench
 * behind it is left alone.
 */
export function benchEscape(s: { covered: boolean; panel: boolean; viewOpen: boolean; holding: boolean }): BenchEscape {
  if (s.covered) return null
  if (s.panel) return 'panel'
  if (s.viewOpen) return 'view'
  if (s.holding) return 'selection'
  return null
}

/**
 * The palette sheet's step: one of its confirmations closes first, since it
 * opened over the sheet, then the sheet folds back into its chip, as its
 * close button does. ONOSENDAI's sheet (useEscape('modal', true, fold)).
 */
export function sheetEscape(confirming: boolean): 'confirm' | 'fold' {
  return confirming ? 'confirm' : 'fold'
}

/**
 * Whether a key is typing into a field rather than meant for the bench. The
 * bench's keys, Escape among them, leave a field alone; the palette sheet is
 * a modal and folds from its own fields too, as ONOSENDAI's does.
 */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)
}

/** Whether anything is in hand: points, placed objects, a face, a face being picked. */
export function holding(): boolean {
  const w = useWorkshop.getState()
  return w.selection.length > 0 || w.partSel.length > 0 || w.selectedFace !== null || w.facePick.length > 0
}

/** Let go of everything in hand, and nothing else: the workshop stays open. */
export function letGo(): void {
  const w = useWorkshop.getState()
  w.selectVertex(null)
  w.clearFacePick()
}
