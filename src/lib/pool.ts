/**
 * pool.ts - the one connection pool, and the one way to ask a question of it.
 *
 * Every read in this app has the same shape: ask several relays at once, and
 * do not let the slowest one decide when you are finished.
 *
 * That is not what `querySync` does. It resolves when every relay has sent
 * EOSE, or when `maxWait` runs out, whichever is first, so a single relay that
 * answers slowly or never sends EOSE at all costs the whole wait. With four
 * relays and an eight second ceiling that is what the feed was doing: nothing
 * appeared for the better part of ten seconds, including the events that had
 * arrived in the first two hundred milliseconds.
 *
 * `stream` hands events over as they arrive instead. The caller paints on the
 * first one, the subscription closes as soon as every relay has finished, and
 * the deadline is only there for the relay that never does.
 */

import { SimplePool, type Event, type Filter } from 'nostr-tools'

export const pool = new SimplePool()

/** How long to keep a read open when a relay never says it is finished. */
export const READ_DEADLINE_MS = 6000

export interface StreamHandle {
  /** Resolves when every relay has finished, or the deadline passes. */
  done: Promise<void>
  /** Give up now. Safe to call twice. */
  close: () => void
}

/**
 * Read from several relays at once, handing each event over as it lands.
 *
 * `onevent` may be called with the same event from more than one relay; the
 * caller decides what to do about that, because the right answer depends on
 * what it is collecting.
 */
export function stream(
  relays: string[],
  filter: Filter,
  onevent: (ev: Event) => void,
  deadline: number = READ_DEADLINE_MS,
): StreamHandle {
  let finished = false
  let settle: () => void = () => {}
  const done = new Promise<void>((resolve) => { settle = resolve })

  const stop = (): void => {
    if (finished) return
    finished = true
    window.clearTimeout(timer)
    try { sub.close() } catch { /* already closed */ }
    settle()
  }

  const timer = window.setTimeout(stop, deadline)
  const sub = pool.subscribeMany(relays, filter, {
    onevent,
    // Every relay has said it has nothing further. Whatever else is out there
    // is not on these relays, so waiting longer buys nothing.
    oneose: stop,
    onclose: stop,
  })

  return { done, close: stop }
}

/** Collect everything a read returns, for callers that cannot paint early. */
export async function queryAny(relays: string[], filter: Filter, deadline: number = READ_DEADLINE_MS): Promise<Event[]> {
  const out: Event[] = []
  const seen = new Set<string>()
  await stream(relays, filter, (ev) => { if (!seen.has(ev.id)) { seen.add(ev.id); out.push(ev) } }, deadline).done
  return out
}
