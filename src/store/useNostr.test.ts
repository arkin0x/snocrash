/**
 * useNostr.test.ts - the palette event, both directions (DECK-0003 §1.3b).
 *
 * A palette on nostr is a kind 3367 event whose colours are `c` tags, one per
 * colour, in index order. The shapes tested here are the ones on the network
 * rather than the ones the deck guessed at before anyone had looked: the
 * espy.you event below is one the survey recorded, and all 205 palettes it
 * found are shaped like it.
 */

import { describe, it, expect } from 'vitest'
import { decodeObjectAddress, objectAddress, objectFromEvent, objectTemplate, paletteTemplate, PALETTE_KIND } from './useNostr'
import { withCredit } from 'sno-core/feed'
import { nip19 } from 'nostr-tools'
import { BUILT_IN, parsePaletteEvent, remap, resolvePalette, toBytes, toModel, type Palette } from 'sno-core/snoPalette'

/** A real palette, published by espy.you, from the kind 3367 survey of 2026-09-16. */
const ESPY = {
  kind: 3367,
  id: '9b2cce70ff078e39aea93fd7c2f1a2128a123a004cf9d4fdc3db65ce138a3ad7',
  pubkey: '765c2fe92035657774080c87426f8dd8b4c8bbbadca702c93247efccf69d8618',
  created_at: 1789310239,
  tags: [
    ['c', '#B4B4AF'], ['c', '#FC4755'], ['c', '#D1242B'],
    ['c', '#694F34'], ['c', '#A1785D'], ['c', '#01AE85'],
    ['layout', 'horizontal'],
    ['alt', 'Color moment: #B4B4AF, #FC4755, #D1242B, #694F34, #A1785D, #01AE85'],
    ['client', '3cbg51pm00nms2dp8rm9xiswj8i6n4sfp0mlc8obmum6dd31hjespy.nsite.localhost'],
  ],
  content: '\u{1F3F0}',
}

const ESPY_COLORS: Palette = [
  [180, 180, 175], [252, 71, 85], [209, 36, 43],
  [105, 79, 52], [161, 120, 93], [1, 174, 133],
]

/** Any well-formed reference. What it points at is the fetched event, not this. */
const NEVENT = 'nevent1qqsfktxwwrls0r3e465nl47z7x3p9zsj8gqye7w5lhpakewwzw9r44cpp4mhxue69uhkummn9ekx7mqwz8u63'

const tagsOf = (ev: { tags: string[][] }, name: string): string[][] => ev.tags.filter((t) => t[0] === name)

