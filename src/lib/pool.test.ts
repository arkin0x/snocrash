/**
 * pool.test.ts - the read path, now sno-core's per-relay reader (sno-core/feed
 * `readEach`) over this app's pool and auth.
 *
 * The behavior snocrash #22 fixed must survive the move: one relay that never
 * finishes connecting costs only its connect deadline, and the relay that
 * answers paints at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// pool.ts schedules with window.setTimeout; under vitest there is no window.
;(globalThis as { window?: unknown }).window ??= globalThis

import { CONNECT_DEADLINE_MS, pool, stream } from './pool'
import type { Event } from 'nostr-tools'

const EV = { id: 'f'.repeat(64), pubkey: 'a'.repeat(64), created_at: 1, kind: 33331, tags: [['d', 'x']], content: '', sig: '' } as Event

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('stream, on sno-core readEach', () => {
  it('paints from the relay that answers, and a hung one costs only its connect deadline', async () => {
    vi.spyOn(pool, 'ensureRelay').mockImplementation(((url: string) => (url === 'wss://hung.test' ? new Promise(() => {}) : Promise.resolve({ challenge: undefined }))) as never)
    vi.spyOn(pool, 'subscribeMany').mockImplementation(((_urls: string[], _filter: unknown, h: { onevent: (e: Event) => void; oneose: () => void }) => {
      setTimeout(() => { h.onevent(EV); h.oneose() }, 10)
      return { close: () => {} }
    }) as never)
    const got: string[] = []
    const handle = stream(['wss://fast.test', 'wss://hung.test'], { kinds: [33331], limit: 10 }, (e) => got.push(e.id), 60_000)
    let finished = false
    void handle.done.then(() => { finished = true })
    // The fast relay: its challenge wait (ten turns of 40ms) and the answer.
    await vi.advanceTimersByTimeAsync(500)
    expect(got).toEqual([EV.id])
    expect(finished).toBe(false)
    // The hung relay gives up at its connect deadline, not the read's minute.
    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS)
    expect(finished).toBe(true)
  })
})
