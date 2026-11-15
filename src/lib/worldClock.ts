/**
 * worldClock.ts - the one clock every `anim` runs on: Unix time, as this
 * device reads it (DECK-0003 §1.14, "The reader's clock").
 *
 * The device clock, corrected only when it is clearly off. Nothing waits on
 * the network: before any measurement, offline, or when measuring fails, the
 * device clock is used as it is, so motion always runs.
 *
 * Measuring: the `Date` header of a HEAD request to this page's own origin,
 * which a browser can always read (whole seconds). sno-core's animClock does
 * the arithmetic: the midpoint of the round trip, half a second for a time
 * cut down to whole seconds, the median of three samples, and a correction
 * applied only past 2 seconds, kept up to date, and dropped when a later
 * measurement falls to 2 seconds or less (correctionFor).
 *
 * A steady clock. Frames are timed from performance.now(), which never steps,
 * plus an offset to Unix time; a step in the device clock (a time sync, or
 * its user setting the clock) is taken as a correction, so every moving object
 * eases into the new time rather than jumps (scene/animMotion.ts).
 *
 * Measured when the first moving object mounts, again when the page comes
 * back into view, and every ten minutes while anything moves. ONOSENDAI's
 * lib/worldClock.ts is the same clock, measured against its relay as well.
 */

import { correctionFor, serverTimeOf, type ClockReading, type ClockSample } from 'sno-core/animClock'

/** A jump between the device clock and the steady one larger than this is a step in the device clock. */
export const STEP_MS = 1000
/** How often the clock is measured again while anything moves. */
export const REMEASURE_MS = 10 * 60_000
/** Samples taken in one measurement. */
export const SAMPLES = 3
/** How long one request may take before it is given up. */
export const REQUEST_TIMEOUT_MS = 4000
/** Least time between the measurements a return to the page asks for (focus and visibility both fire). */
export const RETURN_GAP_MS = 30_000

let offsetMs = 0
let version = 0
const mono = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** Unix ms minus steady ms: the device clock as the steady clock carries it, moved only by a step. */
let base = Date.now() - mono()
let lastKey: unknown = null
let lastStamp = NaN
const reading: ClockReading = { t: 0, version: 0, nowS: 0, chosen: false }

/** Unix ms now by the steady clock, following a step in the device clock and counting it as a correction. */
function deviceNow(monoMs: number): number {
  const steady = monoMs + base
  const real = Date.now()
  if (Math.abs(real - steady) > STEP_MS) {
    base += real - steady
    version++
    return real
  }
  return steady
}

/** Unix seconds now, corrected. */
export function worldNow(): number {
  return (deviceNow(mono()) + offsetMs) / 1000
}

/** The correction in force, ms (0 for none). */
export function clockOffset(): number {
  return offsetMs
}

/** Set the correction; bumps the version when it changes, so motions ease into it. */
export function setClockOffset(ms: number): void {
  const next = Math.round(ms)
  if (next === offsetMs) return
  offsetMs = next
  version++
  lastStamp = NaN
}

/**
 * The reading for this frame. `key` and `stamp` name the frame (an r3f clock
 * and its elapsedTime): the first caller in a frame works it out, the rest
 * get the same object.
 */
export function readClock(key: unknown, stamp: number): ClockReading {
  if (key === lastKey && stamp === lastStamp) return reading
  const monoMs = mono()
  const wall = deviceNow(monoMs)
  lastKey = key
  lastStamp = stamp
  reading.t = (wall + offsetMs) / 1000
  reading.version = version
  reading.nowS = monoMs / 1000
  return reading
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ headers: { get(name: string): string | null } }>

/** A few samples from one source; empty when it gives no readable time. */
export async function sampleFrom(url: string, fetcher: Fetcher, now: () => number = Date.now): Promise<ClockSample[]> {
  const out: ClockSample[] = []
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const sentMs = now()
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
      const res = await fetcher(url, { method: 'HEAD', cache: 'no-store', ...(signal ? { signal } : {}) })
      const gotMs = now()
      const time = serverTimeOf(res.headers)
      if (!time) return out
      out.push({ sentMs, gotMs, ...time })
    } catch { return out }
  }
  return out
}

let measuring: Promise<void> | null = null

/** Measure against this page's origin. One at a time; never throws. */
export function measure(fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<void> {
  measuring ??= (async () => {
    try {
      if (typeof location === 'undefined') return
      setClockOffset(correctionFor(await sampleFrom(location.origin + '/', fetcher), offsetMs))
    } finally { measuring = null }
  })()
  return measuring
}

let started = false
let live = 0
let lastReturn = -Infinity

/** A moving object mounted (+1) or went (−1). The first one starts the measuring. */
export function noteMoving(delta: 1 | -1): void {
  live = Math.max(0, live + delta)
  if (live > 0) startWorldClock()
}

function startWorldClock(): void {
  if (started || typeof window === 'undefined' || typeof fetch === 'undefined') return
  started = true
  void measure()
  setInterval(() => { if (live > 0) void measure() }, REMEASURE_MS)
  const back = (): void => {
    if (live === 0 || document.visibilityState === 'hidden') return
    const now = performance.now()
    if (now - lastReturn < RETURN_GAP_MS) return
    lastReturn = now
    void measure()
  }
  document.addEventListener('visibilitychange', back)
  window.addEventListener('focus', back)
}
