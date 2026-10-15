/**
 * LoginModal.tsx - choosing who signs, and taking your key with you.
 *
 * ONOSENDAI's identity door (hzrd149, ONOSENDAI #196), because the two
 * clients share their ways in: one field that takes an nsec, an encrypted
 * ncryptsec or a bunker:// URI, then a new random key, the browser extension,
 * or a Nostr Connect QR for a signer app on a phone. Nothing here is a login
 * in the usual sense. There is no account and no server that knows you: there
 * is a key, and whoever holds it is you.
 *
 * Which is why the backup is here and not an afterthought. A key made in a
 * browser and never written down is one cleared cache from gone, and
 * everything signed with it becomes unreachable, permanently, with nobody to
 * appeal to. The export is encrypted and the password is not optional
 * (lib/keyExport enforces that, not this file), so what leaves is safe to keep
 * anywhere.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nip19 } from 'nostr-tools'
import {
  createNostrConnectSession,
  DEFAULT_SIGNER_RELAY,
  hasNip07,
  loginCredentialKind,
  normalizeSignerRelay,
} from '../lib/signers'
import { MIN_PASSWORD, backupFileName, exportProblem } from '../lib/keyExport'
import { useNostr } from '../store/useNostr'
import { useProfiles } from '../store/useProfiles'
import { ProfilePic } from './ProfilePic'

const KIND_LABEL: Record<string, string> = {
  local: 'Local key',
  nip07: 'Browser extension',
  nip46: 'Remote signer',
}

type View = 'login' | 'qr'

export function LoginModal({ onClose }: { onClose: () => void }): JSX.Element {
  const signedIn = useNostr((s) => s.signedIn)
  const kind = useNostr((s) => s.signer)
  const pubkey = useNostr((s) => s.pubkey)
  const npub = useNostr((s) => s.npub())
  const loginError = useNostr((s) => s.loginError)
  const profile = useProfiles((s) => (pubkey ? s.profiles[pubkey] : undefined))

  const [view, setView] = useState<View>('login')
  const [credential, setCredential] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [relay, setRelay] = useState(DEFAULT_SIGNER_RELAY)
  const [activeRelay, setActiveRelay] = useState(DEFAULT_SIGNER_RELAY)
  const [qrUri, setQrUri] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrConnected, setQrConnected] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const qrCanvas = useRef<HTMLCanvasElement | null>(null)
  /** The QR wait in flight, if any: a token only that wait holds, so a stale one changes nothing. */
  const qrLive = useRef<object | null>(null)

  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [backup, setBackup] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)

  useEffect(() => {
    useNostr.getState().clearLoginError()
    return () => {
      // Gone with a QR still waiting: the wait goes too, so a signer that
      // answers later switches nothing (ONOSENDAI's unmount abort).
      if (qrLive.current) { qrLive.current = null; useNostr.getState().cancelLogin() }
      useNostr.getState().clearLoginError()
    }
  }, [])

  useEffect(() => {
    if (!qrUri || !qrCanvas.current) return
    // Loaded with the first QR it draws, not with the app (ONOSENDAI 4f510b6).
    void import('qrcode').then(({ default: QRCode }) => {
      if (!qrCanvas.current) return
      return QRCode.toCanvas(qrCanvas.current, qrUri, {
        errorCorrectionLevel: 'L',
        margin: 2,
        width: 264,
        color: { dark: '#05070d', light: '#f4fbff' },
      })
    }).catch(() => setQrError('Could not draw the QR code. Use COPY LINK instead.'))
  }, [qrUri])

  // Run a switch, then close if it took. A failed switch sets loginError and
  // changes nothing else, so the error is the whole verdict. One given up
  // (✕ while WORKING) closes nothing more: the modal is already gone, and
  // another may be open in its place.
  const gaveUp = useRef(false)
  const run = async (id: string, fn: () => Promise<void> | void): Promise<void> => {
    if (busy) return
    setBusy(id)
    useNostr.getState().clearLoginError()
    try {
      await fn()
      if (!gaveUp.current && !useNostr.getState().loginError) onClose()
    } finally { if (!gaveUp.current) setBusy(null) }
  }
  // ✕ while WORKING gives the attempt up, as ONOSENDAI's stopQr does: a
  // bunker or extension that answers later changes nothing (review of
  // parity #35). Escape leaves a WORKING modal alone (escape.ts).
  const close = (): void => {
    qrLive.current = null
    if (busy !== null) { gaveUp.current = true; useNostr.getState().cancelLogin() }
    onClose()
  }

  /** Give the QR wait up, if one is in flight. */
  const stopQr = (): void => {
    if (qrLive.current) { qrLive.current = null; useNostr.getState().cancelLogin() }
    setBusy(null)
  }

  const startQr = (relayInput = relay): void => {
    if (busy && busy !== 'qr') return
    // The relay is checked before the QR on screen is given up: a mistyped
    // one says so and leaves that QR waiting, rather than stopping it while
    // it still shows, for a signer to answer a session nobody hears (review
    // of #37).
    let session
    try { session = createNostrConnectSession(relayInput) }
    catch (err) {
      // Shown on the QR screen, where the relay can be put right (from the
      // first screen, a relay mistyped earlier would otherwise do nothing).
      setQrError(err instanceof Error ? err.message : String(err))
      setView('qr')
      return
    }
    stopQr()
    useNostr.getState().clearLoginError()
    setQrError(null)
    setQrConnected(false)
    setLinkCopied(false)

    const mine = {}
    qrLive.current = mine
    setRelay(session.relay)
    setActiveRelay(session.relay)
    setQrUri(session.uri)
    setView('qr')
    setBusy('qr')

    void useNostr.getState().useNostrConnect(session, () => {
      if (qrLive.current === mine) setQrConnected(true)
    }).then(() => {
      if (qrLive.current !== mine) return
      qrLive.current = null
      setBusy(null)
      if (!useNostr.getState().loginError) onClose()
    })
  }

  const backToLogin = (): void => {
    stopQr()
    useNostr.getState().clearLoginError()
    setQrError(null)
    setQrConnected(false)
    setQrUri(null)
    setView('login')
  }

  const credentialKind = loginCredentialKind(credential)
  const encrypted = credentialKind === 'ncryptsec'
  const extension = hasNip07()
  const disabled = busy !== null
  const credentialReady = !!credential.trim() && (!encrypted || !!password)
  const local = signedIn && kind === 'local'
  // A stopped QR (its relay dropped it) can be tried again on the same relay;
  // ONOSENDAI's button stays disabled then, leaving only the way back.
  const sameRelay = ((): boolean => {
    try { return normalizeSignerRelay(relay) === activeRelay } catch { return false }
  })()
  let shortNpub = ''
  try { shortNpub = pubkey ? nip19.npubEncode(pubkey) : '' } catch { /* not a key */ }
  shortNpub = shortNpub ? `${shortNpub.slice(0, 14)}…${shortNpub.slice(-8)}` : ''

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change identity" onPointerDown={close}>
      <div className="modal__card login" onPointerDown={(event) => event.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">{view === 'qr' ? 'Nostr Connect' : signedIn ? 'Change Identity' : 'Choose Identity'}</h2>
          <button className="chip ws__icon" onClick={close} aria-label="Close">✕</button>
        </div>

        {view === 'login' && (signedIn && pubkey ? (
          <div className="login__current">
            <ProfilePic pubkey={pubkey} size={40} />
            <div className="login__current-text">
              <span className="secret__name">{profile?.name ?? shortNpub}</span>
              <span className="login__kind">{KIND_LABEL[kind] ?? kind}</span>
              <span className="secret__npub" title={npub ?? ''}>{shortNpub}</span>
            </div>
          </div>
        ) : (
          <p className="login__note">
            There is no account here and no server that knows you. There is a key, and
            whoever holds it is you. Make one, or bring one you already have.
          </p>
        ))}

        {view === 'qr' ? (
          <div className="login__qr-flow">
            <p className="login__qr-instruction">Scan with a Nostr signer to connect this identity.</p>
            {qrUri && (
              <a className="login__qr-link" href={qrUri} aria-label="Open Nostr Connect signer">
                <canvas ref={qrCanvas} className="login__qr" width={264} height={264} />
              </a>
            )}
            <p className="login__waiting" role="status">
              {busy === 'qr' && <span className="spin" aria-hidden="true" />}
              {busy === 'qr'
                ? qrConnected ? 'SIGNER CONNECTED, FETCHING PUBLIC KEY…' : 'WAITING FOR SIGNER…'
                : 'CONNECTION STOPPED'}
            </p>
            {qrUri && (
              <button
                className="secret__act login__act"
                onClick={() => {
                  void navigator.clipboard.writeText(qrUri).then(
                    () => { setLinkCopied(true); setQrError(null) },
                    () => setQrError('The clipboard is not available here; tap the QR to open the link instead.'),
                  )
                }}
              >{linkCopied ? 'COPIED' : 'COPY LINK'}</button>
            )}

            {(qrError || loginError) && <p className="notice login__error">{qrError ?? loginError}</p>}

            <div className="login__relay">
              <label className="login__label" htmlFor="login-relay">Signer relay</label>
              <input
                id="login-relay"
                className="avatars__input login__input"
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={relay}
                onChange={(event) => setRelay(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') startQr(relay)
                }}
              />
              <button
                className="secret__act login__act"
                disabled={!relay.trim() || (busy === 'qr' && sameRelay)}
                onClick={() => startQr(relay)}
              >{busy !== 'qr' && sameRelay ? 'TRY AGAIN' : 'USE THIS RELAY'}</button>
            </div>

            <button className="login__back" onClick={backToLogin}>← OTHER LOGIN OPTIONS</button>
          </div>
        ) : (
          <>
            <form
              className="login__primary"
              onSubmit={(event) => { event.preventDefault(); void run('credential', () => useNostr.getState().useLogin(credential, password)) }}
            >
              <label className="login__label" htmlFor="login-credential">Nostr login</label>
              <input
                id="login-credential"
                className="avatars__input login__input"
                type="password"
                autoComplete="off"
                autoFocus
                spellCheck={false}
                placeholder="nsec1…  ncryptsec1…  bunker://…"
                value={credential}
                onChange={(event) => {
                  setCredential(event.target.value)
                  useNostr.getState().clearLoginError()
                }}
              />
              {encrypted && (
                <input
                  className="avatars__input login__input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="ncryptsec password"
                  aria-label="ncryptsec password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
              <button className="secret__act login__act login__act--primary" disabled={disabled || !credentialReady} type="submit">
                {busy === 'credential' && <span className="spin" aria-hidden="true" />}
                {busy === 'credential' ? 'LOGGING IN…' : 'LOG IN'}
              </button>
            </form>

            {loginError && <p className="notice login__error">{loginError}</p>}

            <div className="login__or"><span>OR</span></div>
            {local && (
              <p className="login__note login__note--warn">
                This key lives only on this device. Back it up below before switching away,
                or you cannot come back to this identity.
              </p>
            )}
            <div className="login__options">
              <button className="secret__act login__act" disabled={disabled} onClick={() => void run('new', () => useNostr.getState().useNewKey())}>
                {busy === 'new' ? 'CREATING…' : 'NEW RANDOM KEY'}
              </button>
              <button
                className="secret__act login__act"
                disabled={disabled || !extension}
                onClick={() => void run('nip07', () => useNostr.getState().useExtension())}
                title={extension ? '' : 'No NIP-07 extension detected'}
              >
                {busy === 'nip07' && <span className="spin" aria-hidden="true" />}
                {busy === 'nip07' ? 'CONNECTING…' : extension ? 'USE EXTENSION' : 'NO EXTENSION FOUND'}
              </button>
              <button className="secret__act login__act" disabled={disabled} onClick={() => startQr()}>
                LOGIN WITH QR CODE
              </button>
            </div>

            {/* Taking the key with you: only when this browser is the one holding it. */}
            {local && (
              <details className="login__backup-details">
                <summary>BACK UP CURRENT KEY</summary>
                {backup ? (
                  <>
                    <label className="login__label">Your key, encrypted. Keep it somewhere you will still have in ten years.</label>
                    <textarea className="login__backup" readOnly value={backup} rows={3} spellCheck={false} onFocus={(e) => e.currentTarget.select()} aria-label="Encrypted key" />
                    <div className="login__row">
                      <button className="secret__act login__act" onClick={() => {
                        void navigator.clipboard.writeText(backup).then(
                          () => setExportNote('Copied.'),
                          () => setExportNote('The clipboard is not available here; select the text instead.'),
                        )
                      }}>COPY</button>
                      <button className="secret__act login__act" onClick={() => {
                        const url = URL.createObjectURL(new Blob([backup + '\n'], { type: 'text/plain' }))
                        const a = document.createElement('a')
                        a.href = url
                        a.download = backupFileName(npub ?? '')
                        a.click()
                        URL.revokeObjectURL(url)
                      }}>SAVE FILE</button>
                    </div>
                    {exportNote && <p className="login__note">{exportNote}</p>}
                    <p className="login__note">
                      This is the whole of your identity. Anyone who has it and the password is you.
                      Nobody can reset it and nobody can send it back to you.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="login__label" htmlFor="login-pw1">Encryption password, at least {MIN_PASSWORD} characters</label>
                    <input id="login-pw1" className="avatars__input login__input" type="password" autoComplete="new-password" placeholder="password" value={pw1} onChange={(e) => { setPw1(e.target.value); setExportNote(null) }} />
                    <input className="avatars__input login__input" type="password" autoComplete="new-password" placeholder="repeat password" value={pw2} onChange={(e) => { setPw2(e.target.value); setExportNote(null) }} />
                    <button
                      className="secret__act login__act"
                      disabled={!pw1 || exportProblem(new Uint8Array(32), pw1, pw2) !== null}
                      onClick={() => {
                        try { setBackup(useNostr.getState().exportKey(pw1, pw2)); setExportNote(null) }
                        catch (err) { setExportNote(err instanceof Error ? err.message : String(err)) }
                      }}
                    >ENCRYPT BACKUP</button>
                    {exportNote && <p className="notice login__error">{exportNote}</p>}
                    <p className="login__note">
                      A key held only in this browser is one cleared cache from gone, and everything
                      it signed goes with it. The backup is encrypted, so it is safe to keep anywhere.
                    </p>
                  </>
                )}
              </details>
            )}

            {signedIn && (
              <div className="login__section">
                <button
                  className="secret__act login__act workshop__btn--danger"
                  disabled={disabled}
                  onClick={() => {
                    // Only a key held here can be lost by forgetting it. An
                    // extension or a bunker keeps its own, so disconnecting costs
                    // nothing and the warning would be a lie.
                    const warning = kind === 'local'
                      ? 'Forget the key this browser holds? Without a backup, it cannot come back.'
                      : 'Disconnect this signer? It keeps its own key, so you can connect it again.'
                    if (window.confirm(warning)) { useNostr.getState().signOut(); onClose() }
                  }}
                >{kind === 'local' ? 'SIGN OUT' : 'DISCONNECT'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
