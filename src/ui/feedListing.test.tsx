/**
 * An object for sale on Fanfares in the feed: a tile with the seller's GIF,
 * the title, the price in sats and BUY ON FANFARES, which opens the Fanfares
 * page (https://fanfares.io/naddr/<naddr>) in a new tab. It has no shape until
 * bought, so nothing on it opens, remixes, copies, saves or stamps it.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { nip19, verifyEvent } from 'nostr-tools'
import { listingFromEvent } from 'sno-core/feed'
import { ListingTile } from './Feed'
import SOURCE from './Feed.tsx?raw'
import { LISTING, listingWith } from '../store/fixtures/listing'
import { fanfaresUrl, httpsImage, listingPictures, satsLabel } from '../lib/fanfares'

const GIF = 'https://cdn.example.com/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.gif'
const PNG = 'https://cdn.example.com/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2.png'
const plainHttp = listingWith((tags) => tags.map((t) => (t[0] === 'imeta' ? t.map((p) => p.replace('url https:', 'url http:')) : t)))
const render = (ev = LISTING): string => renderToStaticMarkup(<ListingTile listing={{ ...listingFromEvent(ev)!, seen: ['wss://cyberspace.nostr1.com'] }} />)

describe('the Fanfares page for a listing', () => {
  it('the fixture is a real signed event (a throwaway key, never published)', () => {
    expect(verifyEvent({ ...LISTING })).toBe(true)
  })

  it('is fanfares.io/naddr/<naddr>: kind 33331, the seller, the d, and the relays it was seen on', () => {
    const url = fanfaresUrl({ ...listingFromEvent(LISTING)!, seen: ['wss://cyberspace.nostr1.com'] })
    expect(url.startsWith('https://fanfares.io/naddr/naddr1')).toBe(true)
    const decoded = nip19.decode(url.slice('https://fanfares.io/naddr/'.length))
    expect(decoded.type === 'naddr' && decoded.data).toEqual({ kind: 33331, pubkey: LISTING.pubkey, identifier: '6f1c2a8e-4b7d-4e0a-9c3f-2d5e8b1a7c40', relays: ['wss://cyberspace.nostr1.com'] })
  })

  it('prices in sats and shows https pictures only, the GIF first', () => {
    expect(satsLabel(2100)).toBe('2,100 sats')
    expect(satsLabel(1)).toBe('1 sat')
    expect(listingPictures(listingFromEvent(LISTING)!)).toEqual([GIF, PNG])
    expect(listingPictures(listingFromEvent(plainHttp)!)).toEqual([])
    for (const bad of ['http://cdn.example.com/a.gif', 'javascript:alert(1)', 'data:image/gif;base64,R0lG', '']) expect(httpsImage(bad), bad).toBeNull()
  })
})

describe('a listing tile', () => {
  it('shows the GIF, the title, the price and BUY ON FANFARES', () => {
    const html = render()
    expect(html).toContain(`src="${GIF}"`)
    expect(html).toContain('alt="A brass orrery turning on its base"')
    expect(html).toMatch(/referrerpolicy="no-referrer"/i)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('Brass Orrery')
    expect(html).toContain('2,100 sats')
    expect(html).toContain('BUY ON FANFARES')
  })

  it('BUY ON FANFARES opens the naddr page in a new tab, with no opener and no referrer', () => {
    const a = /<a [^>]*class="btn tile__buy"[^>]*>/.exec(render())?.[0] ?? ''
    expect(a).toMatch(/href="https:\/\/fanfares\.io\/naddr\/naddr1[0-9a-z]+"/)
    expect(a).toContain('target="_blank"')
    expect(a).toContain('rel="noopener noreferrer"')
  })

  it('has nothing that opens, remixes, copies, saves or stamps it: no buttons, no 3D preview', () => {
    const html = render()
    expect(html).not.toContain('<button')
    expect(html).not.toContain('preview--open')
    expect(html).not.toMatch(/Edit a copy|Copy the object|Save as a PLY/)
  })

  it('shows a lock, not a picture, when no picture is https', () => {
    const html = render(plainHttp)
    expect(html).not.toContain('<img')
    expect(html).toContain('listing__lock')
  })
})

describe('the feed draws listings among its objects (source)', () => {
  it('merges objects and listings newest first, once per change', () => {
    expect(SOURCE).toMatch(/useMemo\(\(\) => feedItems\(\{ objects: feed, listings \}\), \[feed, listings\]\)/)
    expect(SOURCE).toMatch(/items\.map\(\(o\) => isListing\(o\)\s*\n\s*\? <ListingTile/)
  })

  it('a listing is never handed to choose (stamping) or view (opening in the workshop)', () => {
    const tile = SOURCE.slice(SOURCE.indexOf('export function ListingTile'), SOURCE.indexOf('export function Feed('))
    expect(tile.length).toBeGreaterThan(0)
    expect(tile).not.toMatch(/choose\(|view\(|importShard|setStampObject|toPayload|toPly/)
  })

  it('counts what is for sale beside the objects, in the header', () => {
    // Objects count only objects (2 objects and 1 listing read "2 objects · 1 for sale", three tiles),
    // and the "for sale" part shows only when something is.
    expect(SOURCE).toContain("`${feed.length} object${feed.length === 1 ? '' : 's'}${listings.length ? ` · ${listings.length} for sale` : ''}`")
  })
})