describe('reading a palette event', () => {
  it('reads a real kind 3367 event, whose colours are in c tags', () => {
    expect(parsePaletteEvent(ESPY)).toEqual(ESPY_COLORS)
  })

  it('takes the tags in document order, because the order is the index', () => {
    const ev = { content: '', tags: [['c', '#00ff00'], ['c', '#ff0000']] }
    expect(parsePaletteEvent(ev)).toEqual([[0, 255, 0], [255, 0, 0]])
  })

  it('takes the tags over a content that also parses', () => {
    const both = { ...ESPY, content: JSON.stringify(['#000000', '#111111', '#222222']) }
    expect(parsePaletteEvent(both)).toEqual(ESPY_COLORS)
  })

  it('reads the legacy content form when the tags carry no palette', () => {
    const legacy = { content: JSON.stringify(['#000000', '#111111']), tags: [['name', 'two greys']] }
    expect(parsePaletteEvent(legacy)).toEqual([[0, 0, 0], [17, 17, 17]])
  })

  it('falls through to the content when the tags do not parse, taking the first rule that succeeds', () => {
    const ev = { content: JSON.stringify(['#000000', '#111111']), tags: [['c', 'not a colour']] }
    expect(parsePaletteEvent(ev)).toEqual([[0, 0, 0], [17, 17, 17]])
  })

  it('fails the whole tag path on one malformed value rather than leaving a hole', () => {
    // Skipping it would shift every index after it, which is a different
    // palette rather than a repaired one.
    expect(parsePaletteEvent({ content: '', tags: [['c', '#ff0000'], ['c', 'ff0000'], ['c', '#0000ff']] })).toBeNull()
    expect(parsePaletteEvent({ content: '', tags: [['c', '#ff0000'], ['c'], ['c', '#0000ff']] })).toBeNull()
  })

  it('treats an event with neither as a failed fetch rather than an error', () => {
    for (const ev of [
      { content: '\u{1F3A8}', tags: [] },
      { content: '', tags: [['c', '#ff0000']] },
      { content: 'not json', tags: [['name', 'nothing here']] },
      { content: '', tags: Array.from({ length: 257 }, () => ['c', '#ff0000']) },
      {},
    ]) {
      expect(parsePaletteEvent(ev)).toBeNull()
      // And the object drawn with it renders in the built-in, never rejected.
      expect(resolvePalette(NEVENT, ev)).toBe(BUILT_IN)
    }
  })

  it('accepts an nevent as well as an naddr, since a 3367 has no address', () => {
    expect(resolvePalette(NEVENT, ESPY)).toEqual(ESPY_COLORS)
    expect(resolvePalette('naddr1qqxnzdenxvmnxdfhxg6rwwfjqy88wumn8ghj7mn0wvhxcmmv', ESPY)).toEqual(ESPY_COLORS)
    // Unresolved is the built-in, because a reference is never load-bearing.
    expect(resolvePalette(NEVENT)).toBe(BUILT_IN)
  })
})

describe('writing a palette event', () => {
  const three: Palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]

  it('writes one c tag per colour, in index order, and no palette in the content', () => {
    const ev = paletteTemplate('traffic', three, 1789310239)
    expect(ev.kind).toBe(PALETTE_KIND)
    expect(tagsOf(ev, 'c')).toEqual([['c', '#ff0000'], ['c', '#00ff00'], ['c', '#0000ff']])
    expect(ev.content).toBe('')
  })

  it('says what it is, for a client that cannot render it', () => {
    const ev = paletteTemplate('traffic', three, 1789310239)
    expect(tagsOf(ev, 'name')).toEqual([['name', 'traffic']])
    expect(tagsOf(ev, 'alt')[0][1]).toContain('traffic')
    expect(tagsOf(ev, 'alt')[0][1]).toContain('#ff0000')
    expect(tagsOf(ev, 'client')).toEqual([['client', 'SNOcrash.art']])
    expect(tagsOf(ev, 'layout')).toEqual([['layout', 'horizontal']])
  })

  it('names all 256 when there are 256, since the colours only live in tags', () => {
    const ev = paletteTemplate('the built-in', BUILT_IN, 1)
    expect(tagsOf(ev, 'c')).toHaveLength(256)
    expect(parsePaletteEvent(ev)).toEqual(BUILT_IN)
  })

  it('round trips: what it writes is what the reader reads', () => {
    expect(parsePaletteEvent(paletteTemplate('traffic', three, 1))).toEqual(three)
  })

  it('a first edit names the event it corrects, and nothing else', () => {
    // The previous event IS the genesis at this point, and one hop back finds
    // it, so a second tag saying the same id would be noise.
    const ev = paletteTemplate('traffic', three, 2, { id: 'aa', genesis: 'aa', relays: ['wss://nos.lol'] })
    expect(tagsOf(ev, 'e')).toEqual([['e', 'aa', 'wss://nos.lol', 'previous']])
  })

  it('a later edit names the step back and where the chain started', () => {
    const ev = paletteTemplate('traffic', three, 3, { id: 'bb', genesis: 'aa', relays: ['wss://nos.lol'] })
    expect(tagsOf(ev, 'e')).toEqual([
      ['e', 'bb', 'wss://nos.lol', 'previous'],
      ['e', 'aa', '', 'genesis'],
    ])
  })

  it('writes no relay hint rather than a wrong one', () => {
    const ev = paletteTemplate('traffic', three, 4, { id: 'aa', genesis: 'aa', relays: [] })
    expect(tagsOf(ev, 'e')).toEqual([['e', 'aa', '', 'previous']])
  })
})

