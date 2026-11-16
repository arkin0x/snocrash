/**
 * FACING (DECK-0003 §1.18): PATH and UPRIGHT under the avatar eye in MENU,
 * the one that reads as on lit, and a press writing through setFace.
 */

import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { FacingRow } from './FacingRow'
import { useWorkshop } from '../store/useWorkshop'
import ROW from './FacingRow.tsx?raw'
import WORKSHOP from './Workshop.tsx?raw'

const shard = (extra?: Record<string, unknown>): ShardModel => ({ ...newShard('Avatar'), ...(extra ? { extra } : {}) })
const html = (s: ShardModel): string => renderToStaticMarkup(<FacingRow shard={s} />)

/** The `<button>` whose text is `label`, as `<FacingRow>` returns it (no DOM needed). */
function button(label: string, s: ShardModel): ReactElement<{ onClick: () => void }> {
  const found: ReactElement[] = []
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (!isValidElement(n)) return
    const props = n.props as { children?: ReactNode }
    if (n.type === 'button' && props.children === label) found.push(n)
    walk(props.children)
  }
  walk(FacingRow({ shard: s }))
  expect(found).toHaveLength(1)
  return found[0] as ReactElement<{ onClick: () => void }>
}

const lit = (m: string): string[] => [...m.matchAll(/class="workshop__mode is-on"[^>]*>([A-Z]+)</g)].map((x) => x[1])

afterEach(() => { vi.restoreAllMocks() })

describe('the FACING row', () => {
  it('is a label, PATH and UPRIGHT, and a short grey hint', () => {
    const m = html(shard())
    expect(m).toContain('>FACING</span>')
    expect(m.indexOf('>PATH<')).toBeLessThan(m.indexOf('>UPRIGHT<'))
    expect(m).toContain('class="ui-field__hint ws__facing-hint">How it turns as it moves when worn.</span>')
  })

  it('lights PATH for no field, "path", an unknown name and a non-string; UPRIGHT only for "upright"', () => {
    expect(lit(html(shard()))).toEqual(['PATH'])
    expect(lit(html(shard({ face: 'path' })))).toEqual(['PATH'])
    expect(lit(html(shard({ face: 'spin' })))).toEqual(['PATH'])
    expect(lit(html(shard({ face: 7 })))).toEqual(['PATH'])
    expect(lit(html(shard({ face: 'upright' })))).toEqual(['UPRIGHT'])
    expect(html(shard({ face: 'upright' }))).toContain('aria-pressed="true" title="Stays upright')
  })

  it('a press calls setFace with its mode', () => {
    const setFace = vi.fn()
    vi.spyOn(useWorkshop, 'getState').mockReturnValue({ ...useWorkshop.getState(), setFace })
    button('UPRIGHT', shard()).props.onClick()
    button('PATH', shard({ face: 'upright' })).props.onClick()
    expect(setFace.mock.calls).toEqual([['upright'], ['path']])
  })

  it('stands right after the avatar eye switch in the workshop panel', () => {
    const eye = WORKSHOP.indexOf('id="ws-eye"')
    const row = WORKSHOP.indexOf('<FacingRow shard={shard} />')
    expect(eye).toBeGreaterThan(-1)
    expect(row).toBeGreaterThan(eye)
    expect(WORKSHOP.slice(eye, row)).not.toContain('<div className="workshop__row">')
  })

  it('copy has no em dashes', () => {
    expect(ROW).not.toContain('\u2014')
  })
})
