/**
 * shardMeshGlow.test.ts - how ShardMesh mounts what shardDraws plans (a scan
 * of its JSX, since these tests run without WebGL; the plan itself is tested
 * in pointGlow.test.ts):
 *
 *  - at 0% nothing of the object's own is mounted visibly (faces, lines,
 *    points, cores), and the glow is mounted whatever the opacity;
 *  - unseen hit targets keep a placed object and a 0% face tappable;
 *  - in POINTS mode face colours are not expanded, so each vertex is one
 *    point and one halo at its own colour;
 *  - halos sit inside the object's motion group, so `anim` carries them.
 */

import { describe, expect, it } from 'vitest'
import SOURCE from './ShardMesh.tsx?raw'

const jsx = SOURCE.slice(SOURCE.indexOf('  return (\n    <group scale={scale}>'))

/** The JSX expression that mounts the element named `name` (from its `{` to its line's end). */
function mount(name: string): string {
  const at = jsx.indexOf(name)
  expect(at).toBeGreaterThan(-1)
  const start = jsx.lastIndexOf('\n', at)
  return jsx.slice(start, jsx.indexOf('\n', at))
}

describe('ShardMesh at 0%', () => {
  it('mounts no faces, lines, points or cores of its own', () => {
    expect(mount('name="shard-faces"').length).toBeGreaterThan(0)
    expect(jsx).toMatch(/\{own && shard\.mode === 'solid' && index\.length > 0 && \(/)
    expect(jsx).toMatch(/\{own && shard\.mode === 'lines' && outline && \(/)
    expect(jsx).toMatch(/\{own && shard\.mode === 'lines' && !outline/)
    expect(jsx).toMatch(/\{own && \(shard\.mode === 'points' \|\| shard\.mode === 'solid' \|\| shard\.mode === 'lines'\) && draws\.defaultPoints && \(/)
    expect(mount('name="shard-point-cores"')).toMatch(/\{own && cores &&/)
  })

  it('mounts the glow whatever the opacity', () => {
    const glow = mount('name="shard-glow"')
    expect(glow).toMatch(/\{halo && haloMaterial &&/)
    expect(glow).not.toMatch(/own/)
  })

  it('writes no depth from anything left at 0%: the hit targets are unseen and the faint dots are the disc, which writes none', () => {
    expect(mount('name="shard-hit-points"')).toContain('visible={false}')
    expect(mount('name="shard-hit-faces"')).toContain('visible={false}')
    expect(mount('name="shard-faint"')).toContain('draws.faint')
  })
})

describe('what a tap meets', () => {
  it('unseen points whenever the default disc is not drawn, and unseen faces at 0% that carry the face map', () => {
    expect(mount('name="shard-hit-points"')).toMatch(/\{draws\.hitPoints &&/)
    const faces = mount('name="shard-hit-faces"')
    expect(faces).toMatch(/\{draws\.hitFaces &&/)
    expect(faces).toContain('{...pick}')
  })

  it('never the quads, whose geometry sits at the origin', () => {
    expect(mount('name="shard-point-cores"')).toContain('raycast={noRaycast}')
    expect(mount('name="shard-glow"')).toContain('raycast={noRaycast}')
  })

  it('passes the workshop flag to placed objects, so a 0% part is found too', () => {
    expect(SOURCE).toMatch(/<ShardMesh shard=\{model\}[^>]*editing=\{editing\}/)
  })
})

describe('with motion (DECK-0003 §1.14)', () => {
  it('draws the halos and cores inside the object\'s motion group, so they move exactly as its points do', () => {
    const open = jsx.indexOf('{motion(<>')
    const close = jsx.indexOf('</>)}')
    expect(open).toBeGreaterThan(-1)
    for (const name of ['name="shard-glow"', 'name="shard-point-cores"', 'name="shard-hit-points"']) {
      const at = jsx.indexOf(name)
      expect(at).toBeGreaterThan(open)
      expect(at).toBeLessThan(close)
    }
  })
})

describe('POINTS mode and face colours', () => {
  it('draws each vertex once at its own colour: no face colour expansion', () => {
    expect(SOURCE).toContain("given.mode === 'points' ? given : expandFaceColors(given)")
  })
})
