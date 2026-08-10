#!/usr/bin/env node
// Packages extension/ into a Chrome Web Store upload zip.
//
//   node scripts/package-extension.mjs
//
// Writes a store-format zip (manifest.json at the archive root, no wrapper directory).
// Implemented against zlib directly rather than shelling out, so it behaves the same
// wherever it runs and does not depend on Compress-Archive's directory conventions.

import { deflateRawSync } from 'node:zlib'
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXT = join(ROOT, 'extension')
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))

// Anything not needed at runtime stays out of the upload.
const EXCLUDE = new Set(['README.md', '.DS_Store', 'Thumbs.db'])

function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (EXCLUDE.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

// ---------------------------------------------------------------- zip writer

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const files = walk(EXT)
const locals = []
const centrals = []
let offset = 0

for (const full of files) {
  // Zip entries always use forward slashes, whatever the host platform does.
  const name = relative(EXT, full).split(sep).join('/')
  const data = readFileSync(full)
  const comp = deflateRawSync(data, { level: 9 })
  const useDeflate = comp.length < data.length
  const body = useDeflate ? comp : data
  const nameBuf = Buffer.from(name, 'utf8')
  const crc = crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)                       // version needed
  local.writeUInt16LE(0x0800, 6)                   // UTF-8 names
  local.writeUInt16LE(useDeflate ? 8 : 0, 8)
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12)   // fixed mtime, for reproducibility
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)
  locals.push(local, nameBuf, body)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(useDeflate ? 8 : 0, 10)
  central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42)
  central.writeUInt32LE(offset, 42)
  centrals.push(central, nameBuf)

  offset += local.length + nameBuf.length + body.length
}

const centralBuf = Buffer.concat(centrals)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)

const zip = Buffer.concat([...locals, centralBuf, end])
mkdirSync(join(ROOT, 'dist'), { recursive: true })
const outName = `ais-vocab-cn-${manifest.version}.zip`
writeFileSync(join(ROOT, 'dist', outName), zip)

console.log(`${files.length} files`)
for (const f of files) console.log('  ' + relative(EXT, f).split(sep).join('/'))
console.log(`\nwrote dist/${outName}  ${(zip.length / 1024).toFixed(0)} KB`)
console.log('Upload at https://chrome.google.com/webstore/devconsole')
