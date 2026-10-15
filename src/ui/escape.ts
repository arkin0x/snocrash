/**
 * escape.ts - what one Escape press closes in the workshop, in ONOSENDAI's
 * order (arkinox, 2026-10-01: "ESC should exit modals, then exit menu, then
 * close ui overlay chips").
 *
 * ONOSENDAI keeps a stack every closable thing registers on (useEscape).
 * snocrash has few enough of them to name: a modal first (the palette sheet,
 * with its own confirmations over it, or the key), then the menu, then on
 * the bench the open panel, then the view pad, then what is in hand. One
 * press closes one of them, the topmost. Nothing past that: the workshop is
 * this app's home, so Escape never closes it.
 *
 * The decisions are plain functions so they can be tested without a page;
 * Workshop and PaletteModal listen for the key and do what they say.
 */

import { useWorkshop } from '../store/useWorkshop'

/** What the workshop's own Escape closes, or null when it leaves the press alone. */
export type WorkshopEscape = 'confirm' | 'login' | 'menu' | 'panel' | 'view' | 'selection' | null

/**
 * The workshop's step. The palette sheet listens for the key itself, so
 * while it is up the press is its alone. The key (LoginModal) is a modal and
 * the menu sits under the modals, as in ONOSENDAI (useEscape 'modal' over
 * 'menu'); both close from their own fields too, as ONOSENDAI's do. The key
 * stays while it is WORKING (`loginBusy`): closing it then would leave the
 * attempt running behind it, so Escape does nothing and its ✕ is the way to
 * give the attempt up (review of parity #35). The bench
 * comes after them, and only on the bench (`making`): there a key typed into
 * a field is left alone (`typing`).
 */
export function workshopEscape(s: {
  sheet: boolean; confirm: boolean; confirmBusy: boolean
  login: boolean; loginBusy: boolean; menu: boolean
  making: boolean; typing: boolean
  panel: boolean; viewOpen: boolean; holding: boolean
}): WorkshopEscape {
  if (s.sheet) return null
  // A confirmation (RETRACT's) is a modal, closed as its CANCEL would be,
  // and left alone while its answer is going out, as ONOSENDAI's ConfirmModal
  // is (useEscape 'modal', unless busy).
  if (s.confirm) return s.confirmBusy ? null : 'confirm'
  if (s.login) return s.loginBusy ? null : 'login'
  if (s.menu) return 'menu'
  if (!s.making || s.typing) return null
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
 * bench's keys, Escape among them, leave a field alone; the palette sheet,
 * the key and the menu close from their own fields too, as ONOSENDAI's do.
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
