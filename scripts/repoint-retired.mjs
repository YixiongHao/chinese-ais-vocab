#!/usr/bin/env node
// Sweeps every raw file and repoints `related` links that still name a retired id.
//
//   node scripts/repoint-retired.mjs           report only
//   node scripts/repoint-retired.mjs --write   apply
//
// A merge retires an id, and the survivor records it in `retired_ids`. Links to the old id
// can live in any file, not just the two involved in the merge, so this runs across all of
// them. The build would otherwise drop unresolvable links silently, which loses a real
// cross-reference rather than fixing it.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data', 'raw')
const WRITE = process.argv.includes('--write')

const files = readdirSync(RAW).filter((f) => f.endsWith('.json'))
const loaded = files.map((f) => ({ f, path: join(RAW, f), terms: JSON.parse(readFileSync(join(RAW, f), 'utf8')) }))

// retired id -> surviving id
const survivorOf = new Map()
const liveIds = new Set()
for (const { terms } of loaded) {
  for (const t of terms) {
    liveIds.add(t.id)
    for (const r of t.retired_ids || []) survivorOf.set(r, t.id)
  }
}

if (!survivorOf.size) { console.log('no retired ids recorded — nothing to repoint'); process.exit(0) }
console.log(`retired ids: ${[...survivorOf].map(([r, s]) => `${r} -> ${s}`).join(', ')}\n`)

let repointed = 0, dropped = 0, dangling = []
for (const entry of loaded) {
  let touched = false
  for (const t of entry.terms) {
    if (!Array.isArray(t.related)) continue
    const before = t.related.join('|')
    const next = []
    for (const r of t.related) {
      const s = survivorOf.get(r)
      if (s) {
        repointed++
        if (s !== t.id && !next.includes(s)) next.push(s)
        else dropped++                       // link would point at itself
        continue
      }
      if (!liveIds.has(r)) dangling.push(`${entry.f}: ${t.id} -> ${r}`)
      if (!next.includes(r)) next.push(r)
    }
    if (next.join('|') !== before) { t.related = next; touched = true }
  }
  if (touched && WRITE) writeFileSync(entry.path, JSON.stringify(entry.terms, null, 2) + '\n', 'utf8')
  if (touched) console.log(`${WRITE ? 'wrote' : 'would change'}  ${entry.f}`)
}

console.log(`\n${repointed} link(s) repointed${dropped ? `, ${dropped} dropped as self-referential` : ''}`)
if (dangling.length) {
  console.log(`\n${dangling.length} link(s) point at an id that does not exist and is not retired:`)
  for (const d of dangling.slice(0, 20)) console.log('  ! ' + d)
}
if (!WRITE) console.log('\n(report only — pass --write to apply)')
