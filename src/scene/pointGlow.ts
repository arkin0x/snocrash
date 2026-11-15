/**
 * pointGlow.ts - point size and glow in POINTS mode (DECK-0003 §1.15 and
 * §1.16, owner rulings 2026-11-15), ported to snocrash from the points glow
 * study's prototype (points-glow-proto/src/halos.js).
 *
 * Both draw as instanced quads that face the camera, one per point, never as
 * GL points: a GPU caps gl_PointSize (Apple GPUs at 64 device pixels), and a
 * point or a halo sized in ticks of the object's lattice can be far larger
 * than that on screen.
 *
 *  - The core is the point itself, `pointsize` ticks across, scaled exactly as
 *    the vertices are (the object's unit and a placement's scale step both
 *    reach it through the model-view matrix), with perspective, never under
 *    POINT_MIN_PX on screen, at the object's opacity.
 *  - The halo is the glow around it, in the point's own colour, `radius`
 *    ticks from the point's centre, as strong as GLOW STRENGTH says at the
 *    centre and fading to nothing at the radius. The object's opacity never
 *    reaches it (ruling 5): an object at 0% casts its glow without a point.
 *
 * LIGHT and FOG share one premultiplied blend (ONE, ONE_MINUS_SRC_ALPHA). A
 * halo writes its colour times its alpha, and an alpha of 0 for LIGHT, which
 * adds and never darkens, or its alpha for FOG, which lays the colour over
 * what is behind it. Halos test depth against faces, so a wall hides a glow
 * behind it, and write none, so they never hide each other. One pass: the
 * quads are FrontSide (singlePass.test.ts).
 *
 * snocrash has no bloom, so the halo is the whole glow. It has no clipping
 * planes either: a shard cut to its region (ShardMesh `clip`) loses the
 * points outside the walls on the CPU, and their halos go with them.
 */

import {
  AddEquation,
  CustomBlending,
  DataTexture,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
} from 'three'
import { TICKS_PER_UNIT, type ShardModel } from 'sno-core/shards'
import { drawnGlow, drawnPointSize, type Glow } from 'sno-core/glow'

/** How many halos one object draws at most. Past it, an even spread of its points glows and the rest draw without. */
export const HALO_CAP = 4096

/** The largest halo on screen: its radius never passes this share of the canvas height. */
export const HALO_MAX_SCREEN = 0.35

/** The smallest point on screen, in CSS pixels, so a far one is dust and not nothing. */
export const POINT_MIN_PX = 1.5

/** The largest point on screen, as a share of the canvas height. */
export const POINT_MAX_SCREEN = 0.5

/** How much brighter a core's centre is than its colour, as the default points are (pointDisc SHARD_POINTS). */
export const CORE_SHINE = 1.1

/**
 * Where halos draw: after see-through faces (TRANSLUCENT_ORDER and the
 * bench's front at 1.5) and before the points (DOTS_ORDER), so a point sits
 * on top of its own halo. Kept here, beside shardFaces' list of orders.
 */
export const HALO_ORDER = 1.7

/** A tick distance as model units, the units the shard's positions are drawn in (sno-core toRender). */
export function ticksToModel(ticks: number): number {
  return ticks / TICKS_PER_UNIT
}

/**
 * Which points carry a halo: every one up to `cap`, else `cap` of them spread
 * evenly through the vertex order.
 */
export function haloPicks(count: number, cap = HALO_CAP): Uint32Array {
  const n = Math.max(0, Math.min(count, cap))
  const out = new Uint32Array(n)
  for (let i = 0; i < n; i++) out[i] = count <= cap ? i : Math.floor((i * count) / n)
  return out
}

/** Copy the picked points' positions and colours into the halo buffers. */
export function fillPicked(src: ArrayLike<number>, picks: Uint32Array, out: Float32Array): void {
  for (let i = 0; i < picks.length; i++) {
    const k = picks[i] * 3
    out[i * 3] = src[k]
    out[i * 3 + 1] = src[k + 1]
    out[i * 3 + 2] = src[k + 2]
  }
}

/**
 * What a halo is drawn with, from the glow alone: the object's opacity is not
 * an argument, because it never reaches the glow (ruling 5). A ghost (a
 * preview that is not yet real) dims it, as it dims everything it draws.
 */
export function haloLook(glow: Glow, ghost = false, ghostOpacity = 1): { radius: number; strength: number; light: number } {
  return {
    radius: ticksToModel(glow.radius),
    strength: (glow.strength / 100) * (ghost ? ghostOpacity : 1),
    light: glow.style === 'light' ? 1 : 0,
  }
}

