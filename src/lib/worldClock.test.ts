/**
 * worldClock.test.ts - measuring against this page's own Date header: three
 * samples, nothing when the header is missing or the request fails, and a
 * correction only past 2 seconds (sno-core animClock correctionFor).
 */
import { describe, expect, it } from 'vitest'
import { clockOffset, sampleFrom, setClockOffset } from './worldClock'

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('sampling', () => {
  it('takes three samples of a readable Date', async () => {
    let t = 0
    const now = () => (t += 100)
    const got = await sampleFrom('https://x/', async () => ({ headers: headers({ date: 'Fri, 20 Nov 2026 00:00:00 GMT' }) }), now)
    expect(got).toHaveLength(3)
    expect(got[0]).toMatchObject({ sentMs: 100, gotMs: 200, serverMs: 1795132800000, resolutionMs: 1000 })
  })
  it('gives nothing for no Date, or a failed request', async () => {
    expect(await sampleFrom('https://x/', async () => ({ headers: headers({}) }))).toEqual([])
    expect(await sampleFrom('https://x/', async () => { throw new Error('offline') })).toEqual([])
  })
  it('keeps the correction it is given', () => {
    setClockOffset(2600.4)
    expect(clockOffset()).toBe(2600)
    setClockOffset(0)
  })
})
