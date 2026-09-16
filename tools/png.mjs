/**
 * png.mjs - just enough PNG to make an app icon, and nothing more.
 *
 * This exists because an icon should not need a toolchain. There is no
 * ImageMagick, sharp or ffmpeg here, and adding one as a dependency to resize
 * seven files once would be a strange trade: zlib is already in node, and the
 * rest of PNG is a CRC table and some arithmetic. What is here reads an 8-bit
 * RGBA image, scales a rectangle of it down, and writes it back out. That is
 * the whole job.
 *
 * The one part with an opinion in it is `resize`. See its comment: a plain
 * average is the right answer for a photograph and the wrong one for a neon
 * wireframe, which is what this icon is.
 */

import zlib from 'node:zlib'
import fs from 'node:fs'

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32 (buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** An image as { w, h, px }, px being w*h*4 bytes of RGBA. */
export function decode (file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`)
  let o = 8
  let head = null
  const idat = []
  while (o < b.length) {
    const len = b.readUInt32BE(o)
    const type = b.toString('ascii', o + 4, o + 8)
    const data = b.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') head = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    o += 12 + len
  }
  if (!head) throw new Error('no IHDR')
  if (head.depth !== 8 || head.color !== 6 || head.interlace !== 0) {
    throw new Error(`want an 8-bit RGBA non-interlaced PNG, got depth ${head.depth} color ${head.color} interlace ${head.interlace}`)
  }
  const { w, h } = head
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  // Undo the per-scanline filter. Each line names its own filter and refers to
  // the pixel left of it (a), the one above (b), and the one above-left (c).
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const out = px.subarray(y * stride, y * stride + stride)
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const b2 = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b2
      else if (filter === 3) v += (a + b2) >> 1
      else if (filter === 4) {
        const p = a + b2 - c
        const pa = Math.abs(p - a); const pb = Math.abs(p - b2); const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c
      }
      out[i] = v & 0xff
    }
  }
  return { w, h, px }
}

/**
 * Scale a rectangle of `img` down into a square of `size`.
 *
 * Every source pixel that falls in an output cell is weighted by how much of
 * the cell it covers, so nothing is skipped the way sampling one pixel per cell
 * would skip it. That matters here more than usual: this icon is a wireframe,
 * and its lines are a few pixels wide against a near-black ground. Point
 * sampling drops a line entirely whenever the sample lands beside it, which at
 * 32 pixels is most of them.
 *
 * `glow` then corrects for what averaging costs a thin bright line. Shrinking
 * 640 pixels to 32 puts a 400-pixel cell around a line perhaps 12 pixels wide,
 * and the mean of that cell is mostly background: the line survives as a smudge
 * two shades above black. Mixing the cell's brightest pixel back in by `glow`
 * keeps the line visible at small sizes, at the cost of a slightly blown
 * highlight. Large icons are reduced so little that they do not need it, and
 * pass 0.
 */
export function resize (img, size, crop = {}, glow = 0) {
  const { x = 0, y = 0, w = img.w, h = img.h } = crop
  const out = Buffer.alloc(size * size * 4)
  for (let oy = 0; oy < size; oy++) {
    const sy0 = y + (oy * h) / size
    const sy1 = y + ((oy + 1) * h) / size
    for (let ox = 0; ox < size; ox++) {
      const sx0 = x + (ox * w) / size
      const sx1 = x + ((ox + 1) * w) / size
      let r = 0; let g = 0; let b = 0; let a = 0; let total = 0
      let brightest = -1; let br = 0; let bg = 0; let bb = 0
      for (let py = Math.floor(sy0); py < Math.ceil(sy1); py++) {
        const fy = Math.min(sy1, py + 1) - Math.max(sy0, py)
        if (fy <= 0 || py < 0 || py >= img.h) continue
        for (let px = Math.floor(sx0); px < Math.ceil(sx1); px++) {
          const fx = Math.min(sx1, px + 1) - Math.max(sx0, px)
          if (fx <= 0 || px < 0 || px >= img.w) continue
          const weight = fx * fy
          const i = (py * img.w + px) * 4
          r += img.px[i] * weight
          g += img.px[i + 1] * weight
          b += img.px[i + 2] * weight
          a += img.px[i + 3] * weight
          total += weight
          const lum = 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2]
          if (lum > brightest) { brightest = lum; br = img.px[i]; bg = img.px[i + 1]; bb = img.px[i + 2] }
        }
      }
      const o = (oy * size + ox) * 4
      const mix = (mean, peak) => Math.max(0, Math.min(255, Math.round(mean / total + glow * (peak - mean / total))))
      out[o] = mix(r, br)
      out[o + 1] = mix(g, bg)
      out[o + 2] = mix(b, bb)
      out[o + 3] = Math.round(a / total)
    }
  }
  return { w: size, h: size, px: out }
}

/** PNG bytes for an image, with the filter chosen per line rather than fixed. */
export function encode (img) {
  const bpp = 4
  const stride = img.w * bpp
  const raw = Buffer.alloc(img.h * (stride + 1))
  const candidate = Buffer.alloc(stride)
  const best = Buffer.alloc(stride)
  for (let y = 0; y < img.h; y++) {
    const line = img.px.subarray(y * stride, y * stride + stride)
    const prev = y ? img.px.subarray((y - 1) * stride, y * stride) : null
    let bestFilter = 0
    let bestScore = Infinity
    // The standard heuristic: the filter whose output is closest to zero
    // compresses best, because deflate is being handed smaller numbers.
    for (let f = 0; f <= 4; f++) {
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0
        const b = prev ? prev[i] : 0
        const c = prev && i >= bpp ? prev[i - bpp] : 0
        let v
        if (f === 0) v = line[i]
        else if (f === 1) v = line[i] - a
        else if (f === 2) v = line[i] - b
        else if (f === 3) v = line[i] - ((a + b) >> 1)
        else {
          const p = a + b - c
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
          v = line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
        candidate[i] = v & 0xff
        const signed = candidate[i] > 127 ? 256 - candidate[i] : candidate[i]
        score += signed
      }
      if (score < bestScore) { bestScore = score; bestFilter = f; candidate.copy(best) }
    }
    raw[y * (stride + 1)] = bestFilter
    best.copy(raw, y * (stride + 1) + 1)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.w, 0)
  ihdr.writeUInt32BE(img.h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * An .ico wrapping PNGs, which is what /favicon.ico is still asked for.
 *
 * Every entry holds a whole PNG rather than the older bare-bitmap form. Every
 * browser in use reads that, and it keeps the alpha channel without the
 * separate AND mask the bitmap form needs.
 */
export function ico (pngs) {
  const dir = Buffer.alloc(6 + 16 * pngs.length)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(pngs.length, 4)
  let offset = dir.length
  pngs.forEach(({ size, bytes }, i) => {
    const e = 6 + 16 * i
    dir[e] = size >= 256 ? 0 : size // 0 is how 256 is spelled here
    dir[e + 1] = size >= 256 ? 0 : size
    dir[e + 2] = 0
    dir[e + 3] = 0
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(bytes.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += bytes.length
  })
  return Buffer.concat([dir, ...pngs.map((p) => p.bytes)])
}
