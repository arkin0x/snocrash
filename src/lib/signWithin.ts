/**
 * signWithin.ts - a signature, or a timeout.
 *
 * On its own so the store and the signers can both import it without a cycle.
 */

import type { EventTemplate, Event as NostrEvent } from 'nostr-tools'

/**
 * How long a remote signer (extension, bunker) gets to sign one event.
 *
 * A phone drops the signer's channel while the tab sits in another app, and
 * the socket stays open as far as the browser is concerned, so a request goes
 * out and is answered never. A signature that will never come has to fail,
 * not hang whatever awaited it: without this the PUBLISH button says SENDING
 * until the page is reloaded.
 */
export const SIGN_PATIENCE_MS = 15_000

export class SignerTimeout extends Error {
  constructor() {
    super('The signer did not answer in time.')
    this.name = 'SignerTimeout'
  }
}

/** The signature, or a SignerTimeout once the patience has run out. */
export async function signWithin(
  signer: { signEvent: (template: EventTemplate) => Promise<NostrEvent> },
  template: EventTemplate,
  ms: number = SIGN_PATIENCE_MS,
): Promise<NostrEvent> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SignerTimeout()), ms) })
  try {
    return await Promise.race([signer.signEvent(template), late])
  } finally {
    clearTimeout(timer)
  }
}
