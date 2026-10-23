/**
 * ShardFolders.tsx - the folders every list of your objects is sorted into:
 * the workshop's OBJECTS, the menu's WORKSHOP and the feed's MINE. One
 * component over one store (store/useShardFolders.ts), so the lists show the
 * same folders and behave the same; ONOSENDAI's (hud/ShardFolders.tsx) is the
 * same component in that app's skin.
 *
 * It renders into the caller's own list: a bar (FOLDER, SELECT), then the
 * folders, then the objects in no folder. Each object is still the caller's
 * own row or tile, drawn by `row`; the kit it is handed adds what a row needs
 * to be filed: drag props for it and one small tool, MOVE TO FOLDER, or a
 * checkbox while SELECT is on. Dragging is for a mouse; the tool works
 * everywhere, phones included. A list of tiles (the feed) passes
 * `tag="div"` and the class of its grid, and a folder's contents are a grid
 * of their own under its head.
 *
 * A folder's head folds it (the fold is kept), and holds RENAME, NEW FOLDER
 * inside it, MOVE and DELETE. Deleting never touches an object: what was in
 * the folder moves up to its parent.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderInput, FolderPlus, Pencil, X } from 'lucide-react'
import { buildTree, canonical, flatFolders, parentOf, folderOf, isWithin, pathOf, type FolderNode, type FolderTree } from '../lib/shardFolders'
import { useShardFolders } from '../store/useShardFolders'
import { useNostr } from '../store/useNostr'
import { ConfirmModal } from './ConfirmModal'

/** The drag payload's type, so a file dragged onto the workshop is never read as an object. */
const DRAG_TYPE = 'application/x-sno-folder-item'

type Dragged = { kind: 'shards'; refs: string[] } | { kind: 'folder'; id: string }

/** What a shard row is handed to be filed. */
export interface RowKit {
  /** Spread on the row's <li>. */
  drag: {
    draggable?: boolean
    onDragStart?: (e: DragEvent) => void
    onDragEnd?: () => void
  }
  /** MOVE TO FOLDER, or the row's checkbox while selecting. */
  tool: JSX.Element
}

interface Props<T> {
  items: readonly T[]
  refOf: (item: T) => string
  nameOf: (item: T) => string
  /** The caller's own row, an <li> (or a tile in a grid); put kit.drag on it and kit.tool inside it. */
  row: (item: T, kit: RowKit) => JSX.Element
  /** What the caller's list is made of: rows in a <ul> (the default), or tiles in a <div> grid. */
  tag?: 'ul' | 'div'
  /** A class for each folder's own list, beside sfold__kids: the grid's, for tiles. */
  kidsClassName?: string
}

/**
 * Escape for whatever is open on top here (the chooser, the rename field, a
 * confirmation), ahead of everything else that listens for it: the
 * workshop's own Escape (ui/escape.ts) would otherwise close its panel from
 * under the chooser. One listener, taken on the way down at the window, and
 * only the most recently opened of these answers it, so one press closes one
 * thing even with a list in the menu and one in the workshop. The key is
 * matched by `code` too, as the workshop matches it, so a press during IME
 * composition is still ours.
 */
const escapeStack: Array<{ current: () => void }> = []
function onEscapeKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' && e.code !== 'Escape') return
  const top = escapeStack[escapeStack.length - 1]
  if (!top) return
  e.stopImmediatePropagation()
  e.preventDefault()
  top.current()
}
function useEscapeFirst(close: () => void): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    const entry = latest
    escapeStack.push(entry)
    if (escapeStack.length === 1) window.addEventListener('keydown', onEscapeKey, true)
    return () => {
      const at = escapeStack.indexOf(entry)
      if (at >= 0) escapeStack.splice(at, 1)
      if (escapeStack.length === 0) window.removeEventListener('keydown', onEscapeKey, true)
    }
  }, [])
}

/** A workshop model's ref and name, for the lists of models (stable, so the tree is not rebuilt every render). */
export const modelRef = (s: { id: string }): string => s.id
export const modelName = (s: { name: string }): string => s.name

