import { describe, expect, it } from 'vitest'
import { DEFAULT_AXES, nudgeFor, nudgeLabel, planeAfter, publishedFrame } from './benchAxes'

describe('benchAxes', () => {
  it('turns screen directions into model moves, with Z mirrored as the bench draws it', () => {
    expect(nudgeFor(DEFAULT_AXES, 'right')).toEqual({ axis: 0, delta: 1 })
    expect(nudgeFor(DEFAULT_AXES, 'left')).toEqual({ axis: 0, delta: -1 })
    expect(nudgeFor(DEFAULT_AXES, 'up')).toEqual({ axis: 1, delta: 1 })
    expect(nudgeFor(DEFAULT_AXES, 'down')).toEqual({ axis: 1, delta: -1 })
    // Toward the viewer is render +Z, which is model -Z; away is model +Z, where cyberspace +Z points.
    expect(nudgeFor(DEFAULT_AXES, 'toward')).toEqual({ axis: 2, delta: -1 })
    expect(nudgeFor(DEFAULT_AXES, 'away')).toEqual({ axis: 2, delta: 1 })
  })

  it('names the axes the way the published file does, not the way the model stores them', () => {
    // The model's axes are ONOSENDAI's, where +Z is away from the viewer. This
    // app publishes into the glTF frame, where +Z comes toward the viewer, and
    // that is the frame every tool that opens one of these objects reads. So
    // what is printed under the arrows is the model's Z turned around, which is
    // the same turn the wire and the scene already make. Nothing moves; only
    // the name changes.
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'away'))).toBe('−Z')
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'toward'))).toBe('+Z')
    // X and Y are the same in both frames and must be left alone.
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'right'))).toBe('+X')
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'left'))).toBe('−X')
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'up'))).toBe('+Y')
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'down'))).toBe('−Y')
  })

  it('reads a position out in that same frame', () => {
    expect(publishedFrame([3, 4, 5])).toEqual([3, 4, -5])
    // A zero stays a zero: negating one gives −0, which keys and equality
    // tests treat as a different number.
    expect(Object.is(publishedFrame([0, 0, 0])[2], 0)).toBe(true)
  })
})

describe('planeAfter', () => {
  const top = { right: { axis: 0, dir: 1 }, up: { axis: 2, dir: -1 }, out: { axis: 1, dir: 1 } } as const
  it('tips the floor up to face the viewer and rolls it to face the side', () => {
    expect(planeAfter(1, DEFAULT_AXES, 'tip')).toBe(2)
    expect(planeAfter(1, DEFAULT_AXES, 'roll')).toBe(0)
    expect(planeAfter(2, DEFAULT_AXES, 'tip')).toBe(1)
    expect(planeAfter(0, DEFAULT_AXES, 'roll')).toBe(1)
  })
  it('falls back to the screen vertical when the turn would be about the normal', () => {
    // From straight above the line of sight is Y, the floor's own normal.
    expect(planeAfter(1, top, 'roll')).toBe(0)
    expect(planeAfter(1, top, 'tip')).toBe(2)
  })
})
