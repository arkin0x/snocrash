/**
 * route.ts - where you are in the app, and the address bar that says so.
 *
 * Three places, and the path for each:
 *
 *   /feed                 everyone's objects
 *   /workshop             your own, on the bench
 *   /workshop/naddr1...   one object from the feed, on the bench
 *
 * `/` names no place. Arriving there (the address typed, the installed app's
 * start, an old link) picks up where the last visit left off: the path you
 * were on is remembered in localStorage on every move, and the address bar is
 * set to it. A first visit has nothing remembered and opens on the feed, so a
 * newcomer sees what people have made before the bench (arkinox, 2026-10-04).
 * A link that names a place is honored as it is, because a shared link means
 * "look at this", and it becomes the place remembered.
 *
 * No router library. There are three routes and no nesting, and what a router
 * would add over history.pushState and one popstate listener is mostly the
 * weight of the router. The route lives in a store rather than in component
 * state so the browser's own back and forward move the app exactly the way the
 * in-app buttons do.
 *
 * Every path serves the same index.html (vercel.json rewrites everything to
 * it), which is also why every path carries the same link preview: a crawler
 * runs no JavaScript and sees only that file.
 */

import { create } from 'zustand'

export type Route = { view: 'feed' } | { view: 'make'; address: string | null }

/** The place a path names, or null for `/` and anything unrecognised. */
export function namedRoute(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'feed') return { view: 'feed' }
  if (parts[0] === 'workshop') return { view: 'make', address: parts[1] ? decodeURIComponent(parts[1]) : null }
  return null
}

/**
 * A path, read as a route: the place it names, or, for `/` and anything
 * unrecognised, the place the last visit left off (`last`, a remembered path),
 * and the feed when there is none.
 */
export function parseRoute(pathname: string, last: string | null = null): Route {
  return namedRoute(pathname) ?? (last ? namedRoute(last) : null) ?? { view: 'feed' }
}

/** The path a route is written as. */
export function pathFor(route: Route): string {
  if (route.view === 'feed') return '/feed'
  return route.address ? `/workshop/${route.address}` : '/workshop'
}

interface RouteState {
  route: Route
  /**
   * Whether the object on the bench was opened from the feed in this visit,
   * so that the entry before it in the browser's history IS the feed. Only
   * then is going back a real `history.back()`, which is what makes the
   * phone's own back gesture and the arrow button the same thing. Arriving on
   * a shared link has no feed behind it, and going back there would leave the
   * site.
   */
  openedFromFeed: boolean
  go: (route: Route, opts?: { replace?: boolean; fromFeed?: boolean }) => void
  /** To the feed: back through history when that is where we came from, otherwise forward to it. */
  back: () => void
}

/** Where the last visit was: the path of the route on screen, kept on every move. */
const WHERE_KEY = 'snocrash:where'

function recall(): string | null {
  try { return localStorage.getItem(WHERE_KEY) } catch { return null }
}

function remember(route: Route): void {
  try { localStorage.setItem(WHERE_KEY, pathFor(route)) } catch { /* private mode: this visit only */ }
}

/**
 * The route on arrival. When the path named no place, the address bar is
 * corrected to the place chosen, so that it says where you are and the
 * history entry behind the next move is a real place.
 */
function arrive(): Route {
  if (typeof window === 'undefined') return { view: 'feed' }
  const route = parseRoute(window.location.pathname, recall())
  const path = pathFor(route)
  if (window.location.pathname !== path) window.history.replaceState(null, '', path + window.location.search + window.location.hash)
  remember(route)
  return route
}

const here = (): Route => (typeof window === 'undefined' ? { view: 'feed' } : parseRoute(window.location.pathname, recall()))

export const useRoute = create<RouteState>((set, get) => ({
  route: arrive(),
  openedFromFeed: false,
  go: (route, opts = {}) => {
    const path = pathFor(route)
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      if (opts.replace) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    set({ route, openedFromFeed: opts.fromFeed ?? (opts.replace ? get().openedFromFeed : false) })
    remember(route)
  },
  back: () => {
    if (get().openedFromFeed && typeof window !== 'undefined') { window.history.back(); return }
    get().go({ view: 'feed' })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    // History moved on its own (the phone's back gesture, the browser's arrows).
    // Leaving the object that was opened from the feed spends that fact.
    const route = here()
    useRoute.setState({ route, openedFromFeed: route.view === 'make' && route.address !== null && useRoute.getState().openedFromFeed })
    remember(route)
  })
}
