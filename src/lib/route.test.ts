/**
 * The three places in the app and the path each is written as. A route that
 * does not survive the trip through its own path is a link that lands
 * somewhere other than where it was shared from.
 */
import { describe, it, expect } from 'vitest'
import { parseRoute, pathFor, type Route } from './route'

describe('routes', () => {
  it('reads each path as the place it names', () => {
    expect(parseRoute('/feed')).toEqual({ view: 'feed' })
    expect(parseRoute('/feed/')).toEqual({ view: 'feed' })
    expect(parseRoute('/workshop')).toEqual({ view: 'make', address: null })
    expect(parseRoute('/workshop/naddr1abc')).toEqual({ view: 'make', address: 'naddr1abc' })
  })

  it('treats / and anything unknown as the workshop, which is what / always was', () => {
    // An old link, or a typo, still lands somewhere useful rather than nowhere.
    expect(parseRoute('/')).toEqual({ view: 'make', address: null })
    expect(parseRoute('/nonsense')).toEqual({ view: 'make', address: null })
  })

  it('writes a route back to the same path it was read from', () => {
    const routes: Route[] = [{ view: 'feed' }, { view: 'make', address: null }, { view: 'make', address: 'naddr1qqxyz' }]
    for (const r of routes) expect(parseRoute(pathFor(r))).toEqual(r)
  })
})
