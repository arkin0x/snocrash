/**
 * shardFoldersDb.ts: where the folder trees are kept, in IndexedDB.
 *
 * The same database, store and row as ONOSENDAI's (onosendai-v2
 * src/lib/shardFoldersDb.ts): `sno:shard-folders`, version 1, one store
 * `trees` keyed by `owner`, one row per identity { owner, tree }. A tree is
 * small, so it is read and written whole. A change is never a tree written
 * over another: commitOps reads the row, applies the ops and puts it back in
 * one readwrite transaction, and IndexedDB runs readwrite transactions on a
 * store one at a time, across tabs too. The two small helpers ONOSENDAI
 * shares from its lib/idb.ts are here, since this is snocrash's only
 * database.
 */

import { applyOps, normalizeTree, type FolderOp, type FolderTree } from './shardFolders'

export const SHARD_FOLDERS_DB = 'sno:shard-folders'
export const DB_VERSION = 1
export const TREES_STORE = 'trees'

/** How long opening may take before the store keeps folders in memory for the session. */
export const OPEN_TIMEOUT_MS = 8000

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function openShardFoldersDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(SHARD_FOLDERS_DB, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(TREES_STORE)) db.createObjectStore(TREES_STORE, { keyPath: 'owner' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
  // A blocked upgrade or a browser that never answers must not hold the app,
  // and a connection that arrives late is closed so it does not block the next open.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

/** One identity's tree; empty when it has none yet. */
export async function readTree(db: IDBDatabase, owner: string): Promise<FolderTree> {
  const row = await request(db.transaction(TREES_STORE, 'readonly').objectStore(TREES_STORE).get(owner)) as { tree?: unknown } | undefined
  return normalizeTree(row?.tree)
}

/** Apply ops to one identity's stored tree in one transaction; resolves with the tree as committed. */
export function commitOps(db: IDBDatabase, owner: string, ops: readonly FolderOp[]): Promise<FolderTree> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREES_STORE, 'readwrite')
    const os = tx.objectStore(TREES_STORE)
    let next: FolderTree | null = null
    const got = os.get(owner)
    got.onsuccess = () => {
      const row = got.result as { tree?: unknown } | undefined
      next = applyOps(normalizeTree(row?.tree), ops)
      // Whatever a later build keeps beside the tree is kept as it was.
      const kept = row && typeof row === 'object' ? row : {}
      const keptTree = row?.tree && typeof row.tree === 'object' ? row.tree : {}
      os.put({ ...kept, owner, tree: { ...keptTree, ...next } })
    }
    tx.oncomplete = () => resolve(next ?? normalizeTree(null))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * `to`'s tree, which starts as a copy of `from`'s when `to` has never had one: one
 * transaction, so two tabs signing in at once copy once. `from` is left as
 * it was. With nothing to copy, or a tree of its own already, `to`'s tree is
 * read as it is.
 */
export function adoptTree(db: IDBDatabase, from: string, to: string): Promise<FolderTree> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREES_STORE, 'readwrite')
    const os = tx.objectStore(TREES_STORE)
    let result: FolderTree = normalizeTree(null)
    const mine = os.get(to)
    mine.onsuccess = () => {
      result = normalizeTree((mine.result as { tree?: unknown } | undefined)?.tree)
      // Only a key with no row at all: one that emptied its own folders keeps them empty.
      if (mine.result !== undefined || from === to) return
      const theirs = os.get(from)
      theirs.onsuccess = () => {
        const row = theirs.result as { tree?: unknown } | undefined
        const tree = normalizeTree(row?.tree)
        if (Object.keys(tree.folders).length === 0 && Object.keys(tree.assign).length === 0) return
        result = tree
        // Whatever a later build keeps beside the tree is copied as it was, as commitOps keeps it.
        const keptTree = row?.tree && typeof row.tree === 'object' ? row.tree : {}
        os.put({ ...(row ?? {}), owner: to, tree: { ...keptTree, ...tree } })
      }
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read aborted'))
  })
}
