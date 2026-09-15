/**
 * ProfilePic.tsx - a pubkey as a face.
 *
 * The kind:0 picture when there is one, and when there is not, the key's own
 * color with an initial on it. The fallback is not a placeholder waiting to be
 * replaced: most keys have no profile and never will, and two objects by two
 * strangers still have to look like two different people.
 *
 * A picture is a URL somebody else controls, so a broken one falls back rather
 * than leaving a hole, and no referrer goes out with the request.
 */

import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { keyColor } from '../lib/keyColor'
import { useProfiles } from '../store/useProfiles'

export function ProfilePic({ pubkey, size = 28 }: { pubkey: string; size?: number }): JSX.Element {
  const profile = useProfiles((s) => s.profiles[pubkey])
  useEffect(() => { useProfiles.getState().request(pubkey) }, [pubkey])
  const [broken, setBroken] = useState(false)
  // A fresh picture deserves a fresh attempt, even if the last one failed.
  useEffect(() => setBroken(false), [profile?.picture])

  let npub: string | null = null
  try { npub = nip19.npubEncode(pubkey) } catch { /* not a 32-byte key */ }
  const title = profile?.name ?? npub ?? pubkey
  const style = { width: size, height: size, minWidth: size } as const

  if (profile?.picture && !broken) {
    return (
      <img
        className="pfp"
        style={style}
        src={profile.picture}
        alt=""
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    )
  }
  const initial = (profile?.name ?? npub?.slice(5) ?? pubkey).slice(0, 1).toUpperCase()
  return (
    <span className="pfp pfp--fallback" style={{ ...style, background: keyColor(pubkey), fontSize: size * 0.45 }} title={title}>
      {initial}
    </span>
  )
}
