/**
 * What these prove: a relay address is only accepted when it is one, the list
 * cannot be emptied, and what is stored survives a reload including the
 * removal of a default.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_RELAYS, load, normalizeRelay, useRelays } from './useRelays'

function stubStorage(): void {
  const map = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
  }
}

describe('normalizeRelay', () => {
  it('assumes wss when no scheme is given, because that is what a relay is', () => {
    expect(normalizeRelay('relay.example.com')).toBe('wss://relay.example.com')
    expect(normalizeRelay('  relay.example.com  ')).toBe('wss://relay.example.com')
  })

  it('keeps an explicit scheme, a port and a path', () => {
    expect(normalizeRelay('wss://relay.example.com')).toBe('wss://relay.example.com')
    expect(normalizeRelay('ws://localhost:7777')).toBe('ws://localhost:7777')
    expect(normalizeRelay('wss://relay.example.com/inbox')).toBe('wss://relay.example.com/inbox')
  })

  it('drops a trailing slash so the same relay is never in the list twice', () => {
    expect(normalizeRelay('wss://relay.example.com/')).toBe('wss://relay.example.com')
  })

  it('refuses what is not a relay address', () => {
    for (const bad of ['', '   ', 'relay example com', 'https://relay.example.com', 'wss://nodot', 'not a url']) {
      expect(normalizeRelay(bad), bad).toBeNull()
    }
  })
})

describe('the list', () => {
  beforeEach(() => {
    stubStorage()
    useRelays.setState({ relays: [...DEFAULT_RELAYS] })
  })

  it('adds a normalized relay once', () => {
    expect(useRelays.getState().add('relay.example.com')).toBe('wss://relay.example.com')
    expect(useRelays.getState().relays).toContain('wss://relay.example.com')
    const n = useRelays.getState().relays.length
    // The same relay written another way is the same relay.
    useRelays.getState().add('wss://relay.example.com/')
    expect(useRelays.getState().relays.length).toBe(n)
  })

  it('refuses to add something that is not an address, and changes nothing', () => {
    const before = useRelays.getState().relays
    expect(useRelays.getState().add('nonsense')).toBeNull()
    expect(useRelays.getState().relays).toBe(before)
  })

  it('removes any relay, defaults included', () => {
    useRelays.getState().remove(DEFAULT_RELAYS[0])
    expect(useRelays.getState().relays).not.toContain(DEFAULT_RELAYS[0])
  })

  it('will not remove the last one', () => {
    // Nothing works without a relay, and nothing on screen would say why.
    useRelays.setState({ relays: ['wss://only.example.com'] })
    useRelays.getState().remove('wss://only.example.com')
    expect(useRelays.getState().relays).toEqual(['wss://only.example.com'])
  })

  it('goes back to the defaults', () => {
    useRelays.getState().remove(DEFAULT_RELAYS[0])
    useRelays.getState().add('wss://relay.example.com')
    useRelays.getState().reset()
    expect(useRelays.getState().relays).toEqual(DEFAULT_RELAYS)
  })
})

describe('the canonical relay switch (2026-11-05)', () => {
  const OLD_SAVED = ['wss://cyberspace.nostr1.com', 'wss://relay.damus.io', 'wss://mine.example.com']

  beforeEach(() => stubStorage())

  it('puts wss://relay.onosendai.tech first and keeps nostr1 second in the defaults', () => {
    expect(DEFAULT_RELAYS.slice(0, 2)).toEqual(['wss://relay.onosendai.tech', 'wss://cyberspace.nostr1.com'])
  })

  it('gives a new arrival the defaults', () => {
    expect(load()).toEqual(DEFAULT_RELAYS)
  })

  it('puts the new relay at the front of a list saved before the switch, and saves that', () => {
    localStorage.setItem('snocrash:relays', JSON.stringify(OLD_SAVED))
    expect(load()).toEqual(['wss://relay.onosendai.tech', ...OLD_SAVED])
    expect(JSON.parse(localStorage.getItem('snocrash:relays')!)).toEqual(['wss://relay.onosendai.tech', ...OLD_SAVED])
  })

  it('offers it once: removing it afterwards sticks across a reload', () => {
    localStorage.setItem('snocrash:relays', JSON.stringify(OLD_SAVED))
    useRelays.setState({ relays: load() })
    useRelays.getState().remove('wss://relay.onosendai.tech')
    expect(load()).toEqual(OLD_SAVED)
  })

  it('removing it from the defaults sticks too', () => {
    useRelays.setState({ relays: load() })
    useRelays.getState().remove('wss://relay.onosendai.tech')
    expect(load()).toEqual(DEFAULT_RELAYS.filter((r) => r !== 'wss://relay.onosendai.tech'))
  })

  it('leaves a saved list that already has it alone', () => {
    const saved = ['wss://mine.example.com', 'wss://relay.onosendai.tech']
    localStorage.setItem('snocrash:relays', JSON.stringify(saved))
    expect(load()).toEqual(saved)
  })
})
