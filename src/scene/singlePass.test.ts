import { describe, expect, it } from 'vitest'

/**
 * Every transparent DoubleSide material sets forceSinglePass (ported from
 * ONOSENDAI, 2026-10-15).
 *
 * Without it three draws the material twice a frame, back then front, and
 * flips `side` with `needsUpdate = true` around each pass, so every such
 * object costs two shader program lookups a frame that allocate. In
 * ONOSENDAI that was ~106 KB of garbage a frame with ~150 shards, about a
 * gigabyte a minute at a 144 Hz desktop refresh. A material that deliberately
 * keeps the two passes says so with `forceSinglePass={...}` (a condition) or
 * a `two passes:` comment.
 */
const sources = import.meta.glob(['../scene/**/*.tsx', '../scene/**/*.ts', '../ui/**/*.tsx', '../ui/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('transparent DoubleSide materials draw in one pass', () => {
  it('reads the scene and ui sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5)
  })

  it('every one sets forceSinglePass', () => {
    const offenders: string[] = []
    for (const [f, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/side(=\{[^}]*|:\s*)DoubleSide/g)) {
        // The material's own declaration: a JSX element (from its "<" to its
        // close) or an object literal (from its "({" to its "})").
        const at = m.index ?? 0
        const open = Math.max(src.lastIndexOf('<', at), src.lastIndexOf('({', at))
        const closes = [src.indexOf('/>', at), src.indexOf('})', at)].filter((x) => x >= 0)
        const decl = src.slice(open, Math.min(...closes) + 2)
        if (!/transparent/.test(decl)) continue
        if (/forceSinglePass|two passes:/.test(decl)) continue
        offenders.push(`${f}:${src.slice(0, at).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