describe('a palette shorter than the indices in hand', () => {
  it('fills index 3 and up from the built-in, so nothing collapses onto one colour', () => {
    // Three colours is what most of the network publishes, and an object that
    // moves onto one keeps every index it had.
    const three: Palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
    const wearing = [0, 1, 2, 5, 200].map((i) => toModel(BUILT_IN[i]))
    const moved = remap(wearing, BUILT_IN, three).map(toBytes)
    expect(moved.slice(0, 3)).toEqual(three)
    expect(moved[3]).toEqual(BUILT_IN[5])
    expect(moved[4]).toEqual(BUILT_IN[200])
  })
})

describe('an object address', () => {
  const pubkey = 'a'.repeat(64)
  const o = { id: 'e'.repeat(64), pubkey, createdAt: 1, d: 'a1b2c3', address: `33331:${pubkey}:a1b2c3`, shard: {} as never, event: {} as never }

  it('round-trips author and d through the naddr a feed tile links to', () => {
    const address = objectAddress(o)
    expect(address.startsWith('naddr1')).toBe(true)
    expect(decodeObjectAddress(address)).toMatchObject({ pubkey, d: 'a1b2c3' })
    // As pasted from a nostr: link, too.
    expect(decodeObjectAddress(`nostr:${address}`)).toMatchObject({ pubkey, d: 'a1b2c3' })
  })

  it('refuses what is not an object: junk, another kind, another kind of pointer', () => {
    expect(decodeObjectAddress('not an address')).toBeNull()
    expect(decodeObjectAddress(nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'x' }))).toBeNull()
    expect(decodeObjectAddress(nip19.npubEncode(pubkey))).toBeNull()
  })
})

describe('an object from an event (sno-core/feed, shared with ONOSENDAI)', () => {
  it('carries its address and the event it was read from, as both clients now read it', () => {
    const pubkey = 'b'.repeat(64)
    const content = JSON.stringify({ v: 2, name: 'lamp', unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] })
    const ev = { id: 'c'.repeat(64), pubkey, created_at: 5, kind: 33331, tags: [['d', 'lamp']], content, sig: '' }
    const o = objectFromEvent(ev)
    expect(o?.address).toBe(`33331:${pubkey}:lamp`)
    expect(o?.event).toBe(ev)
    expect(o?.shard.name).toBe('lamp')
  })
})

describe('a remix, published (DECK-0003 crediting; ruled 2026-10-08)', () => {
  const author = 'd'.repeat(64)
  const content = JSON.stringify({ v: 2, name: 'chair', unit: 0, extent: 8, mode: 'points', vertices: [[1, 0, 0]], colors: [229], faces: [] })
  const original = objectFromEvent({ id: 'e'.repeat(64), pubkey: author, created_at: 1, kind: 33331, tags: [['d', 'chair']], content })!

  it('credits the original with the q tag and tells its author with the p tag', () => {
    const remix = withCredit({ ...original.shard, id: 'my-chair' }, { address: original.address, relay: 'wss://relay.example' })
    const tags = objectTemplate(remix, 2).tags
    expect(tags).toContainEqual(['q', `33331:${author}:chair`, 'wss://relay.example'])
    expect(tags).toContainEqual(['p', author])
    // Not as a placement: a and e on an object mean "this places that" (§1.10).
    expect(tags.some((t) => (t[0] === 'a' || t[0] === 'e') && t[1]?.includes(':chair'))).toBe(false)
  })

  it('an original carries neither', () => {
    const tags = objectTemplate({ ...original.shard, id: 'mine' }, 2).tags
    expect(tags.some((t) => t[0] === 'q' || t[0] === 'p')).toBe(false)
  })
})
