/**
 * shardFoldersStorage.test.ts: the folder tree kept in IndexedDB, per
 * identity, through the store. A page load is a fresh copy of the store
 * module over the same database; a second tab is a second copy open at the
 * same time. A change made before the load has answered is kept; another
 * identity's folders are not shown; two tabs' changes both land.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTree, folderOf, pathOf } from '../lib/shardFolders'

const ME = 'ee'.repeat(32)
const OTHER = 'dd'.repeat(32)
let identity: string | null = ME
const watchers = new Set<(s: { pubkey: string | null }, prev: { pubkey: string | null }) => void>()

vi.mock('./useNostr', () => ({
  useNostr: {
    getState: () => ({ pubkey: identity }),
    subscribe: (fn: (s: { pubkey: string | null }, prev: { pubkey: string | null }) => void) => { watchers.add(fn); return () => watchers.delete(fn) },
  },
}))

type Mod = typeof import('./useShardFolders')

/** A page load (or another tab): the module fresh, then the store's load. */
async function boot(owner: string = identity ?? ''): Promise<Mod> {
  vi.resetModules()
  const mod = await import('./useShardFolders')
  await mod.useShardFolders.getState().load(owner)
  return mod
}

function switchTo(pubkey: string | null): void {
  const prev = { pubkey: identity }
  identity = pubkey
  for (const w of watchers) w({ pubkey }, prev)
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  identity = ME
  watchers.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* the tests check what happened */ })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shard folders in IndexedDB', () => {
  it('keeps folders, filings and folds across a reload', async () => {
    const a = await boot()
    const forest = a.createFolderPath(['maze-kit', 'forest'])!
    a.assignToFolder(['oak', 'pine'], forest)
    const kit = a.useShardFolders.getState().tree.folders[forest].parent!
    a.useShardFolders.getState().setCollapsed(kit, true)
    await a.useShardFolders.getState().flush()

    const b = await boot()
    const t = b.useShardFolders.getState().tree
    expect(b.useShardFolders.getState().storage).toBe('indexeddb')
    expect(pathOf(t, forest)).toEqual(['maze-kit', 'forest'])
    expect(folderOf(t, 'oak')).toBe(forest)
    expect(t.collapsed[kit]).toBe(true)
  })

  it('returns the existing folder when the path is already there', async () => {
    const a = await boot()
    const one = a.createFolderPath(['maze-kit', 'water'])
    const two = a.createFolderPath(['maze-kit', 'water'])
    expect(two).toBe(one)
    expect(Object.keys(a.useShardFolders.getState().tree.folders)).toHaveLength(2)
    expect(a.createFolderPath([])).toBeNull()
    expect(a.createFolderPath(['  '])).toBeNull()
  })

  it('finds an existing path without writing anything new', async () => {
    const a = await boot()
    const id = a.createFolderPath(['maze-kit', 'forest'])
    for (let i = 0; i < 200; i += 1) expect(a.createFolderPath(['maze-kit', 'forest'])).toBe(id)
    await a.useShardFolders.getState().flush()
    const b = await boot()
    const t = b.useShardFolders.getState().tree
    expect(Object.keys(t.folders)).toHaveLength(2)
    expect(Object.keys(t.alias)).toHaveLength(0)
  })

  it('an id handed out before the load answered still names the folder it found', async () => {
    const a = await boot()
    a.createFolderPath(['kit'])
    await a.useShardFolders.getState().flush()
    vi.resetModules()
    const b: Mod = await import('./useShardFolders')
    const early = b.createFolderPath(['kit'])!
    await b.useShardFolders.getState().flush()
    b.useShardFolders.getState().renameFolder(early, 'maze-kit')
    b.useShardFolders.getState().setCollapsed(early, true)
    b.assignToFolder('oak', early)
    await b.useShardFolders.getState().flush()
    const t = (await boot()).useShardFolders.getState().tree
    const [only] = Object.values(t.folders)
    expect(Object.keys(t.folders)).toHaveLength(1)
    expect(only.name).toBe('maze-kit')
    expect(t.collapsed[only.id]).toBe(true)
    expect(folderOf(t, 'oak')).toBe(only.id)
  })

  it('files a shard where the user put it even when this tab had not seen another tab\'s filing', async () => {
    const tabA = await boot()
    const tabB = await boot()
    const id = tabA.createFolderPath(['kit'])!
    tabA.assignToFolder('oak', id)
    await tabA.useShardFolders.getState().flush()
    // Tab B still shows oak at the top, and takes it to the top.
    tabB.assignToFolder('oak', null)
    await tabB.useShardFolders.getState().flush()
    expect(folderOf((await boot()).useShardFolders.getState().tree, 'oak')).toBeNull()
  })

  it('makes a path again when another tab deleted it while this tab still showed it', async () => {
    const tabA = await boot()
    tabA.createFolderPath(['kit', 'forest'])
    await tabA.useShardFolders.getState().flush()
    const tabB = await boot()
    const kit = Object.values(tabA.useShardFolders.getState().tree.folders).find((f) => f.name === 'kit')!.id
    tabA.useShardFolders.getState().deleteFolder(kit)
    const forest = Object.values(tabA.useShardFolders.getState().tree.folders).find((f) => f.name === 'forest')!.id
    tabA.useShardFolders.getState().deleteFolder(forest)
    await tabA.useShardFolders.getState().flush()
    // Tab B has not reread: it still shows kit/forest, and files oak there.
    const id = tabB.createFolderPath(['kit', 'forest'])!
    tabB.assignToFolder('oak', id)
    await tabB.useShardFolders.getState().flush()
    const t = (await boot()).useShardFolders.getState().tree
    expect(pathOf(t, folderOf(t, 'oak'))).toEqual(['kit', 'forest'])
    expect(Object.keys(t.alias)).toHaveLength(0)
  })

  it('shows a change at once, and keeps one made before the load answered', async () => {
    const a = await boot()
    a.createFolderPath(['stored'])
    await a.useShardFolders.getState().flush()

    vi.resetModules()
    const b: Mod = await import('./useShardFolders')
    // No load yet: the first change loads this identity's tree itself.
    const early = b.createFolderPath(['early'])!
    expect(b.useShardFolders.getState().tree.folders[early]?.name).toBe('early')
    await b.useShardFolders.getState().flush()
    const names = Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name).sort()
    expect(names).toEqual(['early', 'stored'])

    const c = await boot()
    expect(Object.values(c.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['early', 'stored'])
  })

  it('deleting a folder through the store loses no shard', async () => {
    const a = await boot()
    const trees = a.createFolderPath(['kit', 'forest', 'trees'])!
    const t0 = a.useShardFolders.getState().tree
    const forest = t0.folders[trees].parent!
    const kit = t0.folders[forest].parent!
    a.assignToFolder('oak', trees)
    a.assignToFolder('moss', forest)
    a.assignToFolder('gate', kit)
    a.useShardFolders.getState().deleteFolder(forest)
    a.useShardFolders.getState().deleteFolder(kit)
    await a.useShardFolders.getState().flush()

    const b = await boot()
    const t = b.useShardFolders.getState().tree
    expect(folderOf(t, 'oak')).toBe(trees)
    expect(t.folders[trees].parent).toBeNull()
    const built = buildTree(t, ['oak', 'moss', 'gate'], (s) => s)
    expect(built.items.sort()).toEqual(['gate', 'moss'])
    expect(built.folders[0].items).toEqual(['oak'])
  })

  it('refuses a move into a descendant through the store', async () => {
    const a = await boot()
    const trees = a.createFolderPath(['kit', 'forest', 'trees'])!
    const kit = pathOf(a.useShardFolders.getState().tree, trees) && Object.values(a.useShardFolders.getState().tree.folders).find((f) => f.name === 'kit')!.id
    expect(a.useShardFolders.getState().moveFolder(kit, trees)).toBe(false)
    expect(a.useShardFolders.getState().moveFolder(kit, kit)).toBe(false)
    expect(a.useShardFolders.getState().moveFolder(trees, null)).toBe(true)
    expect(a.useShardFolders.getState().moveFolder(trees, 'gone')).toBe(false)
  })

  // snocrash, unlike ONOSENDAI: the objects are this browser's and stay in the
  // list across a switch, so an identity new here starts from a copy of the
  // folders on screen. From then on each keeps its own.
  it('starts a new identity from a copy, then keeps each identity\'s folders apart', async () => {
    const a = await boot()
    a.createFolderPath(['mine'])
    await a.useShardFolders.getState().flush()
    switchTo(OTHER)
    expect(a.useShardFolders.getState().owner).toBe(OTHER)
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['mine'])
    a.createFolderPath(['theirs'])
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['mine', 'theirs'])
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['mine'])
  })

  it('writes a change queued before a switch to the identity it was made for', async () => {
    const a = await boot()
    a.createFolderPath(['before-switch'])
    switchTo(OTHER)
    await a.useShardFolders.getState().flush()
    // OTHER, new here, starts from a copy of ME's tree as written, the queued change in it.
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['before-switch'])
    identity = ME
    const b = await boot(ME)
    expect(Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['before-switch'])
  })

  it('lands both tabs\' changes, neither overwriting the other', async () => {
    const tabA = await boot()
    const tabB = await boot()
    // Both loaded the same (empty) tree; each now changes it.
    tabA.createFolderPath(['from-a'])
    tabB.createFolderPath(['from-b'])
    await tabA.useShardFolders.getState().flush()
    await tabB.useShardFolders.getState().flush()
    const c = await boot()
    expect(Object.values(c.useShardFolders.getState().tree.folders).map((f) => f.name).sort()).toEqual(['from-a', 'from-b'])
  })

  it('lasts the session in memory where IndexedDB cannot open, per identity', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('blocked') } }
    const a = await boot()
    expect(a.useShardFolders.getState().storage).toBe('memory')
    const id = a.createFolderPath(['kit'])!
    a.assignToFolder('oak', id)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(id)
    switchTo(OTHER)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(id)
    a.createFolderPath(['other-only'])
    await a.useShardFolders.getState().flush()
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(id)
    expect(Object.values(a.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['kit'])
  })

  it('starts a key that signs in for the first time from the folders made with no key', async () => {
    identity = null
    const a = await boot('')
    const kit = a.createFolderPath(['maze-kit'])!
    a.assignToFolder('oak', kit)
    await a.useShardFolders.getState().flush()
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(a.useShardFolders.getState().owner).toBe(ME)
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(kit)
    // The no-key tree is copied, not moved.
    identity = null
    const b = await boot('')
    expect(folderOf(b.useShardFolders.getState().tree, 'oak')).toBe(kit)
  })

  it('never copies into a key that has folders, or emptied its own', async () => {
    const a = await boot(ME)
    const mine = a.createFolderPath(['mine'])!
    a.useShardFolders.getState().deleteFolder(mine)
    await a.useShardFolders.getState().flush()
    switchTo(null)
    a.createFolderPath(['no-key'])
    await a.useShardFolders.getState().flush()
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(Object.keys(a.useShardFolders.getState().tree.folders)).toHaveLength(0)
  })

  it('signing in with a real key after the key made at a first visit keeps the folders', async () => {
    // A first visit is handed a key; a sign-in is a switch from it, never from nobody.
    const FIRST = 'aa'.repeat(32)
    identity = FIRST
    const a = await boot(FIRST)
    const kit = a.createFolderPath(['maze-kit'])!
    a.assignToFolder('oak', kit)
    await a.useShardFolders.getState().flush()
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(kit)
    // A copy: the first key's folders are still its own.
    const b = await boot(FIRST)
    expect(folderOf(b.useShardFolders.getState().tree, 'oak')).toBe(kit)
  })

  it('reads the stored no-key tree when the app starts with no key', async () => {
    identity = null
    const a = await boot('')
    a.createFolderPath(['kept'])
    await a.useShardFolders.getState().flush()
    vi.resetModules()
    const b: Mod = await import('./useShardFolders')
    // The store already says '' before anything loads: loading must still read it.
    expect(b.useShardFolders.getState().owner).toBe('')
    expect(b.useShardFolders.getState().storage).toBe('loading')
    await b.useShardFolders.getState().load('')
    expect(Object.values(b.useShardFolders.getState().tree.folders).map((f) => f.name)).toEqual(['kept'])
  })

  it('without IndexedDB, keeps the no-key folders across a sign-in and back, and copies them in', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('blocked') } }
    identity = null
    const a = await boot('')
    const kit = a.createFolderPath(['kit'])!
    a.assignToFolder('oak', kit)
    await a.useShardFolders.getState().flush()
    switchTo(ME)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(kit)
    switchTo(null)
    await a.useShardFolders.getState().flush()
    expect(folderOf(a.useShardFolders.getState().tree, 'oak')).toBe(kit)
  })
})

