#!/usr/bin/env node
// Mechanical integrity audit. Finds entries whose parts disagree with each other —
// the failure that produced `specification-hacking`, an id naming one concept whose
// headword named a second and whose definition and Chinese described a third.
//
//   node scripts/audit-integrity.mjs
//
// Everything here is deterministic and cheap. It cannot judge whether a translation is
// good; it can only find internal contradictions, and those turn out to be where the
// bad entries hide.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const terms = JSON.parse(readFileSync(join(ROOT, 'data', 'terms.json'), 'utf8'))

const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'in', 'to', 'for', 'from', 'on', 'by',
                      'ai', 'artificial', 'intelligence', 'model', 'models', 's'])
const tok = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ' ')
  .split(' ').filter((w) => w && !STOP.has(w))

const findings = []
const add = (id, kind, detail) => findings.push({ id, kind, detail })

for (const t of terms) {
  const zhOrigin = t.direction === 'zh-to-en'
  const rend = (zhOrigin ? t.en_renderings : t.translations) || []
  const names = [t.en, ...(t.en_aliases || []), t.abbr, ...(zhOrigin ? rend.map((r) => r.en) : [])]
  const nameTokens = new Set(names.flatMap(tok))

  // 1. id tokens that appear in none of the entry's own names. An id is a promise about
  //    what the entry is about; a token that appears nowhere else is a broken promise.
  // `-prc` / `-zh` are a deliberate convention marking a Chinese-origin entry that shares
  // a name with an English-origin one, so they are not orphans.
  const SUFFIX = new Set(['prc', 'zh', 'cot', 'graded', 'smart'])
  const orphan = tok(t.id).filter((w) => {
    if (nameTokens.has(w) || SUFFIX.has(w)) return false
    if (/^[a-z]{2,6}$/.test(w) && (t.abbr || '').toLowerCase().replace(/[^a-z]/g, '') === w) return false
    return ![...nameTokens].some((n) => n.startsWith(w.slice(0, 4)) || w.startsWith(n.slice(0, 4)))
  })
  if (orphan.length) add(t.id, 'id-mismatch', `id token(s) [${orphan.join(', ')}] appear in no name of this entry; en="${t.en}"`)

  // 3. Recommended rendering not among the renderings, or missing entirely.
  const preferred = zhOrigin ? t.preferred_en : t.preferred_zh
  if (rend.length && preferred && !rend.some((r) => (zhOrigin ? r.en : r.zh) === preferred))
    add(t.id, 'preferred-orphan', `preferred "${preferred}" is not one of the recorded renderings`)
  if (!rend.length) add(t.id, 'no-renderings', 'entry has no renderings at all')

  // 4. Confidence not earned. The build already downgrades, so anything left is a bug.
  const pref = rend.find((r) => (zhOrigin ? r.en : r.zh) === preferred)
  const nAtt = (pref?.attestations || []).filter((a) => !a.unverified).length
  if (t.confidence === 'high' && nAtt < 2) add(t.id, 'confidence-unearned', `high confidence on ${nAtt} verified attestation(s)`)
  if (!t.attestation_count) add(t.id, 'no-evidence', `no attestation anywhere; confidence=${t.confidence}`)

  // 5. Empty or stub definitions.
  if (!t.definition_en) add(t.id, 'no-definition-en', 'missing definition_en')
  else if (t.definition_en.length < 60) add(t.id, 'stub-definition', `definition_en is ${t.definition_en.length} chars`)
  if (!t.definition_zh) add(t.id, 'no-definition-zh', 'missing definition_zh')
}

// 7. Cross-entry: one surface string owned by several entries.
const owners = { zh: new Map(), en: new Map() }
for (const t of terms) {
  for (const z of [t.zh_headword, ...(t.translations || []).map((r) => r.zh)].filter(Boolean))
    owners.zh.set(z, [...(owners.zh.get(z) || []), t.id])
  for (const e of [t.en, ...(t.en_aliases || []), ...(t.en_renderings || []).map((r) => r.en)].filter(Boolean))
    owners.en.set(e.toLowerCase(), [...(owners.en.get(e.toLowerCase()) || []), t.id])
}
for (const [lang, map] of Object.entries(owners)) {
  for (const [s, ids] of map) {
    const uniq = [...new Set(ids)]
    if (uniq.length > 1) add(uniq.join(' + '), `collision-${lang}`, `"${s}" claimed by ${uniq.length} entries`)
  }
}

// 8. Probable DUPLICATE entries — the structural risk of having researched the two
//    directions independently, with neither pass able to see what the other had created.
//    Two entries whose HEADWORDS match, or where one's headword is another's alias, are
//    describing the same concept twice unless there is a documented reason not to.
const headword = new Map()
for (const t of terms) headword.set(t.en.toLowerCase(), [...(headword.get(t.en.toLowerCase()) || []), t.id])
for (const t of terms) {
  for (const a of [...(t.en_aliases || []), ...(t.en_renderings || []).map((r) => r.en)]) {
    const other = headword.get(String(a).toLowerCase())
    if (!other) continue
    for (const o of other) {
      if (o === t.id) continue
      add(`${t.id} + ${o}`, 'probable-duplicate',
          `"${a}" is an alias of ${t.id} and the headword of ${o} — same concept entered twice?`)
    }
  }
}
for (const [h, ids] of headword) {
  const uniq = [...new Set(ids)]
  if (uniq.length > 1) add(uniq.join(' + '), 'probable-duplicate', `both use the headword "${h}"`)
}

// ---------------------------------------------------------------- report

const byKind = findings.reduce((m, f) => ((m[f.kind] ??= []).push(f), m), {})
const order = Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)

console.log(`${terms.length} terms · ${findings.length} findings\n`)
for (const [kind, list] of order) console.log(`${String(list.length).padStart(4)}  ${kind}`)
console.log()
for (const [kind, list] of order) {
  console.log(`--- ${kind} (${list.length}) ---`)
  for (const f of list.slice(0, 12)) console.log(`  ${f.id}: ${f.detail}`)
  if (list.length > 12) console.log(`  … ${list.length - 12} more`)
  console.log()
}

writeFileSync(join(ROOT, 'data', 'audit-integrity.json'), JSON.stringify(findings, null, 2) + '\n', 'utf8')
console.log('wrote data/audit-integrity.json')
