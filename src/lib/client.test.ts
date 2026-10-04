import { describe, expect, it } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { verifyEvent } from 'nostr-tools'
import { CLIENT_TAG, attributed } from './client'
import { localSigner } from './signers'

const template = (kind: number, tags: string[][] = []) => ({ kind, created_at: 1_700_000_000, tags, content: '' })

describe('attributed', () => {
  it('adds the client tag to an event that has none', () => {
    expect(attributed(template(33331, [['d', 'cube']])).tags).toEqual([['d', 'cube'], ['client', 'SNOcrash.art']])
  })

  it('leaves a template that already names a client alone', () => {
    const t = template(3367, [[...CLIENT_TAG]])
    expect(attributed(t)).toBe(t)
  })

  it('never attributes an auth event', () => {
    for (const kind of [22242, 24242, 27235]) expect(attributed(template(kind)).tags).toEqual([])
  })
})

describe('signing', () => {
  it('a local signer signs the attributed event, and its id and signature verify', async () => {
    const signed = await localSigner(generateSecretKey()).signEvent(template(33331, [['d', 'cube']]))
    expect(signed.tags).toContainEqual(CLIENT_TAG)
    expect(verifyEvent(signed)).toBe(true)
  })
})
