/**
 * handlers.test.ts - the apps that sell listed objects (NIP-89 handlers):
 * fetched once per app from the profile relays, checked (signature, author,
 * kind, d), the newest kept, a bounded number remembered. Handlers here are
 * signed with throwaway keys made for the test; nothing is published.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const held: unknown[] = []
const queryAny = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 5))
  return held.map((event) => ({ event, relays: ['wss://mine.test'] }))
})
vi.mock('../lib/pool', () => ({ queryAny: (...a: unknown[]) => queryAny(...(a as [])) }))
vi.mock('./useRelays', () => ({ relaySet: () => ['wss://mine.test'] }))

import { listingApp, type ListingApp } from 'sno-core/feed'
import { HANDLERS_KEPT, isHandlerOf, useHandlers } from './useHandlers'

const appKey = generateSecretKey()
const APP_PK = getPublicKey(appKey)
const app: ListingApp = listingApp([['client', 'Sno Shop', `31990:${APP_PK}:snoshop`]])!
const handler = (createdAt: number, over: { d?: string; kind?: number } = {}, key = appKey) => finalizeEvent({
  kind: over.kind ?? 31990, created_at: createdAt, content: JSON.stringify({ name: 'Sno Shop' }),
  tags: [['d', over.d ?? 'snoshop'], ['k', '33331'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']],
}, key)

beforeEach(() => {
  held.length = 0
  queryAny.mockClear()
  useHandlers.setState({ handlers: {} })
})

describe('NIP-89 handlers for listings', () => {
  it('asks the profile relays once per app, by coordinate, and keeps the newest valid handler', async () => {
    held.push(handler(100), handler(200), handler(300, { d: 'other' }), handler(400, { kind: 31989 }))
    useHandlers.getState().request(app)
    useHandlers.getState().request(app)
    expect(queryAny).toHaveBeenCalledTimes(1)
    expect(queryAny.mock.calls[0]).toEqual([['wss://mine.test'], { kinds: [31990], authors: [APP_PK], '#d': ['snoshop'], limit: 5 }, 5000])
    await vi.waitFor(() => expect(useHandlers.getState().handlers[app.address]).toBeDefined())
    expect(useHandlers.getState().handlers[app.address]?.created_at).toBe(200)
    useHandlers.getState().request(app)
    expect(queryAny).toHaveBeenCalledTimes(1)
  })

  it("a handler signed by another key, or with a forged signature, is not the app's", async () => {
    const other = handler(500, {}, generateSecretKey())
    const forged = { ...handler(600), content: JSON.stringify({ name: 'Swapped' }) }
    expect(isHandlerOf(handler(1), app)).toBe(true)
    expect(isHandlerOf(other, app)).toBe(false)
    expect(isHandlerOf({ ...other, pubkey: APP_PK }, app)).toBe(false)
    expect(isHandlerOf(forged, app)).toBe(false)
    held.push(other, forged)
    useHandlers.getState().request(app)
    await vi.waitFor(() => expect(app.address in useHandlers.getState().handlers).toBe(true))
    expect(useHandlers.getState().handlers[app.address]).toBeNull()
  })

  it('remembers at most HANDLERS_KEPT apps, the oldest going first', async () => {
    const seeded: Record<string, null> = {}
    for (let i = 0; i < HANDLERS_KEPT; i++) seeded[`31990:${'0'.repeat(63)}${i % 10}:app${i}`] = null
    useHandlers.setState({ handlers: seeded })
    useHandlers.getState().request(app)
    await vi.waitFor(() => expect(app.address in useHandlers.getState().handlers).toBe(true))
    const keys = Object.keys(useHandlers.getState().handlers)
    expect(keys).toHaveLength(HANDLERS_KEPT)
    expect(keys).not.toContain(Object.keys(seeded)[0])
  })
})
