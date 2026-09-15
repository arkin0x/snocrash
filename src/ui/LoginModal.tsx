/**
 * LoginModal.tsx - choosing who signs, and taking your key with you.
 *
 * The same four ways in that ONOSENDAI offers, because they are the four ways
 * nostr has: a key this app makes, an nsec, an encrypted ncryptsec, or a signer
 * that is not this app at all. Nothing here is a login in the usual sense. There
 * is no account and no server that knows you: there is a key, and whoever holds
 * it is you.
 *
 * Which is why EXPORT is here and not an afterthought. A key made in a browser
 * and never written down is one cleared cache from gone, and everything signed
 * with it becomes unreachable, permanently, with nobody to appeal to. The export
 * is encrypted and the password is not optional (lib/keyExport enforces that,
 * not this file), so what leaves is safe to keep anywhere.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hasNip07 } from '../lib/signers'
import { MIN_PASSWORD, backupFileName, exportProblem } from '../lib/keyExport'
import { useNostr } from '../store/useNostr'

const KIND_LABEL: Record<string, string> = {
  local: 'A key in this browser',
  nip07: 'Your browser extension',
  nip46: 'A remote bunker',
}

export function LoginModal({ onClose }: { onClose: () => void }): JSX.Element {
  const signedIn = useNostr((s) => s.signedIn)
  const kind = useNostr((s) => s.signer)
  const npub = useNostr((s) => s.npub())
  const loginError = useNostr((s) => s.loginError)

  const [key, setKey] = useState('')
  const [password, setPassword] = useState('')
  const [bunker, setBunker] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  // Taking this key with you. Closed by default: it is a thing you do once, and
  // an always-open password box invites typing a key into the wrong field.
  const [exportOpen, setExportOpen] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [backup, setBackup] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)

  useEffect(() => {
    useNostr.getState().clearLoginError()
    return () => useNostr.getState().clearLoginError()
  }, [])

  const encrypted = key.trim().startsWith('ncryptsec')
  const disabled = busy !== null

  // Run a switch, then close if it took. A failed switch sets loginError and
  // changes nothing else, so the error is the whole verdict.
  const run = async (id: string, fn: () => Promise<void> | void): Promise<void> => {
    setBusy(id)
    try {
      await fn()
      if (!useNostr.getState().loginError) onClose()
    } finally { setBusy(null) }
  }
  const label = (id: string, word: string): string => (busy === id ? 'WORKING' : word)

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Who signs">
      <div className="modal__card login">
        <div className="modal__head">
          <h2 className="modal__title">WHO SIGNS</h2>
          <button className="chip ws__icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {signedIn ? (
          <div className="login__current">
            <span className="login__kind">{KIND_LABEL[kind] ?? kind}</span>
            <span className="secret__npub" title={npub ?? ''}>{npub ? `${npub.slice(0, 16)}…${npub.slice(-6)}` : ''}</span>
          </div>
        ) : (
          <p className="login__note">
            There is no account here and no server that knows you. There is a key, and
            whoever holds it is you. Make one, or bring one you already have.
          </p>
        )}

        {loginError && <p className="notice login__error">{loginError}</p>}

        {/* Taking the key with you: only when this browser is the one holding it. */}
        {signedIn && kind === 'local' && (
          <div className="login__section">
            {!exportOpen ? (
              <button className="secret__act login__act" onClick={() => setExportOpen(true)}>EXPORT THIS KEY</button>
            ) : backup ? (
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
                  }}>SAVE A FILE</button>
                  <button className="secret__act login__act" onClick={() => { setBackup(null); setPw1(''); setPw2(''); setExportOpen(false); setExportNote(null) }}>DONE</button>
                </div>
                {exportNote && <p className="login__note">{exportNote}</p>}
                <p className="login__note">
                  This is the whole of your identity. Anyone who has it and the password is you.
                  Nobody can reset it and nobody can send it back to you.
                </p>
              </>
            ) : (
              <>
                <label className="login__label" htmlFor="sc-pw1">A password for the export, at least {MIN_PASSWORD} characters</label>
                <input id="sc-pw1" className="avatars__input login__input" type="password" autoComplete="new-password" placeholder="password" value={pw1} onChange={(e) => { setPw1(e.target.value); setExportNote(null) }} />
                <input className="avatars__input login__input" type="password" autoComplete="new-password" placeholder="the same password again" value={pw2} onChange={(e) => { setPw2(e.target.value); setExportNote(null) }} />
                <div className="login__row">
                  <button
                    className="secret__act login__act"
                    disabled={!pw1 || exportProblem(new Uint8Array(32), pw1, pw2) !== null}
                    onClick={() => {
                      try { setBackup(useNostr.getState().exportKey(pw1, pw2)); setExportNote(null) }
                      catch (err) { setExportNote(err instanceof Error ? err.message : String(err)) }
                    }}
                  >ENCRYPT IT</button>
                  <button className="secret__act login__act" onClick={() => { setExportOpen(false); setPw1(''); setPw2(''); setExportNote(null) }}>CANCEL</button>
                </div>
                {exportNote && <p className="notice login__error">{exportNote}</p>}
                <p className="login__note">
                  A key held only in this browser is one cleared cache from gone, and everything
                  it signed goes with it. The export is encrypted, so it is safe to keep anywhere.
                </p>
              </>
            )}
          </div>
        )}

        <div className="login__section">
          <label className="login__label" htmlFor="sc-key">Bring a key: an nsec, or an encrypted ncryptsec</label>
          <input
            id="sc-key"
            className="avatars__input login__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="nsec1… or ncryptsec1…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {encrypted && (
            <input
              className="avatars__input login__input"
              type="password"
              autoComplete="off"
              placeholder="ncryptsec password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <button
            className="secret__act login__act"
            disabled={disabled || !key.trim() || (encrypted && !password)}
            onClick={() => void run('key', () => (encrypted
              ? useNostr.getState().useNcryptsec(key, password)
              : useNostr.getState().useNsec(key)))}
          >{label('key', 'USE THIS KEY')}</button>
        </div>

        <div className="login__section">
          <label className="login__label" htmlFor="sc-bunker">Connect a remote bunker (NIP-46)</label>
          <input
            id="sc-bunker"
            className="avatars__input login__input"
            autoComplete="off"
            spellCheck={false}
            placeholder="bunker://…"
            value={bunker}
            onChange={(e) => setBunker(e.target.value)}
          />
          <button
            className="secret__act login__act"
            disabled={disabled || !bunker.trim()}
            onClick={() => void run('bunker', () => useNostr.getState().useBunker(bunker))}
          >{label('bunker', 'CONNECT')}</button>
        </div>

        <div className="login__section login__row">
          <button
            className="secret__act login__act"
            disabled={disabled || !hasNip07()}
            title={hasNip07() ? 'Sign with your browser extension' : 'No nostr extension found in this browser'}
            onClick={() => void run('nip07', () => useNostr.getState().useExtension())}
          >{label('nip07', 'USE MY EXTENSION')}</button>
          <button
            className="secret__act login__act"
            disabled={disabled}
            onClick={() => void run('new', () => useNostr.getState().useNewKey())}
          >{label('new', 'MAKE A NEW KEY')}</button>
          {signedIn && kind === 'local' && (
            <button
              className="secret__act login__act workshop__btn--danger"
              disabled={disabled}
              onClick={() => { if (window.confirm('Forget the key this browser holds? Without an export, it cannot come back.')) { useNostr.getState().signOut(); onClose() } }}
            >SIGN OUT</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
