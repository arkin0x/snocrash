/**
 * loginCredentials.test.ts - the one login field and the QR's relays, as
 * ONOSENDAI tests them (signers.test.ts, ONOSENDAI #196). Nothing here opens
 * a socket: a QR session is only made, never connected.
 */

import { describe, expect, it } from 'vitest'
import {
  BACKUP_SIGNER_RELAY,
  DEFAULT_SIGNER_RELAY,
  loginCredentialKind,
  normalizeSignerRelay,
  signerRelays,
} from './loginCredentials'
import { createNostrConnectSession } from './signers'

describe('login credential classification', () => {
  it('accepts every credential supported by the shared login field', () => {
    expect(loginCredentialKind('  nsec1secret ')).toBe('nsec')
    expect(loginCredentialKind('ncryptsec1encrypted')).toBe('ncryptsec')
    expect(loginCredentialKind('bunker://abc')).toBe('bunker')
  })

  it('does not guess for unsupported input', () => {
    expect(loginCredentialKind('npub1public')).toBeNull()
    expect(loginCredentialKind('')).toBeNull()
  })
})

describe('Nostr Connect session setup', () => {
  it('normalizes WebSocket relay URLs and rejects web URLs', () => {
    expect(normalizeSignerRelay(' wss://bucket.coracle.social/ ')).toBe(DEFAULT_SIGNER_RELAY)
    expect(normalizeSignerRelay('ws://localhost:7777/path/')).toBe('ws://localhost:7777/path')
    expect(() => normalizeSignerRelay('https://bucket.coracle.social')).toThrow(/wss:\/\//)
  })

  it('names this app, and asks only to learn the key and to sign', () => {
    const url = new URL(createNostrConnectSession().uri)
    expect(url.protocol).toBe('nostrconnect:')
    expect(url.searchParams.get('name')).toBe('snocrash')
    expect(url.searchParams.get('perms')).toBe('get_public_key,sign_event')
    expect(url.searchParams.get('secret')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('makes a fresh client key and secret for every QR', () => {
    const a = new URL(createNostrConnectSession().uri)
    const b = new URL(createNostrConnectSession().uri)
    expect(a.host).not.toBe(b.host)
    expect(a.searchParams.get('secret')).not.toBe(b.searchParams.get('secret'))
  })

  it('refuses a bad relay before any QR is drawn', () => {
    expect(() => createNostrConnectSession('https://relay.example.com')).toThrow(/wss:\/\//)
    expect(() => createNostrConnectSession('ws://relay.example.com')).toThrow(/localhost/)
  })
})

describe('Nostr Connect relays', () => {
  it('allows unencrypted ws:// only on this machine', () => {
    expect(normalizeSignerRelay('ws://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777')
    expect(() => normalizeSignerRelay('ws://relay.example.com')).toThrow(/localhost/)
  })

  it('puts a backup relay in the default QR, and only the chosen one otherwise', () => {
    expect(signerRelays(DEFAULT_SIGNER_RELAY)).toEqual([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
    expect(signerRelays('wss://my.relay')).toEqual(['wss://my.relay'])
    const relays = new URL(createNostrConnectSession().uri).searchParams.getAll('relay')
    expect(relays).toEqual([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
    const own = createNostrConnectSession('wss://my.relay/')
    expect(own.relay).toBe('wss://my.relay')
    expect(new URL(own.uri).searchParams.getAll('relay')).toEqual(['wss://my.relay'])
  })
})
