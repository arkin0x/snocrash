/**
 * useHandlers.ts - the apps that sell listed objects (NIP-89 handlers).
 *
 * A listing names the app it was published with (sno-core `listingApp`: the
 * `client` tag's coordinate, else an `a` naming a kind 31990). Its BUY button
 * opens that app's page for the listing when the app's handler says it shows
 * kind 33331 (sno-core `sellerLink`). This store fetches each handler once a
 * session, from the relays profiles are read from (useProfiles), and keeps it:
 *
 * - **Never in the tile's way:** the tile draws its fallback link at once and
 *   upgrades when a handler arrives.
 * - **Once per app:** a request already answered or in flight is not sent
 *   again, so a feed full of one app's listings asks the relays once.
 * - **Bounded:** at most HANDLERS_KEPT apps are remembered; the oldest go first.
 * - **Checked:** a handler counts only when its signature verifies and it is
 *   the coordinate's own (its author, kind 31990, its `d`); the newest wins.
 *
 * ONOSENDAI keeps the same store (its store/useHandlers.ts).
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { Event } from 'nostr-tools'
import { HANDLER_KIND, handlerFilter, type ListingApp } from 'sno-core/feed'
import { queryAny } from '../lib/pool'
import { relaySet } from './useRelays'

/** The most apps remembered in a session. */
export const HANDLERS_KEPT = 200
/** How long the relays get to answer, as for a profile. */
const HANDLER_WAIT_MS = 5000

interface HandlersState {
  /** Each app's newest valid handler by coordinate; null when the relays had none. */
  handlers: Record<string, Event | null>
  /** Ask for an app's handler, unless it is known or already being asked for. */
  request: (app: ListingApp) => void
}

/** Coordinates being asked for now. */
const inFlight = new Set<string>()

/**
 * Whether an event is this app's handler, signed by it. The signature is
 * checked on a fresh copy of the fields: nostr-tools remembers a verification
 * on the object, under a symbol a spread carries along.
 */
export function isHandlerOf(ev: Event, app: Pick<ListingApp, 'pubkey' | 'd'>): boolean {
  if (ev.kind !== HANDLER_KIND || ev.pubkey !== app.pubkey || !ev.tags.some((t) => t[0] === 'd' && t[1] === app.d)) return false
  const { id, pubkey, created_at, kind, tags, content, sig } = ev
  return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })
}

export const useHandlers = create<HandlersState>((set, get) => ({
  handlers: {},
  request: (app) => {
    if (app.address in get().handlers || inFlight.has(app.address)) return
    inFlight.add(app.address)
    void queryAny(relaySet(), handlerFilter(app), HANDLER_WAIT_MS)
      .catch(() => [])
      .then((found) => {
        inFlight.delete(app.address)
        let best: Event | null = null
        for (const { event: ev } of found) {
          if (!isHandlerOf(ev, app)) continue
          if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev
        }
        const next = { ...get().handlers, [app.address]: best }
        const keys = Object.keys(next)
        // Insertion order is arrival order: past the bound, the oldest go.
        for (const k of keys.slice(0, Math.max(0, keys.length - HANDLERS_KEPT))) delete next[k]
        set({ handlers: next })
      })
  },
}))
