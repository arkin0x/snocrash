/**
 * parts.ts - fetching the objects an object places (DECK-0003 §1.10), once.
 *
 * sno-core decides what a placement means and what to do when its object is
 * missing (sno-core/parts resolveParts). What it cannot do is reach a relay,
 * so this is the fetch it is handed, with one cache for the whole app: a
 * floor of 129 tiles, a feed showing that floor, and the bench it is open on
 * all ask for the tile once.
 *
 * A reference that found nothing is not remembered, so the next draw asks
 * again: a relay that was slow a moment ago may answer now. One this client
 * has just published is forgotten (forgetRef), so every object placing it
 * shows the new version at once rather than the cached old one.
 */

import { useEffect, useMemo, useState } from 'react'
import { queryAny } from './pool'
import { relaySet } from '../store/useRelays'
import { parseAddress, placedBounds, refKey, resolveParts, type Bounds, type Placed } from 'sno-core/parts'
import type { Ref, ShardModel } from 'sno-core/shards'

const SNO_KIND = 33331

const cache = new Map<string, Promise<unknown>>()

/** The payload a reference names, parsed, or null. The newest version of an `a`; the one event of an `e`. */
export function fetchRef(ref: Ref): Promise<unknown> {
  const key = refKey(ref)
  const held = cache.get(key)
  if (held) return held
  const relays = [...new Set([...(ref[2] ? [ref[2]] : []), ...relaySet()])]
  const got = (async (): Promise<unknown> => {
    let filter
    if (ref[0] === 'a') {
      const a = parseAddress(ref[1])
      if (!a) return null
      filter = { kinds: [a.kind], authors: [a.pubkey], '#d': [a.d] }
    } else filter = { ids: [ref[1]] }
    const found = await queryAny(relays, filter)
    // Several relays may each hold a different edit; the newest is the object.
    const ev = found.sort((x, y) => y.created_at - x.created_at)[0]
    if (!ev || ev.kind !== SNO_KIND) return null
    try { return JSON.parse(ev.content) } catch { return null }
  })()
  cache.set(key, got)
  // Nothing found is not remembered: the next draw asks again.
  void got.then((p) => { if (p == null && cache.get(key) === got) cache.delete(key) }, () => { if (cache.get(key) === got) cache.delete(key) })
  return got
}

/**
 * Answer a reference from here instead of a relay. For the dev harness
 * (window.__parts): an object that places an unpublished one can be drawn
 * without publishing anything.
 */
export function primeRef(ref: Ref, payload: unknown): void {
  cache.set(refKey(ref), Promise.resolve(payload))
  refreshed++
  for (const f of listeners) f()
}

/** Drop a reference from the cache, after publishing a new version of it. */
export function forgetRef(ref: Ref): void {
  cache.delete(refKey(ref))
  refreshed++
  for (const f of listeners) f()
}

let refreshed = 0
const listeners = new Set<() => void>()

/** What a reference resolved to, whatever its placement: its object and that object's own parts. */
export type Resolved = Pick<Placed, 'model' | 'missing' | 'children'>

/**
 * Every object `shard` places, resolved, keyed by reference (refKey). Keyed
 * by reference rather than by placement so that moving, turning or copying a
 * placement redraws at once from what is already here, and only a new
 * reference waits for a fetch. Until the first answer the map is empty and
 * nothing is drawn; after that, the previous answer stays up while a new one
 * is fetched, so an edit never flashes the parts away.
 */
export function useResolved(shard: ShardModel | null, self?: Ref): Map<string, Resolved> {
  const [byRef, setByRef] = useState<Map<string, Resolved>>(() => new Map())
  const [tick, setTick] = useState(refreshed)
  useEffect(() => {
    const on = (): void => setTick(refreshed)
    listeners.add(on)
    return () => { listeners.delete(on) }
  }, [])
  // One placement per reference is enough to resolve each object and its
  // own parts: what a reference resolves to does not depend on where it stands.
  const refs = shard?.refs ?? []
  const key = refs.map(refKey).join('|') + (self ? `@${refKey(self)}` : '')
  useEffect(() => {
    if (!shard || refs.length === 0) { setByRef((m) => (m.size ? new Map() : m)); return }
    let live = true
    const probe: ShardModel = { ...shard, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })) }
    void resolveParts(probe, fetchRef, self).then((placed) => {
      if (!live) return
      const m = new Map<string, Resolved>()
      placed.forEach((p) => m.set(refKey(p.ref), { model: p.model, missing: p.missing, children: p.children }))
      setByRef(m)
    })
    return () => { live = false }
    // The references, not the shard: a placement moving needs no new fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])
  return byRef
}

/**
 * What the object occupies with its parts placed, in render units: what a
 * preview frames. Parts still being fetched are left out until they arrive.
 */
export function useBounds(shard: ShardModel): Bounds | null {
  const byRef = useResolved(shard)
  return useMemo(() => {
    const placed: Placed[] = []
    for (const part of shard.parts ?? []) {
      const ref = shard.refs?.[part.ref]
      const r = ref ? byRef.get(refKey(ref)) : undefined
      if (ref && r) placed.push({ part, ref, ...r })
    }
    return placedBounds(shard, placed)
  }, [shard, byRef])
}
