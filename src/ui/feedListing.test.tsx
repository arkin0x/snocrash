/**
 * An object for sale in the feed: a tile with the seller's GIF, the title,
 * the price in sats and BUY ON <seller> with the link's own domain beside
 * it, which opens the seller's page in a new tab (its NIP-89 handler's, a
 * known key service's app, or njump). It has no shape until bought, so
 * nothing on it opens, remixes, copies, saves or stamps it.
 */

import { describe, expect, it, vi } from 'vitest'

// A server render reads a store's initial state; here it reads the live one.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { renderToStaticMarkup } from 'react-dom/server'
import { nip19, verifyEvent } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { listingFromEvent } from 'sno-core/feed'
import { ListingTile } from './Feed'
import SOURCE from './Feed.tsx?raw'
import { LISTING, listingWith } from '../store/fixtures/listing'
import { DOMAIN_SHOWN_MAX, domainShown, httpsImage, listingNaddr, listingPictures, satsLabel } from '../lib/listing'
import { useHandlers } from '../store/useHandlers'

const GIF = 'https://cdn.example.com/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.gif'
const PNG = 'https://cdn.example.com/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2.png'
const plainHttp = listingWith((tags) => tags.map((t) => (t[0] === 'imeta' ? t.map((p) => p.replace('url https:', 'url http:')) : t)))
const render = (ev = LISTING): string => renderToStaticMarkup(<ListingTile listing={{ ...listingFromEvent(ev)!, seen: ['wss://cyberspace.nostr1.com'] }} />)

describe('a listing as a tile shows it', () => {
  it('the fixture is a real signed event (a throwaway key, never published)', () => {
    expect(verifyEvent({ ...LISTING })).toBe(true)
  })

  it('its naddr names kind 33331, the seller, the d, and the relays it was seen on', () => {
    const decoded = nip19.decode(listingNaddr({ ...listingFromEvent(LISTING)!, seen: ['wss://cyberspace.nostr1.com'] })!)
    expect(decoded.type === 'naddr' && decoded.data).toEqual({ kind: 33331, pubkey: LISTING.pubkey, identifier: '6f1c2a8e-4b7d-4e0a-9c3f-2d5e8b1a7c40', relays: ['wss://cyberspace.nostr1.com'] })
  })

  it('prices in sats and shows https pictures only, the GIF first', () => {
    expect(satsLabel(2100)).toBe('2,100 sats')
    expect(satsLabel(1)).toBe('1 sat')
    expect(listingPictures(listingFromEvent(LISTING)!)).toEqual([GIF, PNG])
    expect(listingPictures(listingFromEvent(plainHttp)!)).toEqual([])
    for (const bad of ['http://cdn.example.com/a.gif', 'javascript:alert(1)', 'data:image/gif;base64,R0lG', '']) expect(httpsImage(bad), bad).toBeNull()
  })

  it('shows a long domain by its end, where the name it belongs to is', () => {
    expect(domainShown('fanfares.io')).toBe('fanfares.io')
    const shown = domainShown(`fanfares-io-official-${'x'.repeat(40)}-checkout.example`)
    expect(Array.from(shown)).toHaveLength(DOMAIN_SHOWN_MAX)
    expect(shown.startsWith('…')).toBe(true)
    expect(shown.endsWith('-checkout.example')).toBe(true)
  })
})

describe('a listing tile', () => {
  it('shows the GIF, the title, the price and a BUY button', () => {
    const html = render()
    expect(html).toContain(`src="${GIF}"`)
    expect(html).toContain('alt="A brass orrery turning on its base"')
    expect(html).toMatch(/referrerpolicy="no-referrer"/i)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('Brass Orrery')
    expect(html).toContain('2,100 sats')
    expect(html).toMatch(/BUY ON /)
  })

  const buy = (html: string): { tag: string; label: string; domain: string } => ({
    tag: /<a [^>]*class="btn tile__buy"[^>]*>/.exec(html)?.[0] ?? '',
    label: /<span class="tile__buy-label">([^<]*)<\/span>/.exec(html)?.[1] ?? '',
    domain: /<span class="tile__buy-domain">([^<]*)<\/span>/.exec(html)?.[1] ?? '',
  })
  const keyService = (url: string) => listingWith((tags) => tags.map((t) => (t[0] === 'encrypted' ? [t[0], t[1], t[2], url] : t)))

  it('with no handler and a Fanfares key service: BUY ON Fanfares, fanfares.io, its naddr page, a new tab, no opener, no referrer', () => {
    const b = buy(render(keyService('https://api.fanfares.live/request-key')))
    expect(b.label).toBe('BUY ON Fanfares')
    expect(b.domain).toBe('fanfares.io')
    expect(b.tag).toMatch(/href="https:\/\/fanfares\.io\/naddr\/naddr1[0-9a-z]+"/)
    expect(b.tag).toContain('target="_blank"')
    expect(b.tag).toContain('rel="noopener noreferrer"')
  })

  it("with no handler and another key service: njump, named for the key service's domain, njump.me beside it", () => {
    const b = buy(render(keyService('https://keys.sno.example.org/request-key')))
    expect(b.label).toBe('BUY ON example.org')
    expect(b.domain).toBe('njump.me')
    expect(b.tag).toMatch(/href="https:\/\/njump\.me\/naddr1[0-9a-z]+"/)
  })

  it("with the seller's handler: its page, its name, and the page's own domain, whatever the name claims", () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const listing = listingWith((tags) => [...tags.filter((t) => t[0] !== 'a'), ['client', 'Sno Shop', `31990:${pk}:snoshop`]])
    const handler = finalizeEvent({ kind: 31990, created_at: 1, content: JSON.stringify({ name: 'Fanfares' }), tags: [['d', 'snoshop'], ['k', '33331'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']] }, sk)
    useHandlers.setState({ handlers: { [`31990:${pk}:snoshop`]: handler } })
    const b = buy(render(listing))
    expect(b.label).toBe('BUY ON Fanfares')
    expect(b.domain).toBe('snoshop.example')
    expect(b.tag).toMatch(/href="https:\/\/shop\.snoshop\.example\/item\/naddr1[0-9a-z]+"/)
    useHandlers.setState({ handlers: {} })
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
