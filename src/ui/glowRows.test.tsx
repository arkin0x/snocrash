/**
 * The four rows under DRAW and OPACITY (owner, 2026-11-15): POINT SIZE, GLOW
 * (OFF, LIGHT, FOG), RADIUS and GLOW STRENGTH, always there, greyed unless
 * MODE is POINTS, RADIUS and GLOW STRENGTH greyed while GLOW is OFF.
 */

import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { renderToStaticMarkup } from 'react-dom/server'
import { newShard, type ShardModel } from 'sno-core/shards'
import { GlowRows } from './GlowRows'
import ROWS from './GlowRows.tsx?raw'
import WORKSHOP from './Workshop.tsx?raw'

const shard = (over: Partial<ShardModel>): ShardModel => ({ ...newShard('Forest'), vertices: [{ p: [0, 0, 0], c: [0.9, 0.9, 0.5] }], ...over })
const html = (s: ShardModel): string => renderToStaticMarkup(<GlowRows shard={s} inHand={[0, 0.9, 1]} />)

/** The markup of one row, by its label. */
function row(markup: string, label: string): string {
  const at = markup.indexOf(`>${label}</span>`)
  expect(at).toBeGreaterThan(-1)
  const start = markup.lastIndexOf('<div class="workshop__row', at)
  const end = markup.indexOf('<div class="workshop__row', at)
  return markup.slice(start, end < 0 ? undefined : end)
}
const disabledCount = (m: string): number => (m.match(/disabled=""/g) ?? []).length

describe('the glow rows', () => {
  it('are four rows in order, in every mode, with the same markup shape', () => {
    for (const mode of ['points', 'solid', 'lines'] as const) {
      const m = html(shard({ mode }))
      const order = ['POINT SIZE', 'GLOW', 'RADIUS', 'GLOW STRENGTH'].map((l) => m.indexOf(`>${l}</span>`))
      expect(order.every((i) => i > -1)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(m).toContain('POINTS only.')
    }
  })

  it('are all greyed, keeping their values, unless MODE is POINTS', () => {
    for (const mode of ['solid', 'lines'] as const) {
      const m = html(shard({ mode, extra: { pointsize: 48, glow: ['fog', 240, 35] } }))
      for (const l of ['POINT SIZE', 'GLOW', 'RADIUS', 'GLOW STRENGTH']) {
        const r = row(m, l)
        expect(r).toContain('is-dim')
        expect(r).not.toMatch(/<(button|input)(?![^>]*disabled="")/)
      }
      expect(row(m, 'POINT SIZE')).toContain('2/5')
      expect(row(m, 'RADIUS')).toContain('>2<')
      expect(row(m, 'GLOW STRENGTH')).toContain('35%')
    }
  })

  it('grey RADIUS and GLOW STRENGTH while GLOW is OFF, in POINTS', () => {
    const m = html(shard({ mode: 'points' }))
    expect(row(m, 'POINT SIZE')).not.toContain('is-dim')
    expect(row(m, 'GLOW')).not.toContain('is-dim')
    expect(disabledCount(row(m, 'GLOW'))).toBe(0)
    for (const l of ['RADIUS', 'GLOW STRENGTH']) {
      expect(row(m, l)).toContain('is-dim')
      expect(row(m, l)).not.toMatch(/<(button|input)(?![^>]*disabled="")/)
    }
  })

  it('are all live in POINTS with a glow', () => {
    const m = html(shard({ mode: 'points', extra: { glow: ['light', 120, 40] } }))
    for (const l of ['RADIUS', 'GLOW STRENGTH']) expect(row(m, l)).not.toContain('is-dim')
    expect(row(m, 'GLOW')).toMatch(/aria-pressed="true"[^>]*>(<svg[^]*?<\/svg>)?LIGHT/)
  })

  it('show OFF, LIGHT with lucide Sun and FOG with lucide CloudFog, and outline the suggested style while OFF', () => {
    const m = row(html(shard({ mode: 'points' })), 'GLOW')
    expect(m).toContain('>OFF<')
    expect(m).toContain('lucide-sun')
    expect(m).toContain('lucide-cloud-fog')
    // Bright points: LIGHT is the pre-pick.
    expect(m).toMatch(/is-suggested[^>]*>.*LIGHT/)
    const dark = row(html(shard({ mode: 'points', vertices: [{ p: [0, 0, 0], c: [0.1, 0.12, 0.1] }] })), 'GLOW')
    expect(dark).toMatch(/is-suggested[^>]*>(<svg[^]*?<\/svg>)FOG/)
  })

  it('show AUTO when the object sets no point size, and sliders for live preview', () => {
    const m = html(shard({ mode: 'points' }))
    expect(row(m, 'POINT SIZE')).toMatch(/aria-pressed="true"[^>]*>AUTO/)
    expect((m.match(/type="range"/g) ?? []).length).toBe(3)
  })

  it('stand right under OPACITY in MENU, and the setting is GLOW STRENGTH, never glow opacity', () => {
    const opacity = WORKSHOP.indexOf('aria-label="Opacity"')
    const rows = WORKSHOP.indexOf('<GlowRows')
    const constrain = WORKSHOP.indexOf('CONSTRAIN MOVEMENT IN WALK MODE')
    expect(opacity).toBeGreaterThan(-1)
    expect(rows).toBeGreaterThan(opacity)
    expect(constrain).toBeGreaterThan(rows)
    expect(`${ROWS}\n${WORKSHOP}`).not.toMatch(/glow opacity/i)
  })
})
