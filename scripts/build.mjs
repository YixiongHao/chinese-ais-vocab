#!/usr/bin/env node
// Merges data/raw/*.json into the canonical data/terms.json, validates it against the
// rules in SCHEMA.md, and emits the artifacts the site and reviewers consume.
//
//   node scripts/build.mjs            build + report
//   node scripts/build.mjs --strict   exit non-zero if any error-level problem found
//
// Outputs:
//   data/terms.json      canonical array — source of truth for the site and the extension
//   site/terms-data.js   same data as `window.VOCAB`, so index.html works over file://
//   exports/terms.csv    flat review sheet for native-speaker correction passes

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...xs) => join(ROOT, ...xs)
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))

const STRICT = process.argv.includes('--strict')
const errors = []
const warnings = []
const err = (id, msg) => errors.push(`${id}: ${msg}`)
const warn = (id, msg) => warnings.push(`${id}: ${msg}`)

const VALID_STATUS = new Set([
  'established', 'common', 'contested', 'descriptive',
  'proposed', 'loanword', 'transliteration', 'deprecated',
])
const VALID_DIFFICULTY = new Set(['low', 'medium', 'high'])
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low'])

// ---------------------------------------------------------------- load

const categories = readJson(p('data', 'categories.json'))
const categoryIds = new Set(categories.map((c) => c.id))
const seed = readJson(p('data', 'seed-terms.json'))

const rawDir = p('data', 'raw')
if (!existsSync(rawDir)) {
  console.error('data/raw/ does not exist — nothing to merge. Run the research agents first.')
  process.exit(1)
}

const terms = []
const seenIds = new Map()
const filesLoaded = []

