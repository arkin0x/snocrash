/**
 * Guard: a throw while drawing the feed or a listing stays there. Without a
 * DOM here, the two halves of a boundary are checked on their own: a throw
 * sets `failed`, and a failed Guard draws its fallback, whose retry clears it.
 */

import { describe, expect, it, vi } from 'vitest'
import { Guard } from './Guard'
import SOURCE from './Feed.tsx?raw'
import WORKSHOP from './Workshop.tsx?raw'

describe('Guard', () => {
  it('a throw below it sets failed, and then it draws the fallback rather than the children', () => {
    expect(Guard.getDerivedStateFromError()).toEqual({ failed: true })
    let retry: (() => void) | null = null
    const fallback = vi.fn((r: () => void) => { retry = r; return 'fallback' })
    const g = new Guard({ where: 'test', fallback, children: 'children' })
    expect(g.render()).toBe('children')
    g.state = { failed: true }
    expect(g.render()).toBe('fallback')
    expect(fallback).toHaveBeenCalledOnce()
    g.setState = vi.fn() as never
    retry!()
    expect(g.setState).toHaveBeenCalledWith({ failed: false })
  })

  it('stands around the feed, and around each listing', () => {
    expect(WORKSHOP).toMatch(/<Guard where="the feed"[\s\S]{0,300}<Feed onOpen=/)
    expect(SOURCE).toMatch(/<Guard where="a listing" fallback=\{\(\) => null\}><ListingCard listing=\{listing\} \/><\/Guard>/)
  })
})
