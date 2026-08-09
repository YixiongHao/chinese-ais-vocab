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
import { attests, bareZh, zhKey } from './normalize.mjs'

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
const seed = [
  ...readJson(p('data', 'seed-terms.json')),
  ...(existsSync(p('data', 'seed-terms-zh.json')) ? readJson(p('data', 'seed-terms-zh.json')) : []),
]

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

  // Chinese-origin entries invert: the headword is Chinese and the renderings are English.
  // Validate whichever array this entry actually uses, under whichever key it uses.
  t.direction ??= 'en-to-zh'
  t.en_renderings ??= []
  t.why_no_english ??= null
  const ZH_ORIGIN = t.direction === 'zh-to-en'
  if (ZH_ORIGIN) {
    if (!t.zh_headword) err(t.id, 'direction is zh-to-en but no "zh_headword"')
    if (t.translations.length) warn(t.id, 'zh-to-en entry also has translations[] — ignored')
    t.preferred_zh = t.zh_headword
    if (!t.en_renderings.length) warn(t.id, 'zh-to-en entry has no en_renderings')
  }
  const RKEY = ZH_ORIGIN ? 'en' : 'zh'
  const renderings = ZH_ORIGIN ? t.en_renderings : t.translations

  let attCount = 0
  for (const tr of renderings) {
    tr.attestations ??= []
    tr.notes ??= null
    if (!tr[RKEY]) err(t.id, `rendering with no "${RKEY}"`)
    if (!VALID_STATUS.has(tr.status)) err(t.id, `bad status "${tr.status}" on ${tr[RKEY]}`)

    // Normalise the rendering. Research passes sometimes cram a slash-list of variants
    // or a parenthetical gloss into `zh`; the schema wants one bare rendering per entry.
    // Where variants exist, keep the one the attestations actually quote — that is the
    // one we have evidence for — and preserve the original in `notes` so nothing is lost.
    const rawZh = tr.zh
    const stripped = ZH_ORIGIN ? rawZh : String(rawZh).replace(/[（(][^）)]*[）)]\s*$/, '').trim()
    const variants = ZH_ORIGIN ? [] : stripped.split(/\s*[/／、]\s*/).map((s) => s.trim()).filter(Boolean)
    if (!ZH_ORIGIN && (variants.length > 1 || stripped !== rawZh)) {
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
      if (tr.attestations.length) err(t.id, `"${tr[RKEY]}" is status:proposed but has attestations`)
      if (!tr.notes) err(t.id, `"${tr[RKEY]}" is status:proposed but has no notes explaining why`)
    } else if (!tr.attestations.length) {
      warn(t.id, `"${tr[RKEY]}" (${tr.status}) has no attestation`)
    }

    for (const a of tr.attestations) {
      // Evidence for an English rendering is often an official English translation, which
      // has no Chinese sentence to quote. Require one side or the other, not specifically
      // the Chinese one.
      if (!a.quote_zh && !a.quote_en)
        err(t.id, `attestation for "${tr[RKEY]}" has neither quote_zh nor quote_en`)
      if (!ZH_ORIGIN && !a.quote_zh)
        err(t.id, `attestation for "${tr.zh}" has no quote_zh (required for a Chinese rendering)`)
      if (!a.url) warn(t.id, `attestation for "${tr[RKEY]}" has no url`)
      // Cheap fabrication tripwire: a real attestation quotes text containing the rendering
      // it is evidence for, ignoring meaning-free typography. Only meaningful for Chinese
      // renderings — a `descriptive` gloss is a paraphrase, not a string to find, and on a
      // zh-to-en entry the rendering is English while the quote is Chinese.
      if (a.quote_zh && !ZH_ORIGIN && tr.status !== 'descriptive' && !attests(tr.zh, a.quote_zh))
        warn(t.id, `attestation quote for "${tr.zh}" does not contain that string`)
      attCount++
    }
  }
  t.attestation_count = attCount

  const pickBest = (arr) =>
    arr.find((x) => !['proposed', 'deprecated'].includes(x.status)) ?? arr[0]

  if (ZH_ORIGIN) {
    // The English headword doubles as the recommended rendering unless one is marked better.
    if (!t.preferred_en && renderings.length) t.preferred_en = pickBest(renderings).en
  } else {
    if (!t.preferred_zh && renderings.length) {
      t.preferred_zh = pickBest(renderings).zh
      warn(t.id, `no preferred_zh, defaulted to "${t.preferred_zh}"`)
    }
    // preferred_zh is often recorded with a gloss ("RLHF（人类反馈强化学习）") while the
    // rendering itself got normalised to the bare term. Re-point it, or the site has no
    // recommended rendering to highlight.
    if (t.preferred_zh && !renderings.some((x) => x.zh === t.preferred_zh)) {
      const want = bareZh(t.preferred_zh)
      const hit = renderings.find((x) => x.zh === want)
        ?? renderings.find((x) => zhKey(x.zh) === zhKey(want))
        ?? renderings.find((x) => zhKey(t.preferred_zh).includes(zhKey(x.zh)))
      const was = t.preferred_zh
      t.preferred_zh = hit ? hit.zh : (renderings.length ? pickBest(renderings).zh : null)
      warn(t.id, `preferred_zh "${was}" matched no rendering — re-pointed to "${t.preferred_zh}"`)
    }
    if (!renderings.length) warn(t.id, 'no translations at all')
  }

  // SCHEMA.md: high confidence requires >=2 independent attestations on the preferred
  // rendering; an unattested rendering cannot be better than low. Enforced here rather
  // than trusted, because a research pass grades its own work optimistically.
  const pref = ZH_ORIGIN
    ? renderings.find((x) => x.en === t.preferred_en)
    : renderings.find((x) => x.zh === t.preferred_zh)
  const nPref = pref?.attestations?.filter((a) => !a.unverified).length ?? 0
  // Two citations from one publisher are one piece of evidence, not two.
  const nIndependent = new Set(
    (pref?.attestations ?? []).filter((a) => !a.unverified).map((a) => a.publisher || a.url),
  ).size
  if (t.confidence === 'high' && nIndependent < 2) {
    warn(t.id, `confidence:high but preferred rendering has ${nIndependent} independent verified attestation(s) — downgraded`)
    t.confidence = nPref > 0 ? 'medium' : 'low'
  } else if (t.confidence === 'medium' && nPref === 0 && pref && pref.status !== 'proposed') {
    warn(t.id, 'confidence:medium but preferred rendering is unattested — downgraded to low')
    t.confidence = 'low'
  }
  t.unverified_count = renderings.reduce(
    (n, tr) => n + (tr.attestations ?? []).filter((a) => a.unverified).length, 0)
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
  ...terms.map((t) => {
    const zhOrigin = t.direction === 'zh-to-en'
    const rs = zhOrigin ? t.en_renderings : t.translations
    const preferred = zhOrigin ? t.preferred_en : t.preferred_zh
    const k = zhOrigin ? 'en' : 'zh'
    return [
      t.id, t.en, zhOrigin ? t.zh_headword : (t.preferred_zh ?? ''),
      rs.filter((x) => x[k] !== preferred).map((x) => x[k]).join(' / '),
      rs.find((x) => x[k] === preferred)?.status ?? '',
      t.translation_difficulty, t.confidence, t.attestation_count,
      t.definition_en ?? '', t.definition_zh ?? '',
      t.pitfalls ?? t.why_no_english ?? '', '', '', '',
    ]
  }),
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
console.log(`direction  ${fmt(tally((t) => t.direction))}`)
const unnamed = (arr) => arr.length && arr.every((x) => x.status === 'proposed')
console.log(`no ZH term ${terms.filter((t) => t.direction !== 'zh-to-en' && unnamed(t.translations)).map((t) => t.en).join(', ') || '(none)'}`)
console.log(`no EN term ${terms.filter((t) => t.direction === 'zh-to-en' && unnamed(t.en_renderings)).map((t) => t.zh_headword).join(', ') || '(none)'}`)

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
