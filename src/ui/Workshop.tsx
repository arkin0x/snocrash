/**
 * Workshop.tsx - the shard workshop's shell: the bench full-screen, and the
 * controls as overlays on it, the way the main scene's instruments sit on
 * the world.
 *
 * Top left, the hamburger (the app: identity, feed, workshop) and a row of
 * chips: MENU (the object itself: name, mode, the list, clear, explain) and
 * GRID (the level the placing tools work on, the scale, the grid's own size
 * and the size reference), each opening one panel below the row; UNDO and
 * REDO float beside them. Bottom left, TOOLS (STAMP, ADD, SELECT, FACE and
 * each tool's options). Top right, PUBLISH and the compass. Bottom right,
 * the CONTROLS pad, present only while points are selected: the main pad's
 * shape, nudging the selection in screen directions, with CONNECT and DELETE
 * in its corners; and below it COLOR, folded to a swatch of the current
 * color until tapped, shut again by a tap anywhere else, and held open while
 * SELECT is the tool; gone while FACE is the tool with no face in hand, back
 * once a face is selected so a color can be put on its corners. TOOLS sits
 * bottom left, its panel opening upward. On a phone the open color bar spans
 * the bottom above the two corners.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Box, ClipboardPaste, Copy, Eye, FlipVertical2, Globe, Grid3x3, Link, MousePointer2, PaintBucket, Pickaxe, Plus, Redo2, RotateCcw, RotateCw, Scissors, Stamp, Trash2, Triangle, type LucideIcon, Undo2, Waypoints, Wrench, X } from 'lucide-react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { Explanation } from './Explanation'
import { DIVISIONS, MAX_EXTENT, MAX_UNIT, MIN_EXTENT, MODES, TICKS_PER_UNIT, neededExtent, rgbToHex, ticksOf, toPayload, unitsLabel, type ShardMode } from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { FACED, FACING_LABEL, FLOOR, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from 'sno-core/stamps'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { Bench } from './Bench'
import { Compass3D } from './Compass3D'
import { Feed } from './Feed'
import { LoginModal } from './LoginModal'
import { MenuOverlay } from './MenuOverlay'
import { PaletteModal } from './PaletteModal'
import { STATE_HELP, STATE_LABEL, STATE_TAG, publishState, shardFingerprint } from '../lib/published'
import { decodeObjectAddress, useNostr } from '../store/useNostr'
import { useRoute } from '../lib/route'
import { fileNameFor, toPly } from '../lib/ply'

/** Hand a text file to the browser: what EXPORT PLY does with an object. */
function saveFile(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
import { benchPose, nudgeFor, nudgeLabel, planeAfter, publishedFrame, requestView, useBenchView, type NudgeName } from './benchAxes'

const TOOLS: Tool[] = ['view', 'stamp', 'add', 'select', 'face']
const TOOL_ICON: Record<Tool, LucideIcon> = { view: Eye, stamp: Stamp, add: Plus, select: MousePointer2, face: Triangle }

const TOAST_MS = 4000

/** One line under the tool row. SELECT needs none: the pad appears when something is selected. */
const TOOL_HELP: Partial<Record<Tool, string>> = {
  view: 'Look around: one finger orbits, two pan, pinch zooms. The compass turns the view a quarter at a time. Pick a tool to build.',
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  face: 'Tap corners in order, then the first again or FILL. Tap a face to select it; DELETE FACE removes it. A dark face shows its back: FLIP turns it round.',
}

type Panel = 'menu' | 'tools' | 'grid'

const INTRO_KEY = 'onosendai:workshop-intro'

function Intro(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => { try { return !localStorage.getItem(INTRO_KEY) } catch { return false } })
  if (!show) return null
  const done = (): void => { try { localStorage.setItem(INTRO_KEY, '1') } catch { /* private mode */ } setShow(false) }
  return (
    <div className="workshop__intro" role="note" aria-label="How to make an object">
      <h3 className="workshop__intro-title">MAKE AN OBJECT</h3>
      <ol className="workshop__intro-steps">
        <li><b>STAMP</b> a shape: pick one under TOOLS, tap the grid where the ghost shows.</li>
        <li>One finger <b>orbits</b>, two fingers <b>pan</b>. GRID raises the level to stack things.</li>
        <li><b>PUBLISH</b> sends it to the relays as one event, for anyone to find.</li>
      </ol>
      <button className="workshop__btn workshop__intro-ok" onClick={done}>GOT IT</button>
    </div>
  )
}

/** The store's one-line notice, shown for a moment at the top and then gone. */
function Toast(): JSX.Element | null {
  const notice = useWorkshop((s) => s.notice)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) { setShown(null); return }
    setShown(notice)
    const t = window.setTimeout(() => setShown(null), TOAST_MS)
    return () => window.clearTimeout(t)
  }, [notice])
  if (!shown) return null
  return <div className="ws__toast" role="status">{shown}</div>
}

/**
 * The CONTROLS pad: the main pad's nine cells, for the selection. Arrows move
 * it a unit in screen directions (the sub-label says which world axis that is
 * right now), the corners CONNECT and DELETE, the hub counts the points and
 * clears them.
 */