/** What one shard draws of its points and glow, at the opacity ShardMesh worked out for it. */
export interface ShardDraws {
  /** Its faces, lines and points: anything at all of its own. False at opacity 0. */
  own: boolean
  /** The default disc points (pointDisc), in any mode, when POINTS mode sets no `pointsize`. */
  defaultPoints: boolean
  /** The points as quads this many model units across, in POINTS mode with a `pointsize` above 0; else null. */
  coreSize: number | null
  /** The glow, in POINTS mode with a `glow`, whatever the opacity; else null. */
  halo: { radius: number; strength: number; light: number } | null
}

/**
 * The plan ShardMesh draws by. `opacity` is the shard's own times a ghost's
 * (shardFaces shardOpacity). At 0 nothing of the shard's own is drawn and its
 * glow is, at full GLOW STRENGTH (owner, 2026-11-15). A placed object passes
 * its own model, never its parent's (§1.10).
 */
export function shardDraws(shard: Pick<ShardModel, 'mode' | 'extra'>, opacity: number, ghost = false, ghostOpacity = 1): ShardDraws {
  const own = opacity > 0
  const ticks = drawnPointSize(shard)
  const glow = drawnGlow(shard)
  return {
    own,
    defaultPoints: own && ticks === undefined,
    coreSize: own && ticks !== undefined && ticks > 0 ? ticksToModel(ticks) : null,
    halo: glow ? haloLook(glow, ghost, ghostOpacity) : null,
  }
}

const quadVertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iColor;

  uniform float uBufH;

  // The model-view's own scale: the object's unit and a placement's step.
  float modelScale() { return length(modelViewMatrix[0].xyz); }

  // Drawing-buffer pixels per view unit at a view depth.
  float pxPerUnit(float depth) { return uBufH * projectionMatrix[1][1] * 0.5 / max(depth, 0.0001); }
`

const haloVertex = /* glsl */ `
  ${quadVertex}
  uniform float uRadius;
  uniform float uMaxScreen;

  varying vec2 vQ;
  varying vec3 vColor;
  varying float vFade;
  varying float vSeed;

  void main() {
    vColor = iColor;
    vQ = position.xy;
    vSeed = fract(sin(dot(iPos, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float depth = -mv.z;
    float r = uRadius * modelScale();
    // A camera inside a halo would be painted over by the whole of it: it fades out instead.
    vFade = smoothstep(0.15 * r, 0.5 * r, depth);
    // The largest halo on screen.
    r = min(r, uMaxScreen * uBufH / pxPerUnit(depth));
    mv.xy += position.xy * r;
    gl_Position = vFade <= 0.001 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  }
`

const haloFragment = /* glsl */ `
  uniform float uStrength;
  uniform float uLight;
  uniform float uTime;
  uniform sampler2D uNoise;

  varying vec2 vQ;
  varying vec3 vColor;
  varying float vFade;
  varying float vSeed;

  const float FALLOFF = 3.0;
  const float NOISE = 0.55;

  void main() {
    float d2 = dot(vQ, vQ);
    if (d2 >= 1.0) discard;
    // A gaussian renormalised to reach exactly 0 at the radius and 1 at the centre.
    float fall = (exp(-FALLOFF * d2) - exp(-FALLOFF)) / (1.0 - exp(-FALLOFF));
    // A little noise drifting slowly inside the halo, none at its centre, so
    // the centre is exactly GLOW STRENGTH. Still while motion is reduced (uTime held).
    float a0 = vSeed * 6.2832;
    vec2 q = mat2(cos(a0), -sin(a0), sin(a0), cos(a0)) * vQ;
    vec2 flow = vec2(uTime * 0.013, uTime * 0.007);
    float n = texture2D(uNoise, q * 0.42 + vSeed * vec2(7.13, 3.71) + flow).r * 0.65
            + texture2D(uNoise, q * 0.97 - vSeed * vec2(2.9, 5.3) - flow * 1.7).r * 0.35;
    float density = fall * mix(1.0, smoothstep(0.18, 0.82, n) * 1.7, NOISE * sqrt(d2));
    float a = clamp(density * uStrength * vFade, 0.0, 1.0);
    if (a < 0.002) discard;
    // Premultiplied: LIGHT adds (alpha 0), FOG lays its colour over (alpha a).
    gl_FragColor = vec4(vColor * a, a * (1.0 - uLight));
  }
`

const coreVertex = /* glsl */ `
  ${quadVertex}
  uniform float uSize;
  uniform float uMinPx;
  uniform float uMaxScreen;
  uniform float uDpr;

  varying vec2 vQ;
  varying vec3 vColor;
  varying float vPx;

  void main() {
    vColor = iColor;
    vQ = position.xy;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float ppu = pxPerUnit(-mv.z);
    float r = uSize * 0.5 * modelScale();
    r = max(r, 0.5 * uMinPx * uDpr / ppu);
    r = min(r, 0.5 * uMaxScreen * uBufH / ppu);
    vPx = 2.0 * r * ppu;
    mv.xy += position.xy * r;
    gl_Position = projectionMatrix * mv;
  }
`

const coreFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uShine;

  varying vec2 vQ;
  varying vec3 vColor;
  varying float vPx;

  void main() {
    // The default points' disc (pointDisc.ts): solid to its rim, a couple of feathered pixels.
    float d = length(vQ);
    float edge = clamp(2.0 / max(vPx, 1.0), 0.04, 0.5);
    float alpha = (1.0 - smoothstep(1.0 - edge, 1.0, d)) * uOpacity;
    if (alpha < 0.02) discard;
    vec3 color = vColor * (1.0 + uShine * (1.0 - smoothstep(0.0, 0.8, d)));
    gl_FragColor = vec4(color, alpha);
  }
`

let noiseTex: DataTexture | null = null

/**
 * Tiling value noise, three octaves, baked once and shared: a texture tap is
 * cheaper than noise worked out per pixel on a phone's GPU.
 */
export function glowNoise(size = 64): DataTexture {
  if (noiseTex) return noiseTex
  const rand = (x: number, y: number, s: number): number => {
    const h = Math.sin((x % s) * 127.1 + (y % s) * 311.7 + s * 74.7) * 43758.5453
    return h - Math.floor(h)
  }
  const data = new Uint8Array(size * size * 4)
  const octaves: Array<[number, number]> = [[8, 0.55], [16, 0.3], [32, 0.15]]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      for (const [cells, weight] of octaves) {
        const fx = (x / size) * cells
        const fy = (y / size) * cells
        const ix = Math.floor(fx)
        const iy = Math.floor(fy)
        const tx = fx - ix
        const ty = fy - iy
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const a = rand(ix, iy, cells)
        const b = rand(ix + 1, iy, cells)
        const c = rand(ix, iy + 1, cells)
        const d = rand(ix + 1, iy + 1, cells)
        v += weight * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy)
      }
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255)
      data[i + 3] = 255
    }
  }
  const t = new DataTexture(data, size, size)
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return (noiseTex = t)
}

