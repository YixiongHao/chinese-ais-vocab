#!/usr/bin/env node
// Extracts attestations whose quote does not contain the rendering they are cited as
// evidence for, into a worklist for the verification pass. These are not necessarily
// fabricated — a source may discuss a concept without using the term — but each one is
// a claim of evidence that the evidence does not visibly support, so each needs a human
// or a re-fetch to resolve.
//
//   node scripts/audit.mjs            write scratch worklist + summary
//   node scripts/audit.mjs --urls     also list every distinct URL, most-cited first

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attests } from './normalize.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const terms = JSON.parse(readFileSync(join(ROOT, 'data', 'terms.json'), 'utf8'))

const mismatches = []
const urlCount = new Map()
let total = 0

for (const t of terms) {
  for (const tr of t.translations ?? []) {
    for (const a of tr.attestations ?? []) {
      total++
      if (a.url) urlCount.set(a.url, (urlCount.get(a.url) ?? 0) + 1)
      const zh = tr.zh
      const q = a.quote_zh ?? ''
      if (attests(zh, q)) continue
      mismatches.push({
        term_id: t.id, en: t.en, category: t.category,
        zh, status: tr.status, is_preferred: t.preferred_zh === zh,
        quote_zh: q, publisher: a.publisher ?? null,
        source_title: a.source_title ?? null, url: a.url ?? null, date: a.date ?? null,
        verdict: null, corrected_quote: null, note: null,
      })
    }
  }
}

writeFileSync(join(ROOT, 'data', 'audit-worklist.json'), JSON.stringify(mismatches, null, 2) + '\n', 'utf8')

const byCat = mismatches.reduce((m, x) => (m[x.category] = (m[x.category] ?? 0) + 1, m), {})
console.log(`${total} attestations total`)
console.log(`${mismatches.length} where the quote does not contain the cited rendering (${(mismatches.length / total * 100).toFixed(1)}%)`)
console.log(`  of those, ${mismatches.filter((x) => x.is_preferred).length} back the RECOMMENDED rendering — highest priority`)
console.log('\nby category:')
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`)
console.log(`\ndistinct source URLs: ${urlCount.size}`)

if (process.argv.includes('--urls')) {
  console.log('\nmost-cited sources:')
  for (const [u, n] of [...urlCount].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${String(n).padStart(3)}  ${u}`)
}
console.log('\nwrote data/audit-worklist.json')