for (const file of readdirSync(rawDir).filter((f) => f.endsWith('.json')).sort()) {
  let parsed
  try {
    parsed = readJson(join(rawDir, file))
  } catch (e) {
    errors.push(`${file}: not valid JSON — ${e.message}`)
    continue
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${file}: top level must be an array`)
    continue
  }
  filesLoaded.push(`${file} (${parsed.length})`)
  for (const t of parsed) {
    if (!t || typeof t !== 'object' || !t.id) {
      errors.push(`${file}: entry with no id`)
      continue
    }
    if (seenIds.has(t.id)) {
      err(t.id, `duplicate id, also in ${seenIds.get(t.id)}`)
      continue
    }
    seenIds.set(t.id, file)
    t._source_file = basename(file, '.json')
    terms.push(t)
  }
}

// ---------------------------------------------------------------- normalise + validate

const byId = new Map(terms.map((t) => [t.id, t]))

for (const t of terms) {
  // fill structural defaults so downstream code never has to null-check
  t.en_aliases ??= []
  t.tags ??= []
  t.translations ??= []
  t.attestation_count = 0
  t.usage_examples ??= []
  t.used_by ??= []
  t.related ??= []
  t.sources ??= []
  t.abbr ??= null
  t.pitfalls ??= null

  if (!t.en) err(t.id, 'missing "en"')
  if (!t.definition_en) warn(t.id, 'missing definition_en')
  if (!t.definition_zh) warn(t.id, 'missing definition_zh')

  if (!categoryIds.has(t.category)) err(t.id, `unknown category "${t.category}"`)
  if (t.translation_difficulty && !VALID_DIFFICULTY.has(t.translation_difficulty))
    err(t.id, `bad translation_difficulty "${t.translation_difficulty}"`)
  if (t.confidence && !VALID_CONFIDENCE.has(t.confidence))
    err(t.id, `bad confidence "${t.confidence}"`)
  t.translation_difficulty ??= 'medium'
  t.confidence ??= 'low'

  let attCount = 0
  for (const tr of t.translations) {
    tr.attestations ??= []
    tr.notes ??= null
    if (!tr.zh) err(t.id, 'translation with no "zh"')
    if (!VALID_STATUS.has(tr.status)) err(t.id, `bad translation status "${tr.status}" on ${tr.zh}`)

    // Normalise the rendering. Research passes sometimes cram a slash-list of variants
    // or a parenthetical gloss into `zh`; the schema wants one bare rendering per entry.
    // Where variants exist, keep the one the attestations actually quote — that is the
    // one we have evidence for — and preserve the original in `notes` so nothing is lost.
    const rawZh = tr.zh
    const stripped = rawZh.replace(/[（(][^）)]*[）)]\s*$/, '').trim()
    const variants = stripped.split(/\s*[/／、]\s*/).map((s) => s.trim()).filter(Boolean)
    if (variants.length > 1 || stripped !== rawZh) {
      const quoted = variants.find((v) => tr.attestations.some((a) => (a.quote_zh || '').includes(v)))
      tr.zh = quoted ?? variants[0] ?? rawZh
      tr.zh_variants = variants.length > 1 ? variants : undefined
      tr.notes = [tr.notes, `Recorded in research as “${rawZh}”.`].filter(Boolean).join(' ')
      warn(t.id, `normalised zh "${rawZh}" → "${tr.zh}"`)
      if (t.preferred_zh === rawZh) t.preferred_zh = tr.zh
    }

    // SCHEMA.md: a proposed rendering is ours, so it cannot carry attestations,
    // and it must justify itself.
    if (tr.status === 'proposed') {
      if (tr.attestations.length) err(t.id, `"${tr.zh}" is status:proposed but has attestations`)
      if (!tr.notes) err(t.id, `"${tr.zh}" is status:proposed but has no notes explaining why`)
    } else if (!tr.attestations.length) {
      warn(t.id, `"${tr.zh}" (${tr.status}) has no attestation`)
    }

    for (const a of tr.attestations) {
      if (!a.quote_zh) err(t.id, `attestation for "${tr.zh}" has no quote_zh`)
      if (!a.url) warn(t.id, `attestation for "${tr.zh}" has no url`)
      // Cheap fabrication tripwire: a real attestation quotes text that contains the
      // rendering it is evidence for. Latin-script renderings are exempt.
      if (a.quote_zh && /[一-鿿]/.test(tr.zh) && !a.quote_zh.includes(tr.zh))
        warn(t.id, `attestation quote for "${tr.zh}" does not contain that string`)
      attCount++
    }
  }
  t.attestation_count = attCount

  if (!t.preferred_zh && t.translations.length) {
    // fall back to the first non-deprecated, non-proposed rendering
    const best = t.translations.find((x) => !['proposed', 'deprecated'].includes(x.status))
      ?? t.translations[0]
    t.preferred_zh = best.zh
    warn(t.id, `no preferred_zh, defaulted to "${t.preferred_zh}"`)
  }
  if (!t.translations.length) warn(t.id, 'no translations at all')

  // SCHEMA.md: high confidence requires >=2 independent attestations on the preferred rendering
  const pref = t.translations.find((x) => x.zh === t.preferred_zh)
  if (t.confidence === 'high' && (pref?.attestations?.length ?? 0) < 2) {
    warn(t.id, 'confidence:high but preferred rendering has <2 attestations — downgraded to medium')
    t.confidence = 'medium'
  }
}

// reciprocal related links — an agent only ever sees its own category, so cross-category
// links arrive one-directional. Backfill both ways and drop danglers.
for (const t of terms) {
  t.related = [...new Set(t.related)].filter((r) => {
    if (r === t.id) return false
    if (!byId.has(r)) { warn(t.id, `related id "${r}" does not exist — dropped`); return false }
    return true
  })
}
for (const t of terms) {
  for (const r of t.related) {
    const other = byId.get(r)
    if (!other.related.includes(t.id)) other.related.push(t.id)
  }
}

// ---------------------------------------------------------------- coverage vs seed

const missing = seed.filter((s) => !byId.has(s.id))
const added = terms.filter((t) => !seed.some((s) => s.id === t.id))

// ---------------------------------------------------------------- emit

terms.sort((a, b) => a.en.toLowerCase().localeCompare(b.en.toLowerCase()))
for (const t of terms) delete t._source_file

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  categories,
  terms,
}

mkdirSync(p('site'), { recursive: true })
mkdirSync(p('exports'), { recursive: true })

writeFileSync(p('data', 'terms.json'), JSON.stringify(terms, null, 2) + '\n', 'utf8')
writeFileSync(
  p('site', 'terms-data.js'),
  '// GENERATED by scripts/build.mjs — do not edit. Source of truth: data/raw/*.json\n' +
    'window.VOCAB = ' + JSON.stringify(payload) + ';\n',
  'utf8',
)

// CSV for native-speaker review: one row per term, the fields a reviewer actually corrects.
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvRows = [
  ['id', 'en', 'preferred_zh', 'alt_zh', 'status', 'difficulty', 'confidence', 'attestations',
   'definition_en', 'definition_zh', 'pitfalls', 'REVIEWER_VERDICT', 'REVIEWER_SUGGESTED_ZH', 'REVIEWER_NOTES'],
  ...terms.map((t) => [
    t.id, t.en, t.preferred_zh ?? '',
    t.translations.filter((x) => x.zh !== t.preferred_zh).map((x) => x.zh).join(' / '),
    t.translations.find((x) => x.zh === t.preferred_zh)?.status ?? '',
    t.translation_difficulty, t.confidence, t.attestation_count,
    t.definition_en ?? '', t.definition_zh ?? '', t.pitfalls ?? '', '', '', '',
  ]),
]
writeFileSync(
  p('exports', 'terms.csv'),
  '﻿' + csvRows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n',
  'utf8',
)

// ---------------------------------------------------------------- report

const tally = (fn) => terms.reduce((m, t) => (m[fn(t)] = (m[fn(t)] ?? 0) + 1, m), {})
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')

console.log(`\nfiles      ${filesLoaded.join(', ') || '(none)'}`)
console.log(`terms      ${terms.length}  (seed had ${seed.length})`)
if (missing.length) console.log(`MISSING    ${missing.length}: ${missing.map((m) => m.id).join(', ')}`)
if (added.length) console.log(`added      ${added.length}: ${added.map((t) => t.id).join(', ')}`)
console.log(`confidence ${fmt(tally((t) => t.confidence))}`)
console.log(`difficulty ${fmt(tally((t) => t.translation_difficulty))}`)
console.log(`attested   ${terms.filter((t) => t.attestation_count > 0).length}/${terms.length} terms have >=1 attestation (${terms.reduce((n, t) => n + t.attestation_count, 0)} total)`)
console.log(`no ZH term ${terms.filter((t) => t.translations.every((x) => x.status === 'proposed') && t.translations.length).map((t) => t.en).join(', ') || '(none)'}`)

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`)
  for (const w of warnings.slice(0, 60)) console.log('  ! ' + w)
  if (warnings.length > 60) console.log(`  … ${warnings.length - 60} more`)
}
if (errors.length) {
  console.log(`\n${errors.length} ERROR(s):`)
  for (const e of errors) console.log('  x ' + e)
}

console.log(`\nwrote data/terms.json, site/terms-data.js, exports/terms.csv\n`)
if (STRICT && errors.length) process.exit(1)
