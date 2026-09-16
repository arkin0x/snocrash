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

import { SimplePool, type Event, type EventTemplate, type Filter, type VerifiedEvent } from 'nostr-tools'

export const pool = new SimplePool()

/** How long to keep a read open when a relay never says it is finished. */
export const READ_DEADLINE_MS = 6000

/* --------------------------------------------------------------------------
 * NIP-42, because one of the default relays refuses to be read without it
 *
 * cyberspace.nostr1.com answers an unauthenticated REQ with
 * `CLOSED: auth-required: you must auth`. The pool's read path does not retry
 * that, so the subscription simply ends and the query comes back empty: the
 * relay was in the default set and contributing nothing to any read, silently,
 * which is the worst way for a relay to fail.
 *
 * This is ONOSENDAI's implementation (src/lib/relay.ts), which has been in
 * production against that same relay. Both clients talk to the same relay and
 * the same class of bug, so the shape is kept deliberately identical rather
 * than reinvented here. It is not in sno-core because sno-core depends on
 * nothing but TypeScript, and pulling nostr-tools into a format and geometry
 * package to share sixty lines would change what that package is.
 * ------------------------------------------------------------------------ */

/**
 * Who answers a relay's challenge.
 *
 * Injected rather than imported, because the identity store imports this
 * module: reaching back into it from here would make a cycle. This also keeps
 * the pool honest about what it knows, which is nothing about signers beyond
 * how to ask one for a signature.
 */
let authSigner: ((template: EventTemplate) => Promise<Event>) | null = null

/**
 * Takes a plain signer and narrows it here, rather than making every caller
 * spell out nostr-tools' VerifiedEvent. A signature this app produced is
 * verified by construction; the brand is the library's bookkeeping, not a
 * claim this module is in a position to check.
 */
export function setAuthSigner(sign: (template: EventTemplate) => Promise<Event>): void {
  authSigner = sign
}

function authSign(template: EventTemplate): Promise<VerifiedEvent> {
  if (!authSigner) return Promise.reject(new Error('No signer for the relay challenge.'))
  return authSigner(template) as Promise<VerifiedEvent>
}

// Not in SimplePool's constructor options, which takes only enablePing and
// enableReconnect, but the abstract pool it extends honours the field: when a
// relay proactively sends an AUTH challenge, answer it.
;(pool as unknown as { automaticallyAuth?: (url: string) => typeof authSign }).automaticallyAuth = () => authSign

interface AuthRelay {
  challenge?: string
  auth(sign: typeof authSign): Promise<unknown>
}

/** Relays already authenticated, by the challenge they were authenticated for. */
const authedFor = new Map<string, string>()
/** Relays that have never challenged, so the wait below can be skipped. */
const noChallenge = new Set<string>()

/**
 * Make sure a connection is authenticated before it is read from or written to.
 *
 * Open the relay, wait briefly for its challenge, and answer it up front
 * rather than discovering the refusal after a REQ has already been closed.
 * `relay.auth` caches its own promise per challenge, so calling this before
 * every operation costs nothing once it is done, and a reconnect that brings a
 * fresh challenge re-authenticates on its own.
 *
 * Everything here is best effort. A relay that is down, that never challenges,
 * or that this app has no key for is left exactly as it was: unauthenticated
 * and still readable if it allows that.
 */
async function authRelay(url: string): Promise<void> {
  if (noChallenge.has(url)) return
  try {
    const relay = (await pool.ensureRelay(url)) as unknown as AuthRelay
    // The challenge arrives on its own just after the socket opens, so this
    // waits for it rather than asking. Ten turns of 40ms: long enough for a
    // relay that challenges, short enough that three that do not cost the
    // first read of the session about a tenth of a second each, once.
    for (let i = 0; i < 10 && !relay.challenge; i++) await new Promise((r) => setTimeout(r, 40))
    if (!relay.challenge) { noChallenge.add(url); return }
    if (authedFor.get(url) !== relay.challenge) {
      await relay.auth(authSign)
      authedFor.set(url, relay.challenge)
    }
  } catch { /* down, or wants no auth, or there is no key to sign with */ }
}

/** Authenticate wherever it is needed, in parallel, before touching any of them. */
export async function authAll(relays: string[]): Promise<void> {
  await Promise.allSettled(relays.map(authRelay))
}

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
  let sub: { close: () => void } | null = null

  const stop = (): void => {
    if (finished) return
    finished = true
    window.clearTimeout(timer)
    try { sub?.close() } catch { /* already closed */ }
    settle()
  }

  const timer = window.setTimeout(stop, deadline)

  // Authenticate first, then ask. Subscribing before the challenge is answered
  // is what gets the REQ closed on an auth-gated relay, and the pool does not
  // retry a closed REQ. The handle is returned now rather than awaited, so a
  // caller can still give up during the handshake; `stop` closes whatever
  // exists by then, and the subscription below checks before opening.
  void authAll(relays).then(() => {
    if (finished) return
    sub = pool.subscribeMany(relays, filter, {
      onevent,
      // Every relay has said it has nothing further. Whatever else is out there
      // is not on these relays, so waiting longer buys nothing.
      oneose: stop,
      onclose: stop,
    })
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
