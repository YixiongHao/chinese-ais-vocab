#!/usr/bin/env node
// Generates the extension's bundled database from data/terms.json.
//
//   node scripts/build-extension.mjs
//
// The site ships every field; the extension ships only what a hover card needs, plus
// the match index. Shipped as a plain script assigning a global, so the content script
// needs no async load before it can highlight — same trick as site/terms-data.js.
//
// Output: extension/data/db.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const terms = JSON.parse(readFileSync(join(ROOT, 'data', 'terms.json'), 'utf8'))

// A rendering is only worth a hover card if we can say something about it.
const STATUS_RANK = { established: 0, common: 1, contested: 2, loanword: 3, descriptive: 4, transliteration: 5, proposed: 6, deprecated: 9 }

const out = []
const enIndex = Object.create(null)   // lowercased English phrase -> term ordinal
const zhIndex = Object.create(null)   // Chinese string           -> term ordinal

// Several terms legitimately claim the same string — 大模型 is both the Chinese rendering
// of "foundation model" and the headword of the Chinese-origin entry that exists to
// explain 大模型 itself. Priority decides who owns the hover card: the entry the string
// is *about* beats an entry that merely translates to it.
//   2 = this is the entry's own headword
//   1 = the entry's recommended rendering
//   0 = an alternative or deprecated rendering
const addKey = (index, key, ord, minLen, pri) => {
  if (!key) return
  const k = String(key).trim()
  if (k.length < minLen) return
  const prev = index[k]
  if (prev === undefined || pri > prev.pri) index[k] = { ord, pri }
}

for (const t of terms) {
  const zhOrigin = t.direction === 'zh-to-en'
  const rend = (zhOrigin ? t.en_renderings : t.translations) || []
  const rkey = zhOrigin ? 'en' : 'zh'
  const preferred = zhOrigin ? t.preferred_en : t.preferred_zh
  const prefR = rend.find((r) => r[rkey] === preferred) || rend[0] || null

  // Who has actually used this rendering — publishers of its attestations, then any
  // explicit used_by orgs. This is the "which sources use it" line in the hover card.
  const pubs = []
  for (const r of rend) {
    for (const a of r.attestations || []) {
      if (a.publisher && !pubs.includes(a.publisher)) pubs.push(a.publisher)
    }
  }
  for (const u of t.used_by || []) if (u.org && !pubs.includes(u.org)) pubs.push(u.org)

  // One short example of the term in a real sentence. A curated usage example if we have
  // one; otherwise the shortest attestation quote, which is by definition real usage.
  let ex = null
  const ue = (t.usage_examples || [])[0]
  if (ue && ue.zh) {
    ex = { z: ue.zh, e: ue.en || null, s: 'example' }
  } else {
    const quotes = rend.flatMap((r) => (r.attestations || []).filter((a) => a.quote_zh))
    quotes.sort((a, b) => a.quote_zh.length - b.quote_zh.length)
    const q = quotes[0]
    if (q) ex = { z: q.quote_zh, e: q.quote_en || null, s: q.publisher || 'source' }
  }

  const ord = out.length
  out.push({
    i: t.id,
    e: t.en,
    a: t.abbr || null,
    z: zhOrigin ? t.zh_headword : (t.preferred_zh || null),
    n: zhOrigin ? (t.preferred_en || t.en) : null,   // the English answer for zh-origin terms
    p: prefR?.pinyin || t.pinyin || null,
    s: prefR?.status || null,
    c: t.confidence,
    d: t.translation_difficulty,
    // Keys differing only by case (d/D, p/P) are legal JSON but break case-insensitive
    // consumers — PowerShell's ConvertFrom-Json refuses the file outright. Spelled out.
    def: (t.definition_en || '').slice(0, 320) || null,
    pit: t.pitfalls || t.why_no_english || null,
    u: pubs.slice(0, 4),
    x: ex,
    g: zhOrigin ? 1 : 0,
    r: rend.length,
    cites: t.attestation_count || 0,
  })

  // ---- match keys ----
  // English side: the headword, aliases, abbreviation, and for zh-origin entries the
  // English renderings too. Two chars minimum, so "AI" and stray initials do not match.
  const enKeys = [[t.en, 2], [t.abbr, 1], ...(t.en_aliases || []).map((a) => [a, 1])]
  // For a Chinese-origin entry the English renderings are its answer, not a translation
  // of someone else's headword, so they carry headword priority.
  if (zhOrigin) for (const r of rend) enKeys.push([r.en, r.en === preferred ? 2 : 1])
  for (const [k, pri] of enKeys) {
    if (!k) continue
    const lower = String(k).toLowerCase().trim()
    if (lower.length < 3) continue
    addKey(enIndex, lower, ord, 3, pri)
    // Cheap plural. Safe for multiword technical phrases, which is nearly all of these.
    if (!/[sxz]$/.test(lower) && !lower.includes('(')) addKey(enIndex, lower + 's', ord, 3, pri - 1)
  }

  // Chinese side: the headword and every recorded rendering, including deprecated ones —
  // meeting a deprecated rendering in the wild is exactly when you want the card.
  const zhKeys = [[t.zh_headword, 2]]
  for (const r of t.translations || []) zhKeys.push([r.zh, r.zh === t.preferred_zh ? 1 : 0])
  for (const [k, pri] of zhKeys) {
    if (!k) continue
    const s = String(k).trim()
    if (!/[一-鿿]/.test(s)) continue      // pure-Latin loanwords match on the EN side
    addKey(zhIndex, s, ord, 2, pri)
  }
}

