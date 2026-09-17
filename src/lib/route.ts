/**
 * route.ts - where you are in the app, and the address bar that says so.
 *
 * Three places, and the path for each:
 *
 *   /feed                 everyone's objects
 *   /workshop             your own, on the bench
 *   /workshop/naddr1...   one object from the feed, on the bench
 *
 * `/` is the workshop, as it always was, so an old link still lands somewhere.
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

/** A path, read as a route. Anything unrecognised is the workshop, which is what `/` has always been. */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'feed') return { view: 'feed' }
  if (parts[0] === 'workshop' && parts[1]) return { view: 'make', address: decodeURIComponent(parts[1]) }
  return { view: 'make', address: null }
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

const here = (): Route => (typeof window === 'undefined' ? { view: 'make', address: null } : parseRoute(window.location.pathname))

export const useRoute = create<RouteState>((set, get) => ({
  route: here(),
  openedFromFeed: false,
  go: (route, opts = {}) => {
    const path = pathFor(route)
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      if (opts.replace) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    set({ route, openedFromFeed: opts.fromFeed ?? (opts.replace ? get().openedFromFeed : false) })
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
  })
}
