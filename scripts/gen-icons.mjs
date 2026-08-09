#!/usr/bin/env node
// Writes the extension's PNG icons. Chrome will not accept SVG for an action icon, and
// pulling in an image library for four flat squares is not worth it, so this encodes
// PNG directly — node's zlib does the only hard part.
//
//   node scripts/gen-icons.mjs

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

// ---------------------------------------------------------------- the mark

// Two overlapping rounded blocks on a dark ground: one for each language, overlapping
// where they share meaning. Reads as a solid shape at 16px, which is the only size that
// really has to work.
const BG = [23, 24, 28, 255]
const LEFT = [224, 139, 120, 255]     // warm — the English side
const RIGHT = [122, 162, 196, 255]    // cool — the Chinese side
const OVERLAP = [243, 226, 214, 255]

function draw(size) {
  const px = new Uint8ClampedArray(size * size * 4)
  const S = size
  const put = (x, y, c, a = 1) => {
    const i = (y * S + x) * 4
    px[i] = px[i] * (1 - a) + c[0] * a
    px[i + 1] = px[i + 1] * (1 - a) + c[1] * a
    px[i + 2] = px[i + 2] * (1 - a) + c[2] * a
    px[i + 3] = Math.max(px[i + 3], c[3] * a)
  }

  // rounded-rect coverage with a little supersampling so edges are not jagged
  const cover = (x, y, rx0, ry0, rx1, ry1, r) => {
    let hits = 0
    const N = 3
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const px_ = x + (sx + 0.5) / N, py_ = y + (sy + 0.5) / N
      if (px_ < rx0 || px_ > rx1 || py_ < ry0 || py_ > ry1) continue
      const cx = Math.min(Math.max(px_, rx0 + r), rx1 - r)
      const cy = Math.min(Math.max(py_, ry0 + r), ry1 - r)
      if ((px_ - cx) ** 2 + (py_ - cy) ** 2 <= r * r + 1e-9) hits++
    }
    return hits / (N * N)
  }

  const pad = S * 0.06
  const radius = S * 0.22
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = cover(x, y, pad, pad, S - pad, S - pad, radius)
    if (a > 0) put(x, y, BG, a)
  }

  // two blocks, overlapping in the middle third
  const m = S * 0.20, h = S * 0.30, r2 = S * 0.06
  const lx0 = m, lx1 = S * 0.62, ly0 = S * 0.22, ly1 = S * 0.22 + h
  const rx0 = S * 0.38, rx1 = S - m, ry0 = S * 0.48, ry1 = S * 0.48 + h

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a1 = cover(x, y, lx0, ly0, lx1, ly1, r2)
    if (a1 > 0) put(x, y, LEFT, a1)
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a2 = cover(x, y, rx0, ry0, rx1, ry1, r2)
    if (a2 <= 0) continue
    const a1 = cover(x, y, lx0, ly0, lx1, ly1, r2)
    put(x, y, a1 > 0.5 ? OVERLAP : RIGHT, a2)
  }
  return px
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePng(draw(size), size)
  writeFileSync(join(OUT, `icon${size}.png`), png)
  console.log(`extension/icons/icon${size}.png  ${png.length} bytes`)
}
