#!/usr/bin/env node
// Writes the extension's PNG icons. Chrome will not accept SVG for an action icon, and
// pulling in an image library for a few flat shapes is not worth it, so this encodes
// PNG directly — node's zlib does the only hard part.
//
//   node scripts/gen-icons.mjs
//   node scripts/gen-icons.mjs --preview <dir>   also write a 512px copy to look at
//
// The mark is ASCII art: two arrows made of typed characters, pointing opposite ways.
// That only survives at 128px. At 48px and below the letterforms turn to mud, so the
// small sizes draw the same idea as two plain arrows. Same shape, same colours, no text.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'extension', 'icons')
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** @param px Uint8ClampedArray RGBA, length = size*size*4 */
function encodePng(px, size) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0                                   // filter: none
    Buffer.from(px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- palette

const BG = [23, 24, 28, 255]
const WARM = [224, 139, 120, 255]     // the English side
const COOL = [122, 162, 196, 255]     // the Chinese side

// ---------------------------------------------------------------- canvas

function canvas(S) {
  const px = new Uint8ClampedArray(S * S * 4)

  const put = (x, y, c, a) => {
    if (a <= 0 || x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    px[i] = px[i] * (1 - a) + c[0] * a
    px[i + 1] = px[i + 1] * (1 - a) + c[1] * a
    px[i + 2] = px[i + 2] * (1 - a) + c[2] * a
    px[i + 3] = Math.max(px[i + 3], c[3] * a)
  }

  // 3x3 supersampled coverage of an arbitrary inside-test, so edges are not jagged
  const fill = (colour, inside, x0 = 0, y0 = 0, x1 = S, y1 = S) => {
    const N = 3
    const lo = (v) => Math.max(0, Math.floor(v)), hi = (v) => Math.min(S, Math.ceil(v))
    for (let y = lo(y0); y < hi(y1); y++) {
      for (let x = lo(x0); x < hi(x1); x++) {
        let hits = 0
        for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
          if (inside(x + (sx + 0.5) / N, y + (sy + 0.5) / N)) hits++
        }
        if (hits) put(x, y, colour, hits / (N * N))
      }
    }
  }

  const roundRect = (rx0, ry0, rx1, ry1, r) => (x, y) => {
    if (x < rx0 || x > rx1 || y < ry0 || y > ry1) return false
    const cx = Math.min(Math.max(x, rx0 + r), rx1 - r)
    const cy = Math.min(Math.max(y, ry0 + r), ry1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9
  }

  return { px, put, fill, roundRect }
}

function ground(c, S) {
  const pad = S * 0.06
  c.fill(BG, c.roundRect(pad, pad, S - pad, S - pad, S * 0.22))
}

// ---------------------------------------------------------------- 5x7 font

// Only the glyphs the mark uses. Each row is 5 columns.
const FONT = {
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'N': ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

const GLYPH_W = 5, GLYPH_H = 7

function text(c, str, x0, y0, scale, colour) {
  const cell = (GLYPH_W + 1) * scale
  for (let n = 0; n < str.length; n++) {
    const g = FONT[str[n]]
    if (!g) throw new Error(`gen-icons: no glyph for ${JSON.stringify(str[n])}`)
    const gx = x0 + n * cell
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (g[row][col] !== '1') continue
        const px0 = gx + col * scale, py0 = y0 + row * scale
        c.fill(colour, (x, y) => x >= px0 && x < px0 + scale && y >= py0 && y < py0 + scale,
          px0, py0, px0 + scale, py0 + scale)
      }
    }
  }
}

/** Width in pixels of `str` at `scale`, trailing inter-glyph gap removed. */
const textWidth = (str, scale) => str.length * (GLYPH_W + 1) * scale - scale

// ---------------------------------------------------------------- the marks

// 128px: the ASCII art itself.
//
//     EN ---->
//     <---- ZH
//
// Two directions of translation, typed out. The arrows carry the shape and the letters
// name the ends, which is the whole product in eight characters a side.
function drawAscii(S) {
  const c = canvas(S)
  ground(c, S)

  const TOP = 'EN -->'
  const BOTTOM = '<-- ZH'

  const scale = Math.max(1, Math.round(S / 43))          // 3 at 128px
  const w = textWidth(TOP, scale)
  const x0 = Math.round((S - w) / 2)
  const rowH = GLYPH_H * scale
  const gap = Math.round(S * 0.08)
  const y0 = Math.round((S - (rowH * 2 + gap)) / 2)

  text(c, TOP, x0, y0, scale, WARM)
  text(c, BOTTOM, x0, y0 + rowH + gap, scale, COOL)
  return c.px
}

// 48px and below: the same two arrows, drawn as shapes. No letterforms — at 16px a 5x7
// glyph is three grey pixels, and three grey pixels are worse than nothing.
function drawSmall(S) {
  const c = canvas(S)
  ground(c, S)

  const bar = Math.max(2, Math.round(S * 0.10))          // shaft thickness
  const head = Math.max(3, Math.round(S * 0.17))         // arrowhead length
  const hh = Math.max(3, Math.round(S * 0.17))           // arrowhead half-height

  // right-pointing: shaft, then a triangle whose height falls off toward the tip
  const rightArrow = (x0, x1, cy) => (x, y) => {
    if (x < x0 || x > x1) return false
    if (x > x1 - head) {
      const t = (x1 - x) / head
      return Math.abs(y - cy) <= hh * t
    }
    return Math.abs(y - cy) <= bar / 2
  }
  const leftArrow = (x0, x1, cy) => (x, y) => {
    if (x < x0 || x > x1) return false
    if (x < x0 + head) {
      const t = (x - x0) / head
      return Math.abs(y - cy) <= hh * t
    }
    return Math.abs(y - cy) <= bar / 2
  }

  c.fill(WARM, rightArrow(S * 0.18, S * 0.80, S * 0.36))
  c.fill(COOL, leftArrow(S * 0.20, S * 0.82, S * 0.64))
  return c.px
}

const draw = (S) => (S >= 96 ? drawAscii(S) : drawSmall(S))

// ---------------------------------------------------------------- write

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(draw(size), size)
  writeFileSync(join(OUT, `icon${size}.png`), png)
  console.log(`extension/icons/icon${size}.png  ${png.length} bytes`)
}

const pi = process.argv.indexOf('--preview')
if (pi !== -1 && process.argv[pi + 1]) {
  const dir = process.argv[pi + 1]
  mkdirSync(dir, { recursive: true })
  for (const size of [512, 128, 48, 16]) {
    writeFileSync(join(dir, `preview${size}.png`), encodePng(draw(size), size))
  }
  console.log(`preview written to ${dir}`)
}
