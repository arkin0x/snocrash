/**
 * The model last on the bench comes back on the next visit, but only while it
 * is still one of yours: a deleted model must not leave the bench empty.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { newShard } from 'sno-core/shards'
import { lastOnBench } from './useWorkshop'

/** These tests run under node, which has no localStorage; this is one. */
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

describe('lastOnBench', () => {
  beforeEach(() => store.clear())

  it('is the model remembered, while it is still one of yours', () => {
    const a = newShard('a'), b = newShard('b')
    store.set('snocrash:current', b.id)
    expect(lastOnBench([a, b])).toBe(b.id)
  })

  it('is nothing when that model has since been deleted, or nothing was remembered', () => {
    const a = newShard('a')
    store.set('snocrash:current', 'gone')
    expect(lastOnBench([a])).toBeNull()
    store.clear()
    expect(lastOnBench([a])).toBeNull()
  })
})
