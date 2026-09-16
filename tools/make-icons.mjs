/**
 * make-icons.mjs - every icon in public/, from one 1024 master.
 *
 *   node tools/make-icons.mjs
 *
 * Run it after changing tools/icon-source.png. It overwrites its outputs and
 * reads nothing else, so what is in public/ is always exactly what this file
 * says it is, and a reviewer can check the icons by rerunning it rather than
 * by trusting whoever generated them last.
 *
 * WHY THREE CROPS, AND NOT ONE
 *
 * The master is a neon polyhedron in a field of smoke. Measured by color
 * saturation, the wireframe occupies x 235..797, y 214..797 of the 1024 frame:
 * a little over half the width, centered near (472, 499). How much of the smoke
 * to keep is not one answer, because the three places an icon lands crop it
 * differently and are read from different distances.
 *
 *   full    the whole frame, for maskable icons. Android cuts its own shape out
 *           of these, and only the middle 80% is promised to survive. The
 *           wireframe spans 57% of the width, so it clears that with room and
 *           the mask takes smoke, which is what smoke is for.
 *   medium  752 square, so the wireframe fills about three quarters. For the
 *           icons shown whole: a home screen, a task switcher, an install
 *           prompt. The full frame here reads as a mostly empty dark tile.
 *   tight   640 square, wireframe at about seven eighths. Only for the favicon
 *           sizes, where a tab gives the thing 16 pixels and any margin is
 *           margin spent on nothing.
 *
 * Each crop stays centered on that same measured center, so the three are the
 * same picture at three distances rather than three different framings.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, encode, ico, resize } from './png.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'public')

/** Where the wireframe actually is, measured off the master by chroma. */
const CENTER = { x: 472, y: 499 }
const square = (side) => ({ x: CENTER.x - side / 2, y: CENTER.y - side / 2, w: side, h: side })
const CROP = { full: { x: 0, y: 0, w: 1024, h: 1024 }, medium: square(752), tight: square(640) }

/**
 * glow rises as the icon shrinks, because averaging costs a thin bright line
 * more the further it is shrunk. See resize() in png.mjs.
 */
const ICONS = [
  { file: 'icon-512.png', size: 512, crop: 'medium', glow: 0 },
  { file: 'icon-192.png', size: 192, crop: 'medium', glow: 0.15 },
  { file: 'icon-maskable-512.png', size: 512, crop: 'full', glow: 0 },
  { file: 'icon-maskable-192.png', size: 192, crop: 'full', glow: 0.15 },
  { file: 'apple-touch-icon.png', size: 180, crop: 'medium', glow: 0.15 },
  { file: 'favicon-96.png', size: 96, crop: 'tight', glow: 0.3 },
]
/** The sizes inside favicon.ico. 48 is there for Windows shortcuts and pinning. */
const ICO_SIZES = [{ size: 48, glow: 0.4 }, { size: 32, glow: 0.45 }, { size: 16, glow: 0.5 }]

const master = decode(path.join(here, 'icon-source.png'))
if (master.w !== 1024 || master.h !== 1024) throw new Error(`master is ${master.w}x${master.h}, expected 1024x1024`)
fs.mkdirSync(out, { recursive: true })

const report = []
for (const { file, size, crop, glow } of ICONS) {
  const bytes = encode(resize(master, size, CROP[crop], glow))
  fs.writeFileSync(path.join(out, file), bytes)
  report.push([file, `${size}px`, crop, `glow ${glow}`, `${(bytes.length / 1024).toFixed(1)} kB`])
}

const bundle = ICO_SIZES.map(({ size, glow }) => ({ size, bytes: encode(resize(master, size, CROP.tight, glow)) }))
const icoBytes = ico(bundle)
fs.writeFileSync(path.join(out, 'favicon.ico'), icoBytes)
report.push(['favicon.ico', ICO_SIZES.map((s) => s.size).join('+'), 'tight', 'glow 0.4-0.5', `${(icoBytes.length / 1024).toFixed(1)} kB`])

const width = [0, 1, 2, 3, 4].map((i) => Math.max(...report.map((r) => r[i].length)))
for (const row of report) console.log(row.map((cell, i) => cell.padEnd(width[i])).join('  ').trimEnd())
