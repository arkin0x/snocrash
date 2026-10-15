/**
 * loginCancel.test.ts - a way in that is given up stays given up (review of
 * parity #35). The key modal's ✕ while WORKING, or a later choice, drops the
 * attempt: whatever it brings back afterwards, an identity or an error,
 * changes nothing. ONOSENDAI gives up its QR flow the same way (stopQr).
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { useNostr } from './useNostr'
import LOGIN from '../ui/LoginModal.tsx?raw'

const n = () => useNostr.getState()
const fresh = (): { nsec: string; pubkey: string } => {
  const sk = generateSecretKey()
  return { nsec: nip19.nsecEncode(sk), pubkey: getPublicKey(sk) }
}

describe('giving up a way in', () => {
  beforeEach(() => {
    n().useNewKey()
    useNostr.setState({ loginError: null, loggingIn: false })
  })

  it('a key that arrives after the attempt was given up changes nothing', async () => {
    const before = n().pubkey
    const pending = n().useNsec(fresh().nsec)
    expect(n().loggingIn).toBe(true)
    n().cancelLogin()
    expect(n().loggingIn).toBe(false)
    await pending
    expect(n().pubkey).toBe(before)
    expect(n().loggingIn).toBe(false)
  })

  it('an error that arrives after the attempt was given up does not linger', async () => {
    const pending = n().useNsec('not a key')
    n().cancelLogin()
    await pending
    expect(n().loginError).toBeNull()
  })

  it('an attempt not given up still takes, and says when it is done', async () => {
    const next = fresh()
    await n().useNsec(next.nsec)
    expect(n().pubkey).toBe(next.pubkey)
    expect(n().loggingIn).toBe(false)
  })

  it('a later attempt overtakes an earlier one, and a new key overtakes both', async () => {
    const a = fresh(), b = fresh()
    const first = n().useNsec(a.nsec)
    const second = n().useNsec(b.nsec)
    await Promise.all([first, second])
    expect(n().pubkey).toBe(b.pubkey)
    const late = n().useNsec(a.nsec)
    n().useNewKey()
    const made = n().pubkey
    await late
    expect(n().pubkey).toBe(made)
  })

  it("the modal's ✕ gives up a WORKING attempt, and a given-up run closes nothing more", () => {
    expect(LOGIN).toMatch(/onClick=\{close\} aria-label="Close"/)
    expect(LOGIN).toMatch(/if \(busy !== null\) \{ gaveUp\.current = true; useNostr\.getState\(\)\.cancelLogin\(\) \}/)
    expect(LOGIN).toMatch(/if \(!gaveUp\.current && !useNostr\.getState\(\)\.loginError\) onClose\(\)/)
  })
})