function ControlsPad({ points }: { points: number }): JSX.Element {
  const axes = useBenchView((s) => s.axes)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const clip = useWorkshop((s) => s.clip)
  // PASTE asks where before it puts anything down, since the answer is not
  // obvious: back where it came from, or on the plane you are working on.
  const [asking, setAsking] = useState(false)
  const move = (name: NudgeName) => () => { const n = nudgeFor(useBenchView.getState().axes, name); w().moveSelected(n.axis, n.delta * w().step()) }
  const sub = (name: NudgeName): string => nudgeLabel(nudgeFor(axes, name))
  const arrows: Array<{ cell: string; glyph: string; name: NudgeName; key: string }> = [
    { cell: 'away', glyph: '⊗', name: 'away', key: 'R' },
    { cell: 'up', glyph: '▲', name: 'up', key: 'W' },
    { cell: 'toward', glyph: '⊙', name: 'toward', key: 'F' },
    { cell: 'left', glyph: '◀', name: 'left', key: 'A' },
    { cell: 'right', glyph: '▶', name: 'right', key: 'D' },
    { cell: 'down', glyph: '▼', name: 'down', key: 'S' },
  ]
  return (
    <div className="benchpad" role="group" aria-label="Move the selected points">
      {points > 0 && (<>
      {arrows.map((a) => (
        <button key={a.cell} className={`touchpad__key touchpad__key--${a.cell}`} title={`${a.name} (${a.key}): ${sub(a.name)}`} aria-label={`Move ${a.name}, ${sub(a.name)}`} {...bind(move(a.name))}>
          {a.glyph}
          <span className="touchpad__sub">{sub(a.name)}</span>
        </button>
      ))}
      <button className="touchpad__key touchpad__key--connect" title="Select everything joined by faces (C)" aria-label="Select connected" {...noCallout} onClick={() => w().selectConnected()}>
        <Link size={14} strokeWidth={2.25} aria-hidden />
        <span className="touchpad__sub">JOINED</span>
      </button>
      <button className="touchpad__key touchpad__key--delete" title="Delete the selected points (Del)" aria-label="Delete selected" {...noCallout} onClick={() => w().deleteSelected()}>
        <Trash2 size={14} strokeWidth={2.25} aria-hidden />
        <span className="touchpad__sub">DELETE</span>
      </button>
      <button className="touchpad__hub" title="Clear the selection (Esc)" aria-label={`${points} points selected. Tap to clear.`} {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); w().selectVertex(null) }}>
        {points} {points === 1 ? 'PT' : 'PTS'}
      </button>
    </>)}

      {/* The clipboard, on the end of the row DELETE sits in: with points in
          hand, take them or copy them; with nothing in hand, put back what is
          held, in the cell CUT had. */}
      {points > 0 ? (
        <>
          <button className="touchpad__key touchpad__key--cut" title="Cut the selected points, and their faces, to the clipboard" aria-label="Cut the selection" {...noCallout} onClick={() => w().cutSelection()}>
            <Scissors size={15} strokeWidth={2.25} aria-hidden />
          </button>
          <button className="touchpad__key touchpad__key--dup" title="Duplicate the selected points where they stand, ready to be moved" aria-label="Duplicate the selection" {...noCallout} onClick={() => w().duplicateSelection()}>
            <Copy size={15} strokeWidth={2.25} aria-hidden />
          </button>
        </>
      ) : clip !== null && (
        <button className="touchpad__key touchpad__key--cut" title={`Paste the ${clip.points.length} held point${clip.points.length === 1 ? '' : 's'}`} aria-label="Paste the held points" aria-haspopup="menu" aria-expanded={asking} {...noCallout} onClick={() => setAsking(true)}>
          <ClipboardPaste size={15} strokeWidth={2.25} aria-hidden />
        </button>
      )}

      {asking && (
        <>
          {/* Anywhere else puts the question away and pastes nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(false)} />
          <div className="benchpaste" role="menu" aria-label="Where to paste">
            <button className="workshop__btn" role="menuitem" title="Back on the exact points they were taken from" onClick={() => { setAsking(false); w().pasteClip('exact') }}>PASTE</button>
            <button className="workshop__btn" role="menuitem" title="Resting on the plane you are working on, keeping its shape" onClick={() => { setAsking(false); w().pasteClip('floor') }}>PASTE FLOOR</button>
          </div>
        </>
      )}
    </div>
  )
}


/**
 * FLIP, for the FACE tool. Which way a face looks is its winding (DECK-0003
 * §1.4), and this is how an author turns it. It asks how much before it
 * turns anything, the way PASTE asks where: the face in hand, its whole
 * surface, or every face by the bench's outward guess. AUTO needs no face.
 */
function FlipKey({ face }: { face: number | null }): JSX.Element {
  const w = useWorkshop.getState
  const [asking, setAsking] = useState(false)
  const pick = (fn: () => void) => (): void => { setAsking(false); fn() }
  return (
    <div className="benchflip">
      <button className="workshop__btn" aria-haspopup="menu" aria-expanded={asking} onClick={() => setAsking((o) => !o)} title="Turn faces round: which side is the front">
        <FlipVertical2 size={12} strokeWidth={2.25} aria-hidden /> FLIP
      </button>
      {asking && (
        <>
          {/* Anywhere else puts the question away and turns nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(false)} />
          <div className="benchpaste benchpaste--flip" role="menu" aria-label="What to flip">
            <button className="workshop__btn" role="menuitem" disabled={face === null} title="This face turned round, its back to the front" onClick={pick(() => w().flipSelectedFace())}>FLIP FACE</button>
            <button className="workshop__btn" role="menuitem" disabled={face === null} title="This face turned round, and every face joined to it by an edge turned to agree" onClick={pick(() => w().flipSelectedSurface())}>FLIP SURFACE</button>
            <button className="workshop__btn" role="menuitem" title="Every face in the object turned to look outward, by the bench's best guess" onClick={pick(() => w().autoWind())}>AUTO</button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The view pad, for the bench: the arrows turn the working grid a quarter
 * while the geometry stays put, so the next points go down on another plane.
 * Up and down tip it about the screen's horizontal, left and right roll it
 * about the line of sight (benchAxes planeAfter). SUN is the black sun's seat
 * here: the grid back on the floor and the camera back where the bench opens.
 */
function BenchViewMenu(): JSX.Element {
  const w = useWorkshop.getState
  const press = (fn: () => void) => (e: React.PointerEvent): void => { e.preventDefault(); e.stopPropagation(); fn() }
  const turn = (about: 'tip' | 'roll') => (): void => w().setPlane(planeAfter(w().plane, useBenchView.getState().axes, about))
  return (
    <div className="viewmenu viewmenu--bench" role="group" aria-label="Grid controls">
      <div className="viewmenu__pad">
        <button className="viewmenu__key viewmenu__key--up" {...noCallout} onPointerDown={press(turn('tip'))} aria-label="Tip the grid up">▲</button>
        <button className="viewmenu__key viewmenu__key--left" {...noCallout} onPointerDown={press(turn('roll'))} aria-label="Roll the grid left">◀</button>
        <span className="viewmenu__hub" aria-hidden="true">GRID</span>
        <button className="viewmenu__key viewmenu__key--right" {...noCallout} onPointerDown={press(turn('roll'))} aria-label="Roll the grid right">▶</button>
        <button className="viewmenu__key viewmenu__key--down" {...noCallout} onPointerDown={press(turn('tip'))} aria-label="Tip the grid down">▼</button>
      </div>
      <div className="viewmenu__row">
        <button className="viewmenu__op" {...noCallout} onPointerDown={press(() => { w().setPlane(FLOOR); requestView({ kind: 'home' }) })} title="The grid back on the floor, the view back where the bench opens">RESET</button>
      </div>
    </div>
  )
}

/**
 * The mark inside a round icon button, in pixels.
 *
 * One number for the whole app: the touchpad's EARTH and cube keys are 38px
 * squares with a 16px mark, and every other round icon button matches them so
 * a hand learns one size. A new icon button takes this, not a number of its
 * own.
 */
const ICON_PX = 16


/**
 * Put the object a /workshop/naddr1... route names on the bench, and keep the
 * address bar honest about what is there.
 *
 * Your own object, still in this browser, opens as itself: a copy of it would
 * be a second object beside the one you published. Anything else opens as a
 * view (useWorkshop viewing), which becomes a copy in your objects the moment
 * it is changed.
 *
 * The other direction: once something else is put on the bench, by picking
 * another object or making a new one, the naddr no longer describes it, so the
 * route quietly becomes /workshop. That is watched as a transition in the
 * store's `address`, from set to cleared, rather than as a value, because at
 * load it is null before the object has resolved and that must not throw the
 * link away.
 */
function useOpenAddress(address: string | null): void {
  useEffect(() => {
    if (!address) return
    let cancelled = false
    void (async () => {
      // A beat, so the app's own start-up (which selects an object) runs first
      // and does not replace the one this link opens.
      await Promise.resolve()
      const n = useNostr.getState()
      const w = useWorkshop.getState()
      const where = decodeObjectAddress(address)
      if (!where) {
        n.say('That link does not point at an object.')
        useRoute.getState().go({ view: 'make', address: null }, { replace: true })
        return
      }
      const own = n.pubkey === where.pubkey
      if (own && w.shards.some((x) => x.id === where.d)) { w.select(where.d, address); return }
      const o = await n.fetchObject(address)
      if (cancelled || !o) return
      w.view(o.shard, { d: o.d, own: o.pubkey === useNostr.getState().pubkey, address })
    })()
    return () => { cancelled = true }
  }, [address])

  useEffect(() => useWorkshop.subscribe((next, prev) => {
    const r = useRoute.getState().route
    if (prev.address && !next.address && r.view === 'make' && r.address) {
      useRoute.getState().go({ view: 'make', address: null }, { replace: true })
    }
  }), [])
}

export function Workshop(): JSX.Element | null {
  const open = useWorkshop((s) => s.open)
  const shard = useWorkshop((s) => s.current())
  const shards = useWorkshop((s) => s.shards)
  const tool = useWorkshop((s) => s.tool)
  const selection = useWorkshop((s) => s.selection)
  const facePick = useWorkshop((s) => s.facePick)
  const selectedFace = useWorkshop((s) => s.selectedFace)
  const level = useWorkshop((s) => s.level)
  const plane = useWorkshop((s) => s.plane)
  const division = useWorkshop((s) => s.division)
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const signedIn = useNostr((s) => s.signedIn)
  const publishing = useNostr((s) => s.publishing)
  const nostrNotice = useNostr((s) => s.notice)
  // Where you are is the address bar's business now (lib/route), so a link can
  // land on the feed or on one object, and the phone's back gesture works.
  const route = useRoute((s) => s.route)
  const go = useRoute((s) => s.go)
  const view: 'make' | 'feed' = route.view
  const openedAddress = route.view === 'make' ? route.address : null
  const setView = (v: 'make' | 'feed'): void => go(v === 'feed' ? { view: 'feed' } : { view: 'make', address: null })
  useOpenAddress(openedAddress)
  const [loginOpen, setLoginOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const ledger = useNostr((s) => s.published)
  const pubkey = useNostr((s) => s.pubkey)
  // One place things are said: publishing speaks through the workshop's toast
  // rather than opening a second channel beside it.
  useEffect(() => {
    if (nostrNotice) { useWorkshop.setState({ notice: nostrNotice }); useNostr.getState().say(null) }
  }, [nostrNotice])
  const buildable = shard !== null && shard.vertices.length > 0
  const bytes = useMemo(() => (shard ? new TextEncoder().encode(JSON.stringify(toPayload(shard))).length : 0), [shard])
  // Where this object stands with the relays. The bench cannot show it: a
  // published object and one that has never left the browser look the same.
  const state = useMemo(
    () => publishState(shard ? ledger[shard.id] : undefined, shard ? shardFingerprint(shard) : '', pubkey),
    [shard, ledger, pubkey],
  )
  const color = useWorkshop((s) => s.color)
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const clip = useWorkshop((s) => s.clip)
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  // On a phone the open colour bar and the TOOLS panel share the bottom, so
  // they take turns; on a wide screen they have corners of their own.
  const [narrow, setNarrow] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = (): void => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  // ADD, SELECT and FACE have nothing under them, so choosing one by key puts
  // the TOOLS panel away; STAMP keeps it for the shape, size and facing.
  useEffect(() => { if (tool !== 'stamp') setPanel((p) => (p === 'tools' ? null : p)) }, [tool])
  // The view pad shuts on a tap anywhere else. It no longer shuts when the
  // tool changes: the plane it turns is the one every tool places on.
  useEffect(() => {
    if (!viewOpen) return
    const shut = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.viewmenu, .compass-3d')) return
      setViewOpen(false)
    }
    document.addEventListener('pointerdown', shut, true)
    return () => document.removeEventListener('pointerdown', shut, true)
  }, [viewOpen])
  const bind = useRepeatable()

  if (!open) return null
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  const toggle = (p: Panel): void => setPanel((cur) => (cur === p ? null : p))

  const selectedPoints = shard ? new Set(selection.map((i) => { const v = shard.vertices[i]; return v ? ticksOf(v).join(',') : '' })).size : 0
  const one = selection.length === 1 && shard ? shard.vertices[selection[0]] : null
  const extent = shard?.extent ?? MIN_EXTENT
  const minExtent = shard ? Math.max(MIN_EXTENT, neededExtent(shard)) : MIN_EXTENT

  // The picker paints live and, once the wheel has settled, puts the color at
  // the front of the palette; leaving the picker settles it at once.
  const hex = rgbToHex(color)
  const copy = (id: string): void => {
    const s = w().shards.find((x) => x.id === id)
    if (!s) return
    navigator.clipboard?.writeText(JSON.stringify(toPayload(s))).then(() => say(`Copied "${s.name}" to the clipboard. PASTE it here or anywhere.`)).catch(() => say('The clipboard is not available here.'))
  }
  const importText = (text: string): void => {
    const id = w().importText(text)
    if (id) { setPasteOpen(false); setPasteText(''); say('Pasted as a new shard.'); return }
    // The store has already said why, in a toast. Open the box holding what
    // arrived, so a paste that failed can be looked at and corrected rather
    // than vanishing: a clipboard read that went wrong used to leave nothing
    // on screen at all, which is indistinguishable from the button not working.
    setPasteOpen(true)
    setPasteText(text)
  }
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) { importText(text); return }
    } catch { /* no permission or no API: fall through to the box */ }
    setPasteOpen(true)
  }

  const facing = tool === 'face' && selection.length === 0 && (selectedFace !== null || facePick.length > 0)
  const ToolIcon = TOOL_ICON[tool]
  const making = view === 'make'

  return (
    <div className="workshop" role="dialog" aria-label="Shard workshop">
      <div className="workshop__bench">
        {view === 'feed' ? <Feed onOpen={() => setView('make')} /> : <Bench />}
      </div>
      {making && <Intro />}
      <Toast />
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {menuOpen && <MenuOverlay view={view} setView={setView} onClose={() => setMenuOpen(false)} onLogin={() => setLoginOpen(true)} />}

      {/* Top left: the chips and the history in one row, wrapping on a phone,
          and the open panel under whatever the row wrapped to. On the feed only
          the hamburger stays, because it is the way back out. */}
      <div className={`ws__top ${panel && making ? 'ws__top--open' : ''}`}>
      <div className="ws__chips">
        {/* The app, as against the object: who you are, and the two places you
            can be. The chips beside it stay what they are, the tools for the
            thing on the bench. */}
        {/* Back to the feed, to the tile you left, when this object was opened
            from an address. The same button as the menu beside it, so the two
            read as the app's own controls rather than the object's. */}
        {openedAddress && (
          <button className="chip ws__icon ws__burger" aria-label="Back to the feed" title="Back to the feed, where you left it" onClick={() => useRoute.getState().back()}>
            <ArrowLeft size={20} strokeWidth={2.25} aria-hidden />
          </button>
        )}
        <button className={`chip ws__icon ws__burger ${menuOpen ? 'is-on' : ''}`} aria-expanded={menuOpen} aria-label="Menu" title="Identity, feed and workshop" onClick={() => setMenuOpen(true)}>
          <span className="hamburger-icon" aria-hidden><span /><span /><span /></span>
        </button>
        {making && (
          <button className={`chip ws__chip ${panel === 'menu' ? 'is-on' : ''}`} aria-pressed={panel === 'menu'} onClick={() => toggle('menu')}>
            <Box size={12} strokeWidth={2.25} aria-hidden />MENU
          </button>
        )}
        {making && (
          <button className={`chip ws__chip ${panel === 'grid' ? 'is-on' : ''}`} aria-pressed={panel === 'grid'} onClick={() => toggle('grid')}>
            <Grid3x3 size={12} strokeWidth={2.25} aria-hidden />GRID
          </button>
        )}
        {making && publishing && (
          <button className="chip ws__chip ws__chip--work" aria-live="polite">
            <Pickaxe size={12} strokeWidth={2.25} aria-hidden />PUBLISHING
          </button>
        )}
        {/* Out of the way while a panel is open: on a phone they wrapped the chip
            row onto a second line and pushed the panel down with it. */}
        {making && !panel && (
          <span className="ws__history">
            <button className="chip ws__icon" disabled={!canUndo} onClick={() => w().undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={ICON_PX} strokeWidth={2.25} aria-hidden /></button>
            <button className="chip ws__icon" disabled={!canRedo} onClick={() => w().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={ICON_PX} strokeWidth={2.25} aria-hidden /></button>
          </span>
        )}
      </div>
      {making && panel === 'menu' && shard && (
        <div className="ws__panel" role="region" aria-label="Menu">
          <input className="workshop__name" value={shard.name} onChange={(e) => w().rename(shard.id, e.target.value)} aria-label="Shard name" spellCheck={false} />
          <div className="ws__stats">
            {shard.vertices.length} vertices · {shard.faces.length} faces
            {shard.mode !== 'solid' && shard.faces.length > 0 && <> · faces draw in SOLID</>}
            {shard.facecolors && <> · <button className="workshop__link" onClick={() => w().clearFaceColors()} title="Give every face back to its corners, so colors blend across them again">{shard.facecolors.length} face colors, clear</button></>}
          </div>
          <div className="workshop__row">
            <span className="workshop__label">DRAW</span>
            <div className="workshop__modes" role="group" aria-label="Render mode">
              {MODES.map((m: ShardMode) => (
                <button key={m} className={`workshop__mode ${shard.mode === m ? 'is-on' : ''}`} aria-pressed={shard.mode === m} onClick={() => w().setMode(m)}>{m.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {/* Publishing: what this app does with an object instead of hiding it
              at a place. No work to mine and no coordinate to compute, so the
              whole of it is a key and a button. */}
          {/* Publishing: what this app does with an object instead of hiding it
              at a place. The key itself lives in the menu, so this stays about
              the object: where it stands with the relays, and the two ways out
              of here. */}
          <div className="workshop__avatar" role="group" aria-label="Publishing">
            <div className="workshop__row">
              <span className="workshop__label">RELAYS</span>
              <span className={`tag ${STATE_TAG[state]}`} title={STATE_HELP[state]}>{STATE_LABEL[state]}</span>
              <span className="workshop__gap" />
            </div>
            <div className="workshop__list-row">
              <button className="workshop__btn workshop__btn--warn" disabled={!buildable || publishing || !signedIn} onClick={() => { const mine = w().adopt(); if (mine) void useNostr.getState().publish(mine) }} title={!signedIn ? 'Choose a key in the menu first' : STATE_HELP[state]}>{publishing ? 'PUBLISHING' : state === 'published' ? 'PUBLISH AGAIN' : 'PUBLISH'}</button>
              <button className="workshop__btn" disabled={!buildable} onClick={() => { if (shard) saveFile(toPly(shard), fileNameFor(shard, 'ply')) }} title="Save as a PLY, which Blender and MeshLab read">EXPORT PLY</button>
            </div>
            <span className="workshop__work">{bytes.toLocaleString('en-US')} BYTES ON THE WIRE · {shard.vertices.length} VERTICES + {shard.faces.length} FACES</span>
          </div>
          <div className="ws__panel-title">OBJECTS ({shards.length})</div>
          <div className="workshop__list-row">
            <button className="workshop__new" onClick={() => w().create()}>+ NEW OBJECT</button>
            <button className="workshop__btn" onClick={() => void paste()} title="A shard copied from here or anywhere">PASTE</button>
          </div>
          {pasteOpen && (
            <div className="workshop__paste">
              <textarea className="workshop__paste-box" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'Paste an object here, or a shard copied from ONOSENDAI:\n{"v":2,"name":"...","vertices":[[0,0,0]],"faces":[]}'} aria-label="Shard to import" spellCheck={false} />
              <div className="workshop__list-row">
                <button className="workshop__btn" disabled={!pasteText.trim()} onClick={() => importText(pasteText)}>IMPORT</button>
                <button className="workshop__btn" onClick={() => { setPasteOpen(false); setPasteText('') }}>CANCEL</button>
              </div>
            </div>
          )}
          <ul className="workshop__list">
            {shards.map((s) => (
              <li key={s.id} className={s.id === shard.id ? 'is-current' : ''}>
                <button className="workshop__pick" onClick={() => w().select(s.id)}>
                  <span className="workshop__pick-name">{s.name}</span>
                  <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f · {s.mode}</span>
                </button>
                <button className="workshop__mini" title="Duplicate" onClick={() => w().duplicate(s.id)}>⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copy(s.id)}>COPY</button>
                <button className="workshop__mini workshop__mini--danger workshop__mini--x" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>×</button>
              </li>
            ))}
          </ul>
          <div className="workshop__row">
            <button className="workshop__btn workshop__btn--danger" disabled={shard.vertices.length === 0} onClick={() => { if (window.confirm('Delete all vertices and faces in the scene?')) w().clearShard() }} title="Empty this scene (undoable)">CLEAR THIS SCENE</button>
            <span className="workshop__gap" />
            <Explanation>
              An object is colored points on a grid of whole units, drawn SOLID (faces, colors blending
              across them), POINTS (every point a light) or LINES (one line through the points in the
              order they were made). STAMP places a whole shape; ADD one point; SELECT points, by tap
              or by dragging a box, to move, color or delete them together, and JOINED takes everything
              faces join to them; FACE picks corners and FILL joins them, and a tap on a face selects it
              for DELETE FACE. The swatch in the corner is the color in hand; tap it for all 256 and
              for the palettes this object can be put on. Above it are the three things a color can
              reach: the points in hand, the piece they are joined to by faces, and the whole object. Stamps keep their
              own corners even where they touch, so a red block against a blue one keeps a crisp edge.
              Under GRID, LEVEL is the height the placing tools work at, SCALE says how big one grid
              unit is, from a picometre upward, GRID SIZE is how far the grid reaches from the origin,
              and SIZE REFERENCE puts a person at the centre to judge it against. Keys: 1 2 3 4 tools,
              Q turns a stamp, WASD and RF or the arrows nudge the selection in screen directions, C
              selects what faces join, Del deletes, Enter fills, [ ] change the level, Ctrl+Z undoes,
              Esc clears then closes.
            </Explanation>
          </div>
        </div>
      )}

      {making && panel === 'grid' && shard && (
        <div className="ws__panel" role="region" aria-label="Grid">
          <div className="workshop__row">
            <span className="workshop__label">LEVEL {'XYZ'[plane]}</span>
            <button className="workshop__btn" {...bind(() => w().setLevel(w().level - w().step()))} disabled={level <= -extent * TICKS_PER_UNIT} aria-label="Level down">−</button>
            <span className="workshop__value">{unitsLabel(level)}</span>
            <button className="workshop__btn" {...bind(() => w().setLevel(w().level + w().step()))} disabled={level >= extent * TICKS_PER_UNIT} aria-label="Level up">+</button>
            <span className="workshop__unit-size">the height the placing tools work at</span>
          </div>
          <div className="workshop__row">
            <span className="workshop__label">SCALE</span>
            <span className="workshop__value">2^</span>
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) - 1))} disabled={shard.unit <= 0} aria-label="Smaller unit">−</button>
            <span className="workshop__value">{shard.unit}</span>
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) + 1))} disabled={shard.unit >= MAX_UNIT} aria-label="Larger unit">+</button>
            <span className="workshop__unit-size" title="How big one grid unit is. It is saved with the object, so anyone who opens it sees it at this size.">one unit = {formatCellSize(shard.unit)}</span>
          </div>
          <div className="workshop__row" role="group" aria-label="Grid division">
            <span className="workshop__label">DIVISION</span>
            <div className="workshop__modes workshop__modes--divisions">
              {DIVISIONS.map((d) => (
                <button key={d} className={`workshop__mode ${division === d ? 'is-on' : ''}`} aria-pressed={division === d} onClick={() => w().setDivision(d)} title={d === 1 ? 'Snap to whole units' : `Snap to 1/${d} of a unit`}>{d === 1 ? '1' : `1/${d}`}</button>
              ))}
            </div>
            <span className="workshop__unit-size" title="Where taps, the box, nudges and the level land. Positions already placed keep their exact spots.">the snap for placing and nudging</span>
          </div>
          <div className="workshop__row">
            <span className="workshop__label">GRID SIZE</span>
            <button className="workshop__btn" {...bind(() => w().setExtent((w().current()?.extent ?? MIN_EXTENT) - 1))} disabled={extent <= minExtent} aria-label="Smaller grid">−</button>
            <span className="workshop__value">{extent}</span>
            <button className="workshop__btn" {...bind(() => w().setExtent((w().current()?.extent ?? MIN_EXTENT) + 1))} disabled={extent >= MAX_EXTENT} aria-label="Larger grid">+</button>
            <span className="workshop__unit-size" title="Saved with the shard. Never below what its points need.">units each side of each axis</span>
          </div>
          <div className="workshop__row" role="group" aria-label="Size reference">
            <span className="workshop__label">SIZE REFERENCE</span>
            <div className="workshop__modes">
              <button className={`workshop__mode ${showAvatar ? 'is-on' : ''}`} aria-pressed={showAvatar} onClick={() => w().setShowAvatar(true)} title="Show the to-scale avatar at the grid's centre">SHOW</button>
              <button className={`workshop__mode ${!showAvatar ? 'is-on' : ''}`} aria-pressed={!showAvatar} onClick={() => w().setShowAvatar(false)} title="Hide it">HIDE</button>
            </div>
          </div>

        </div>
      )}

      </div>

      {/* The top right corner, one column: the one thing you do with a finished
          object, the compass under it, and the grid pad under that when the
          compass is tapped. One width for all three, so the corner is a column
          and not a scatter, and the chip row reserves exactly that width. */}
      {making && (
        <div className="ws__view">
          <button
            className="workshop__deploy ws__publish"
            disabled={!buildable || publishing || !signedIn}
            onClick={() => { const mine = w().adopt(); if (mine) void useNostr.getState().publish(mine) }}
            title={!signedIn ? 'Choose a key in the menu first' : STATE_HELP[state]}
          >{publishing ? 'SENDING' : 'PUBLISH'}</button>
          <Compass3D pose={benchPose} onTap={() => setViewOpen((o) => !o)} />
          {viewOpen && <BenchViewMenu />}
        </div>
      )}

      {/* Bottom left: TURN and the pad while points are selected, over TOOLS and
          its panel, which opens upward over the chip. */}
      {making && (
      <div className="ws__tools">
        {selection.length > 0 && (
          <div className="benchturn" role="group" aria-label="Turn the selection">
            <button className="touchpad__key" title="A quarter turn left, in the working plane (Q)" aria-label="Turn left" {...noCallout} onClick={() => w().rotateSelected(-1)}>
              <RotateCcw size={18} strokeWidth={2.25} aria-hidden />
              <span className="touchpad__sub">LEFT</span>
            </button>
            <button className="touchpad__key" title="A quarter turn right (E)" aria-label="Turn right" {...noCallout} onClick={() => w().rotateSelected(1)}>
              <RotateCw size={18} strokeWidth={2.25} aria-hidden />
              <span className="touchpad__sub">RIGHT</span>
            </button>
          </div>
        )}
        {(selection.length > 0 || (tool === 'select' && clip !== null)) && <ControlsPad points={selectedPoints} />}
      {panel === 'tools' && (
        <div className="ws__panel ws__panel--up" role="region" aria-label="Tools">
          <div className="workshop__row" role="group" aria-label="Tool">
            {TOOLS.map((t, i) => {
              const Icon = TOOL_ICON[t]
              return (
                <button key={t} className={`workshop__tool ${tool === t ? 'is-on' : ''}`} aria-pressed={tool === t} onClick={() => { w().setTool(t); if (t !== 'stamp') setPanel(null) }} title={`${t} (${i + 1})`}>
                  <Icon size={12} strokeWidth={2.25} aria-hidden />{t.toUpperCase()}
                </button>
              )
            })}
          </div>
          {TOOL_HELP[tool] && <div className="workshop__help">{TOOL_HELP[tool]}</div>}
          {tool === 'stamp' && (
            <>
              <div className="workshop__row" role="group" aria-label="Shape">
                <span className="workshop__label">SHAPE</span>
                <div className="workshop__shapes">
                  {STAMPS.map((k: StampKind) => (
                    <button key={k} className={`workshop__tool ${stampKind === k ? 'is-on' : ''}`} aria-pressed={stampKind === k} onClick={() => w().setStampKind(k)} title={STAMP_HELP[k]}>{k.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div className="workshop__row">
                <span className="workshop__label">SIZE</span>
                <button className="workshop__btn" {...bind(() => w().setStampSize(w().stampSize - 1))} disabled={stampSize <= MIN_SIZE} aria-label="Smaller">−</button>
                <span className="workshop__value">{stampSize}</span>
                <button className="workshop__btn" {...bind(() => w().setStampSize(w().stampSize + 1))} disabled={stampSize >= MAX_SIZE} aria-label="Larger">+</button>
                {FACED[stampKind] && (
                  <>
                    <span className="workshop__label workshop__label--gap">FACING</span>
                    <button className="workshop__btn" onClick={() => w().turnStamp()} title="Turn a quarter (Q)">{FACING_LABEL[stampFacing]} ↻</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

        {/* The tool in hand, and an X joined to the chip that puts it down: VIEW,
            the tool that builds nothing. */}
        <div className="ws__toolchips">
          <button className={`chip ws__chip ${panel === 'tools' ? 'is-on' : ''}`} aria-pressed={panel === 'tools'} onClick={() => toggle('tools')}>
            <Wrench size={12} strokeWidth={2.25} aria-hidden />TOOLS · <ToolIcon size={12} strokeWidth={2.25} aria-hidden />{tool.toUpperCase()}
          </button>
          {tool !== 'view' && (
            <button className="chip ws__chip ws__chip--x" onClick={() => w().setTool('view')} title="Put the tool down (1)" aria-label="Put the tool down">
              <X size={13} strokeWidth={2.25} aria-hidden />
            </button>
          )}
          {/* Where the one selected point is, in the gap this row leaves before
              the colour chip. A readout, so taps go through to the bench. */}
          {one && (
            <span className="ws__at" role="status" aria-label="Selected point">
              at ({publishedFrame(ticksOf(one)).map(unitsLabel).join(', ')})
            </span>
          )}
        </div>
      </div>
      )}

      {/* Bottom right: FILL for a set of points, face actions while a face is in
          hand, the color column under either. */}
      {making && (
      <div className="ws__corner">
        {selectedPoints >= 3 && (
          <div className="benchops" role="group" aria-label="Fill the selection">
            <button className="workshop__btn" onClick={() => w().fillSelection()} title="Faces across these points: a flat set becomes one face, a solid set its hull (Enter)">
              <Triangle size={12} strokeWidth={2.25} aria-hidden /> FILL
            </button>
          </div>
        )}
        {facing && selectedFace !== null && (
          <div className="benchops" role="group" aria-label="Selected face">
            <span className="workshop__value workshop__value--wide">face {selectedFace + 1} of {shard?.faces.length ?? 0}</span>
            <FlipKey face={selectedFace} />
            {/* A hard colour, which colouring the corners cannot give: a corner
                belongs to every face touching it, so that bleeds across the
                shared edges. This stops at the edge. */}
            <button className="workshop__btn" onClick={() => w().colorFace(selectedFace, w().color)} title="Give this face the current color as a hard seam, not blended from its corners">
              <PaintBucket size={12} strokeWidth={2.25} aria-hidden /> SEAM
            </button>
            <button className="workshop__btn workshop__btn--danger" onClick={() => w().deleteSelectedFace()} title="Remove this face (Del)">DELETE FACE</button>
            <button className="workshop__btn" onClick={() => w().selectFace(null)} title="Keep it (Esc)">CANCEL</button>
          </div>
        )}
        {/* FACE in hand and nothing picked: FLIP alone, so AUTO is always
            reachable; FLIP FACE and FLIP SURFACE wait for a face. */}
        {tool === 'face' && !facing && selection.length === 0 && (shard?.faces.length ?? 0) > 0 && (
          <div className="benchops" role="group" aria-label="Flip">
            <FlipKey face={null} />
          </div>
        )}
        {facing && selectedFace === null && (
          <div className="benchops" role="group" aria-label="Face corners">
            <span className="workshop__value workshop__value--wide">{facePick.length} corner{facePick.length === 1 ? '' : 's'}</span>
            <button className="workshop__btn" disabled={facePick.length < 3} onClick={() => w().fill()} title="Join the corners into a face (Enter)">FILL</button>
            <button className="workshop__btn" onClick={() => w().clearFacePick()} title="Drop the picks (Esc)">CANCEL</button>
            <FlipKey face={null} />
          </div>
        )}
        {/* What an action reaches, a column over the chip, widest at the top:
            the whole object, the piece the points in hand are joined to, the
            points themselves, nearest the chip (arkinox, 2026-09-24). These used to sit inside
            a column the chip unfolded into, along with eight remembered
            swatches and a second way to open the palette. The palette modal
            replaced all three of those, so the column was a worse copy of it
            wrapped around the only part worth keeping. */}
        {(tool !== 'face' || selectedFace !== null) && (
          <div className="ws__acts" role="group" aria-label="Apply the color">
            <button className="workshop__color ws__act" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="The color onto every vertex in the object" aria-label="Color everything" {...noCallout}>
              <Globe size={17} strokeWidth={2.25} aria-hidden />
            </button>
            {selection.length > 0 && (
              <button className="workshop__color ws__act" onClick={() => w().colorConnected(w().color)} title="The color onto these points and everything joined to them by faces" aria-label="Color the connected piece" {...noCallout}>
                <Waypoints size={17} strokeWidth={2.25} aria-hidden />
              </button>
            )}
            {selection.length > 0 && (
              <button className="workshop__color ws__act" onClick={() => w().colorSelected(w().color)} title="The color onto the points in hand" aria-label="Color the selected points" {...noCallout}>
                <PaintBucket size={17} strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </div>
        )}
        {/*
          Always here, including under FACE with nothing selected.

          The row above it is hidden then, because those buttons apply a color
          and there is nothing to apply one to. This does not apply anything:
          it is the color in hand, and choosing it before picking the face to
          put it on is the obvious order to work in. Hiding it meant selecting
          a face you did not want yet just to reach the palette.
        */}
        <button
          className="chip ws__colorchip"
          style={{ background: hex }}
          onClick={() => { setPickerOpen(true); if (narrow && panel === 'tools') setPanel(null) }}
          title={`${hex}. Tap for all 256.`}
          aria-label={`Color ${hex}, tap to open the palette`}
        />
        {pickerOpen && <PaletteModal onClose={() => setPickerOpen(false)} />}
      </div>
      )}

    </div>
  )
}