// Drop the priorities now that every contest is settled; the runtime only needs ordinals.
for (const idx of [enIndex, zhIndex]) for (const k of Object.keys(idx)) idx[k] = idx[k].ord

// Sort keys longest-first so the regex alternation prefers the most specific match.
const byLenDesc = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[0].length - a[0].length))

// Card keys are abbreviated to keep the payload small, which makes it easy to introduce
// two that differ only by case. That is legal JSON but several parsers — PowerShell's
// ConvertFrom-Json among them — reject the whole file. Catch it here, not downstream.
{
  const keys = [...new Set(out.flatMap((t) => Object.keys(t)))]
  const byLower = new Map()
  for (const k of keys) {
    const l = k.toLowerCase()
    if (byLower.has(l)) {
      console.error(`FATAL: card keys "${byLower.get(l)}" and "${k}" differ only by case.`)
      process.exit(1)
    }
    byLower.set(l, k)
  }
}

const built = new Date().toISOString().slice(0, 10)
mkdirSync(join(ROOT, 'extension', 'data'), { recursive: true })

// Split deliberately. The index is all a content script needs to find and wrap matches,
// and it loads on every page in every tab — so it stays small. The card payload is six
// times larger and is only needed once someone actually hovers, so it lives in the
// service worker and is fetched on demand.
const index = {
  v: 1, built,
  ids: out.map((t) => t.i),                // ordinal -> id, so hovers can be looked up
  en: byLenDesc(enIndex),
  zh: byLenDesc(zhIndex),
}
const indexJs = '// GENERATED by scripts/build-extension.mjs — do not edit.\n' +
  'self.CAISV_INDEX = ' + JSON.stringify(index) + ';\n'
writeFileSync(join(ROOT, 'extension', 'data', 'index.js'), indexJs, 'utf8')

const cards = { v: 1, built, terms: out }
writeFileSync(join(ROOT, 'extension', 'data', 'cards.json'), JSON.stringify(cards), 'utf8')

const kb = (n) => (n / 1024).toFixed(0) + ' KB'
const shortZh = Object.keys(index.zh).filter((k) => k.length <= 2).length
console.log(`terms      ${out.length}`)
console.log(`en keys    ${Object.keys(index.en).length}`)
console.log(`zh keys    ${Object.keys(index.zh).length}  (${shortZh} are 2 characters — gated behind the "short terms" setting)`)
console.log(`examples   ${out.filter((t) => t.x).length}/${out.length} terms carry a usage sentence`)
console.log(`sources    ${out.filter((t) => t.u.length).length}/${out.length} terms name at least one publisher`)
console.log(`wrote      extension/data/index.js  ${kb(indexJs.length)}   (loads on every page)`)
console.log(`wrote      extension/data/cards.json ${kb(JSON.stringify(cards).length)}  (loaded once in the worker)`)
