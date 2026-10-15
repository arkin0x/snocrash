/**
 * loginModal.test.ts - the identity modal is ONOSENDAI's (#196), read from
 * its source as the workshop tests read theirs: one login field, the QR
 * drawn by a `qrcode` loaded only when a QR is shown, a QR wait given up
 * whenever its screen goes, and a warning before leaving a key that lives
 * only here. snocrash has no movement chain, so none of ONOSENDAI's chain
 * or spawn wording comes with it.
 */

import { describe, expect, it } from 'vitest'
import LOGIN from './LoginModal.tsx?raw'
import SIGNERS from '../lib/signers.ts?raw'
import CREDENTIALS from '../lib/loginCredentials.ts?raw'

const sources = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('the identity modal', () => {
  it('says who you are: picture, name, kind of signer, npub', () => {
    expect(LOGIN).toMatch(/<ProfilePic pubkey=\{pubkey\} size=\{40\} \/>/)
    expect(LOGIN).toMatch(/KIND_LABEL\[kind\]/)
    expect(LOGIN).toMatch(/className="secret__npub"/)
  })

  it('has one login field for an nsec, an ncryptsec (with its password) or a bunker:// URI', () => {
    expect(LOGIN).toMatch(/useNostr\.getState\(\)\.useLogin\(credential, password\)/)
    expect(LOGIN).toMatch(/const encrypted = credentialKind === 'ncryptsec'/)
    expect(LOGIN).not.toMatch(/useBunker\(|useNsec\(|useNcryptsec\(/)
  })

  it('warns before leaving a key that lives only on this device, and only then', () => {
    expect(LOGIN).toMatch(/const local = signedIn && kind === 'local'/)
    expect(LOGIN).toMatch(/\{local && \(\s*<p className="login__note login__note--warn">\s*This key lives only on this device/)
  })

  it('carries none of ONOSENDAI\'s chain or spawn wording', () => {
    expect(LOGIN).not.toMatch(/spawn|chain|signs nothing/i)
  })

  it('loads qrcode with the first QR it draws, and nothing in the app imports it up front', () => {
    expect(LOGIN).toMatch(/import\('qrcode'\)/)
    for (const [path, source] of Object.entries(sources)) {
      expect(source, path).not.toMatch(/from 'qrcode'/)
    }
  })

  it('gives the QR wait up when its screen goes: back, ✕, a new relay, or the modal unmounting', () => {
    expect(LOGIN).toMatch(/const stopQr = \(\): void => \{\s*if \(qrLive\.current\) \{ qrLive\.current = null; useNostr\.getState\(\)\.cancelLogin\(\) \}/)
    expect(LOGIN).toMatch(/const backToLogin = \(\): void => \{\s*stopQr\(\)/)
    expect(LOGIN).toMatch(/const startQr = [^]*?stopQr\(\)/)
    expect(LOGIN).toMatch(/return \(\) => \{[^]*?if \(qrLive\.current\) \{ qrLive\.current = null; useNostr\.getState\(\)\.cancelLogin\(\) \}/)
    // A wait that is no longer the live one closes nothing and paints nothing.
    expect(LOGIN).toMatch(/if \(qrLive\.current !== mine\) return/)
  })

  it('offers the QR link to copy and to open, and a relay of your own', () => {
    expect(LOGIN).toMatch(/navigator\.clipboard\.writeText\(qrUri\)/)
    expect(LOGIN).toMatch(/<a className="login__qr-link" href=\{qrUri\}/)
    expect(LOGIN).toMatch(/normalizeSignerRelay\(relay\) === activeRelay/)
  })

  it('a mistyped relay is refused before the QR on screen is given up, and is shown where it can be put right (review of #37)', () => {
    // Nothing stops the live wait until a session on the new relay exists.
    expect(LOGIN).toMatch(/const startQr = (?:(?!stopQr\(\))[^])*?createNostrConnectSession\(relayInput\)/)
    expect(LOGIN).toMatch(/setQrError\(err instanceof Error \? err\.message : String\(err\)\)\s*setView\('qr'\)\s*return/)
  })

  it('a QR its relay stopped can be tried again on the same relay', () => {
    expect(LOGIN).toMatch(/disabled=\{!relay\.trim\(\) \|\| \(busy === 'qr' && sameRelay\)\}/)
    expect(LOGIN).toMatch(/busy !== 'qr' && sameRelay \? 'TRY AGAIN' : 'USE THIS RELAY'/)
  })

  it('a tap outside closes it as ✕ does', () => {
    expect(LOGIN).toMatch(/aria-label="Change identity" onPointerDown=\{close\}/)
    expect(LOGIN).toMatch(/onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  })
})

describe('house style', () => {
  it('no em dashes in the ported files', () => {
    for (const source of [LOGIN, SIGNERS, CREDENTIALS]) expect(source).not.toContain('—')
  })
})