/** The premultiplied blend LIGHT and FOG share. */
export const HALO_BLEND = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
} as const

/** The halo material for one object's glow. */
export function createHaloMaterial(look: { radius: number; strength: number; light: number }): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    uniforms: {
      uRadius: { value: look.radius },
      uStrength: { value: look.strength },
      uLight: { value: look.light },
      uMaxScreen: { value: HALO_MAX_SCREEN },
      uBufH: { value: 1000 },
      uTime: { value: 0 },
      uNoise: { value: glowNoise() },
    },
    side: FrontSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    ...HALO_BLEND,
  })
}

/** The core material: the points at `size` model units across, at the object's opacity. */
export function createCoreMaterial(size: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: coreVertex,
    fragmentShader: coreFragment,
    uniforms: {
      uSize: { value: size },
      uOpacity: { value: opacity },
      uShine: { value: CORE_SHINE },
      uMinPx: { value: POINT_MIN_PX },
      uMaxScreen: { value: POINT_MAX_SCREEN },
      uDpr: { value: 1 },
      uBufH: { value: 1000 },
    },
    side: FrontSide,
    transparent: true,
    depthWrite: false,
  })
}

/** The two uniforms that follow the canvas rather than the material. */
export function sizeQuads(material: ShaderMaterial, dpr: number, cssHeight: number): void {
  material.uniforms.uBufH.value = cssHeight * dpr
  if (material.uniforms.uDpr) material.uniforms.uDpr.value = dpr
}

/**
 * One camera-facing quad per point: `positions` and `colors` three floats a
 * point. The arrays are used as they are, so a caller that writes into them
 * (the decode) marks the attributes for upload. The quad is its own, not
 * shared: disposing a geometry frees every buffer it holds.
 */
export function quadGeometry(positions: Float32Array, colors: Float32Array): InstancedBufferGeometry {
  const quad = new PlaneGeometry(2, 2)
  const g = new InstancedBufferGeometry()
  g.index = quad.index
  g.setAttribute('position', quad.getAttribute('position'))
  g.setAttribute('iPos', new InstancedBufferAttribute(positions, 3))
  g.setAttribute('iColor', new InstancedBufferAttribute(colors, 3))
  g.instanceCount = positions.length / 3
  return g
}

/** Whether the viewer asked for less motion: the halo's noise holds still then. */
export function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
