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

  it('opens / on the feed on a first visit, with nothing remembered', () => {
    expect(parseRoute('/')).toEqual({ view: 'feed' })
    expect(parseRoute('/', null)).toEqual({ view: 'feed' })
  })

  it('opens / where the last visit left off', () => {
    expect(parseRoute('/', '/workshop')).toEqual({ view: 'make', address: null })
    expect(parseRoute('/', '/workshop/naddr1abc')).toEqual({ view: 'make', address: 'naddr1abc' })
    expect(parseRoute('/', '/feed')).toEqual({ view: 'feed' })
  })

  it('treats anything unknown as /, so an old link or a typo still lands somewhere useful', () => {
    expect(parseRoute('/nonsense')).toEqual({ view: 'feed' })
    expect(parseRoute('/nonsense', '/workshop')).toEqual({ view: 'make', address: null })
  })

  it('honors a link that names a place over where the last visit was', () => {
    expect(parseRoute('/feed', '/workshop/naddr1abc')).toEqual({ view: 'feed' })
    expect(parseRoute('/workshop/naddr1xyz', '/feed')).toEqual({ view: 'make', address: 'naddr1xyz' })
  })

  it('ignores a remembered path that names no place', () => {
    expect(parseRoute('/', '/')).toEqual({ view: 'feed' })
    expect(parseRoute('/', 'garbage')).toEqual({ view: 'feed' })
  })

  it('writes a route back to the same path it was read from', () => {
    const routes: Route[] = [{ view: 'feed' }, { view: 'make', address: null }, { view: 'make', address: 'naddr1qqxyz' }]
    for (const r of routes) expect(parseRoute(pathFor(r))).toEqual(r)
  })
})
