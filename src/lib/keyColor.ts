/**
 * keyColor.ts - a pubkey's own color.
 *
 * Every list that shows people needs to tell them apart before their profiles
 * arrive, and often no profile ever arrives. The hue comes from the first byte
 * of the key, so the same identity is the same color everywhere, every time,
 * without asking a relay for a picture. It is a swatch, not a portrait, and
 * nothing anywhere should read meaning into which color a key got.
 */
export function keyColor(pubkey: string): string {
  const hue = (parseInt(pubkey.slice(0, 2), 16) || 0) * 360 / 256
  return `hsl(${hue.toFixed(0)}, 70%, 55%)`
}