/** Whether there is a mouse to drag with: phones get the tool alone, so a long press stays a press. */
function canDrag(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function readDrag(e: DragEvent): Dragged | null {
  try {
    const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Dragged
    if (d.kind === 'shards' && Array.isArray(d.refs)) return d
    if (d.kind === 'folder' && typeof d.id === 'string') return d
  } catch { /* not ours */ }
  return null
}

/**
 * The folder being dragged, if one is: a drop target cannot read the drag's
 * data until the drop, and it needs to know sooner whether to light up.
 */
let draggingFolder: string | null = null

const ours = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes(DRAG_TYPE)

/** What the chooser is moving: shards, or one folder. */
type Moving = { kind: 'shards'; refs: string[]; label: string } | { kind: 'folder'; id: string; label: string }

export function ShardFolders<T>({ items, refOf, nameOf, row, tag = 'ul', kidsClassName }: Props<T>): JSX.Element {
  const Item = tag === 'ul' ? 'li' : 'div'
  const Kids = tag
  const me = useNostr((s) => s.pubkey ?? '')
  const tree = useShardFolders((s) => s.tree)
  useEffect(() => {
    const st = useShardFolders.getState()
    // Still loading counts too: with no key the store already says '' and
    // would otherwise never read the stored tree (review of snocrash #40).
    if (st.owner !== me || st.storage === 'loading') void st.load(me)
  }, [me])
  const f = useShardFolders.getState

  const built = useMemo(() => buildTree(tree, items, refOf), [tree, items, refOf])
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [moving, setMoving] = useState<Moving | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const drag = useMemo(canDrag, [])

  // A picked object that left the list is no longer picked.
  const present = useMemo(() => new Set(items.map(refOf)), [items, refOf])
  const pickedNow = [...picked].filter((r) => present.has(r))

  const stopSelecting = (): void => { setSelecting(false); setPicked(new Set()) }
  /** Open a folder and every folder above it, so what was moved there is in sight. */
  const unfold = (id: string | null): void => {
    const t = f().tree
    for (let at = canonical(t, id), n = 0; at !== null && n < 64; at = parentOf(t, at), n += 1) if (t.collapsed[at]) f().setCollapsed(at, false)
  }

  const newFolder = (parent: string | null): void => {
    const id = f().createFolder(`Folder ${Object.keys(f().tree.folders).length + 1}`, parent)
    if (!id) return
    unfold(parent)
    setRenaming(id)
  }

  const dropOn = (folder: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!ours(e)) return
      // A folder is never dropped into itself or under itself: no highlight, no drop.
      if (draggingFolder !== null && folder !== null && isWithin(f().tree, folder, draggingFolder)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== (folder ?? '')) setOver(folder ?? '')
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(null) },
    onDrop: (e: DragEvent) => {
      if (!ours(e)) return
      e.preventDefault()
      e.stopPropagation()
      setOver(null)
      const d = readDrag(e)
      if (!d) return
      if (d.kind === 'shards') f().assignToFolder(d.refs, folder)
      else if (d.id !== folder) f().moveFolder(d.id, folder)
    },
  })

  const startDrag = (e: DragEvent, d: Dragged): void => {
    e.stopPropagation()
    draggingFolder = d.kind === 'folder' ? d.id : null
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d))
    e.dataTransfer.effectAllowed = 'move'
  }

  const kitFor = (item: T): RowKit => {
    const ref = refOf(item)
    const tool = selecting ? (
      <input
        type="checkbox"
        className="sfold__check"
        checked={picked.has(ref)}
        onChange={(e) => { const next = new Set(picked); if (e.target.checked) next.add(ref); else next.delete(ref); setPicked(next) }}
        aria-label={`Select ${nameOf(item)}`}
      />
    ) : (
      <button className="sfold__mini" title="Move to a folder" aria-label={`Move ${nameOf(item)} to a folder`} onClick={() => setMoving({ kind: 'shards', refs: [ref], label: nameOf(item) })}>
        <FolderInput size={13} strokeWidth={2.25} aria-hidden />
      </button>
    )
    if (!drag) return { drag: {}, tool }
    return {
      drag: {
        draggable: true,
        onDragStart: (e) => startDrag(e, { kind: 'shards', refs: selecting && picked.has(ref) ? pickedNow : [ref] }),
        onDragEnd: () => { draggingFolder = null; setOver(null) },
      },
      tool,
    }
  }

  const rows = (list: readonly T[]): JSX.Element[] => list.map((item) => <Fragment key={refOf(item)}>{row(item, kitFor(item))}</Fragment>)

  const folderRow = (node: FolderNode<T>): JSX.Element => {
    const { folder } = node
    const open = !tree.collapsed[folder.id]
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <Item key={folder.id} className={`sfold ${over === folder.id ? 'is-over' : ''}`}>
        <div
          className="sfold__head"
          draggable={drag && renaming !== folder.id ? true : undefined}
          onDragStart={drag ? (e) => startDrag(e, { kind: 'folder', id: folder.id }) : undefined}
          onDragEnd={() => { draggingFolder = null; setOver(null) }}
          {...dropOn(folder.id)}
        >
          {renaming === folder.id ? (
            <RenameField name={folder.name} onDone={(name) => { if (name !== null) f().renameFolder(folder.id, name); setRenaming(null) }} />
          ) : (
            <button className="sfold__toggle" aria-expanded={open} onClick={() => f().setCollapsed(folder.id, open)} title={open ? 'Fold' : 'Unfold'}>
              <Chevron size={12} strokeWidth={2.25} aria-hidden />
              <FolderIcon size={12} strokeWidth={2.25} aria-hidden />
              <span className="sfold__name">{folder.name}</span>
              <span className="sfold__count">{node.count}</span>
            </button>
          )}
          {renaming !== folder.id && (
            <>
              <button className="sfold__mini" title="Rename" aria-label={`Rename ${folder.name}`} onClick={() => setRenaming(folder.id)}><Pencil size={12} strokeWidth={2.25} aria-hidden /></button>
              <button className="sfold__mini" title="New folder inside" aria-label={`New folder inside ${folder.name}`} onClick={() => newFolder(folder.id)}><FolderPlus size={13} strokeWidth={2.25} aria-hidden /></button>
              <button className="sfold__mini" title="Move this folder" aria-label={`Move ${folder.name}`} onClick={() => setMoving({ kind: 'folder', id: folder.id, label: folder.name })}><FolderInput size={13} strokeWidth={2.25} aria-hidden /></button>
              <button
                className="sfold__mini sfold__mini--danger"
                title="Delete folder; what is in it moves up"
                aria-label={`Delete ${folder.name}`}
                onClick={() => { if (node.count === 0 && node.folders.length === 0) f().deleteFolder(folder.id); else setDeleting(folder.id) }}
              ><X size={14} strokeWidth={2.25} aria-hidden /></button>
            </>
          )}
        </div>
        {open && (node.folders.length > 0 || node.items.length > 0) && (
          <Kids className={kidsClassName ? `sfold__kids ${kidsClassName}` : 'sfold__kids'}>
            {node.folders.map(folderRow)}
            {rows(node.items)}
          </Kids>
        )}
      </Item>
    )
  }

  const asked = deleting ? tree.folders[deleting] : undefined
  const askedUp = asked ? (pathOf(tree, asked.parent).pop() ?? 'the top') : ''

  return (
    <>
      <Item className={`sfold__bar ${over === '' ? 'is-over' : ''}`} {...dropOn(null)} title={drag ? 'Drop here to take it out of its folder' : undefined}>
        <button className="sfold__btn" onClick={() => newFolder(null)}><FolderPlus size={12} strokeWidth={2.25} aria-hidden /> FOLDER</button>
        {selecting ? (
          <>
            <button className="sfold__btn" disabled={pickedNow.length === 0} onClick={() => setMoving({ kind: 'shards', refs: pickedNow, label: `${pickedNow.length} object${pickedNow.length === 1 ? '' : 's'}` })}>MOVE ({pickedNow.length})</button>
            <button className="sfold__btn" onClick={stopSelecting}>DONE</button>
          </>
        ) : (
          items.length > 1 && <button className="sfold__btn" onClick={() => setSelecting(true)} title="Pick several to move together">SELECT</button>
        )}
      </Item>
      {built.folders.map(folderRow)}
      {rows(built.items)}
      {moving && (
        <FolderChooser
          tree={tree}
          moving={moving}
          current={moving.kind === 'folder' ? tree.folders[moving.id]?.parent ?? null : moving.refs.length === 1 ? folderOf(tree, moving.refs[0]) : undefined}
          onPick={(to) => {
            if (moving.kind === 'shards') { f().assignToFolder(moving.refs, to); stopSelecting() }
            else f().moveFolder(moving.id, to)
            unfold(to)
            setMoving(null)
          }}
          onClose={() => setMoving(null)}
        />
      )}
      {asked && (
        <DeleteAsk
          name={asked.name}
          up={askedUp}
          onConfirm={() => { f().deleteFolder(asked.id); setDeleting(null) }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

/** DELETE FOLDER's question; Escape cancels it. */
function DeleteAsk({ name, up, onConfirm, onCancel }: { name: string; up: string; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  useEscapeFirst(onCancel)
  return (
    <ConfirmModal
      title={`Delete folder "${name}"?`}
      body={<>No object is deleted. What is in it moves up to {up === 'the top' ? 'the top' : `"${up}"`}.</>}
      confirmLabel="DELETE FOLDER"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/** The name in place, typed over; Enter or leaving keeps it, Escape keeps the old one. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null): void => { if (done.current) return; done.current = true; onDone(v) }
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  // Escape puts the old name back, and closes nothing behind it.
  useEscapeFirst(() => finish(null))
  return (
    <input
      ref={ref}
      className="sfold__rename"
      value={value}
      maxLength={64}
      spellCheck={false}
      aria-label="Folder name"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') finish(value) }}
      onBlur={() => finish(value)}
    />
  )
}

/**
 * MOVE TO FOLDER: every folder, indented, and the top; a folder being moved
 * leaves itself and everything under it out. A new folder can be made here
 * and the move goes into it.
 */
function FolderChooser({ tree, moving, current, onPick, onClose }: {
  tree: FolderTree
  moving: Moving
  /** Where it is now: null the top, undefined when several objects may be in several places. */
  current: string | null | undefined
  onPick: (folder: string | null) => void
  onClose: () => void
}): JSX.Element {
  useEscapeFirst(onClose)
  const skip = moving.kind === 'folder' ? moving.id : undefined
  const list = flatFolders(tree, skip)
  const [name, setName] = useState('')
  const make = (): void => {
    const id = useShardFolders.getState().createFolder(name, null)
    if (id) onPick(id)
  }
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Move to a folder" onPointerDown={onClose}>
      <div className="modal__card modal__card--list sfold__chooser" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Move &quot;{moving.label}&quot;</h2>
        <ul className="sfold__choices">
          <li>
            <button className={`sfold__choice ${current === null ? 'is-on' : ''}`} disabled={current === null} onClick={() => onPick(null)}>TOP</button>
          </li>
          {list.map(({ folder, depth }) => {
            const here = current === folder.id
            const refused = moving.kind === 'folder' && isWithin(tree, folder.id, moving.id)
            return (
              <li key={folder.id}>
                <button className={`sfold__choice ${here ? 'is-on' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} disabled={here || refused} onClick={() => onPick(folder.id)}>
                  <FolderIcon size={12} strokeWidth={2.25} aria-hidden /> {folder.name}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="sfold__new">
          <input className="sfold__input" value={name} maxLength={64} spellCheck={false} placeholder="New folder" aria-label="New folder name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') make() }} />
          <button className="sfold__btn" disabled={!name.trim()} onClick={make}>MAKE AND MOVE</button>
        </div>
        <button className="modal__cancel" onClick={onClose}>CANCEL</button>
      </div>
    </div>,
    document.body,
  )
}
