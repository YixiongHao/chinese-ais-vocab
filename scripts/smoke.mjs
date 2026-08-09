#!/usr/bin/env node
// Asserts the invariants site/index.html relies on. The site has no build step and no
// tests of its own, so this stands in for both: if the data shape drifts, this fails
// loudly here rather than rendering a blank pane in someone's browser.
//
//   node scripts/smoke.mjs

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const terms = JSON.parse(readFileSync(join(ROOT, 'data', 'terms.json'), 'utf8'))
const categories = JSON.parse(readFileSync(join(ROOT, 'data', 'categories.json'), 'utf8'))
const catIds = new Set(categories.map((c) => c.id))

const fails = []
const check = (cond, msg) => { if (!cond) fails.push(msg) }

check(terms.length > 0, 'no terms at all')

// site/terms-data.js must be loadable as a plain script and expose window.VOCAB
const dataJs = readFileSync(join(ROOT, 'site', 'terms-data.js'), 'utf8')
check(dataJs.startsWith('//') || dataJs.includes('window.VOCAB ='), 'terms-data.js does not assign window.VOCAB')
const sandbox = { window: {} }
new Function('window', dataJs.replace(/^\/\/.*$/m, ''))(sandbox.window)
check(Array.isArray(sandbox.window.VOCAB?.terms), 'window.VOCAB.terms is not an array')
check(sandbox.window.VOCAB?.terms.length === terms.length, 'terms-data.js is stale vs terms.json — re-run build')

const ids = new Set()
for (const t of terms) {
  const at = (m) => `${t.id}: ${m}`
  check(!ids.has(t.id), at('duplicate id')); ids.add(t.id)
  check(typeof t.en === 'string' && t.en.length > 0, at('missing en'))
  check(catIds.has(t.category), at(`category "${t.category}" not in categories.json`))
  check(Array.isArray(t.translations), at('translations is not an array'))
  check(Array.isArray(t.en_renderings), at('en_renderings is not an array'))
  check(Array.isArray(t.related), at('related is not an array'))
  check(['low', 'medium', 'high'].includes(t.translation_difficulty), at('bad difficulty'))
  check(['low', 'medium', 'high'].includes(t.confidence), at('bad confidence'))

  const zhOrigin = t.direction === 'zh-to-en'
  if (zhOrigin) {
    check(!!t.zh_headword, at('zh-to-en with no zh_headword'))
    check(t.preferred_zh === t.zh_headword, at('preferred_zh should mirror zh_headword'))
    // The site's headline for these reads preferred_en; without it the pane shows "no
    // settled English rendering", which must be a real finding rather than a data gap.
    if (!t.preferred_en) check(t.en_renderings.length === 0, at('has en_renderings but no preferred_en'))
    for (const r of t.en_renderings) check(typeof r.en === 'string' && r.en, at('en_rendering with no en'))
  } else {
    for (const r of t.translations) check(typeof r.zh === 'string' && r.zh, at('translation with no zh'))
    if (t.preferred_zh) {
      check(t.translations.some((x) => x.zh === t.preferred_zh),
        at(`preferred_zh "${t.preferred_zh}" is not among translations — detail pane would show no recommended rendering`))
    }
  }

  // related links must resolve, or the Related pills render as dead buttons
  for (const r of t.related) check(ids.has(r) || terms.some((x) => x.id === r), at(`related "${r}" unresolved`))
}

const zhCount = terms.filter((t) => t.direction === 'zh-to-en').length
console.log(`${terms.length} terms (${zhCount} Chinese-origin) · ${categories.length} categories`)
if (fails.length) {
  console.log(`\n${fails.length} FAILURE(S):`)
  for (const f of fails.slice(0, 40)) console.log('  x ' + f)
  if (fails.length > 40) console.log(`  … ${fails.length - 40} more`)
  process.exit(1)
}
console.log('smoke: all site invariants hold')
