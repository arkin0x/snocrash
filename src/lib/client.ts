/**
 * client.ts: the name snocrash signs its events with.
 *
 * NIP-89 lets an event say which app published it with a `client` tag:
 * `["client", "<name>"]`, optionally followed by the address of the app's
 * kind 31990 handler event and a relay hint. snocrash has no app pubkey and
 * so no handler event yet, which leaves the name alone; that is a valid tag.
 * ditto.pub draws SNO objects and names the client that made them, so a SNO
 * made here says SNOcrash.art there (arkinox, 2026-10-04).
 *
 * Every event the app signs carries it, added by the signers themselves so
 * no publishing path can forget it. A template that already names a client
 * is left as it is, and auth events are not attributed: they are proofs
 * handed to one server (a relay's NIP-42 challenge, a Blossom upload, an
 * HTTP request) and are never published, so there is no reader to tell.
 */

import type { EventTemplate } from 'nostr-tools'

export const CLIENT_NAME = 'SNOcrash.art'

/** NIP-89 client attribution, by name only until the app has a handler event. */
export const CLIENT_TAG: [string, string] = ['client', CLIENT_NAME]

/** Auth events: NIP-42 relay auth, Blossom upload auth, NIP-98 HTTP auth. */
const UNATTRIBUTED_KINDS = new Set([22242, 24242, 27235])

/** The template with snocrash's client tag, unless it is an auth event or already names a client. */
export function attributed<T extends EventTemplate>(template: T): T {
  if (UNATTRIBUTED_KINDS.has(template.kind)) return template
  if (template.tags.some((t) => t[0] === 'client')) return template
  return { ...template, tags: [...template.tags, [...CLIENT_TAG]] }
}
