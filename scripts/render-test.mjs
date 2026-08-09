#!/usr/bin/env node
// Executes site/index.html's real client script against a minimal DOM stub and renders
// EVERY term's detail pane. Catches runtime errors and empty output that a syntax check
// and a data-shape check both miss — e.g. a field renamed on one side of the direction
// split. No browser, no dependencies.
//
//   node scripts/render-test.mjs

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8')
const dataJs = readFileSync(join(ROOT, 'site', 'terms-data.js'), 'utf8')

const inline = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
if (!inline.trim()) { console.error('no inline script found in index.html'); process.exit(1) }

// ---------------------------------------------------------------- DOM stub

const panes = {}
const docListeners = {}

function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', scrollTop: 0,
    dataset: {}, style: {}, _attrs: {},
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, focus() {}, blur() {}, scrollIntoView() {},
    setAttribute(k, v) { this._attrs[k] = v }, getAttribute(k) { return this._attrs[k] ?? null },
    closest: () => null,
  }
  panes[id] = el
  return el
}

const document = {
  documentElement: makeEl('html'),
  querySelector: (sel) => panes[sel] ?? makeEl(sel),
  querySelectorAll: () => [],
  addEventListener(type, fn) { (docListeners[type] ??= []).push(fn) },
}
const window = {}
const location = { hash: '' }
const history = { replaceState() {} }
const navigator = { clipboard: { writeText: () => Promise.resolve() } }
const matchMedia = () => ({ matches: false })
const setTimeout_ = () => 0

// ---------------------------------------------------------------- run

new Function('window', dataJs)(window)
const TERMS = window.VOCAB.terms

try {
  new Function(
    'document', 'window', 'location', 'history', 'navigator', 'matchMedia', 'setTimeout', 'clearTimeout',
    inline,
  )(document, window, location, history, navigator, matchMedia, setTimeout_, () => {})
} catch (e) {
  console.error('BOOT FAILED: ' + e.stack)
  process.exit(1)
}

const fails = []
const results = panes['#results']?.innerHTML ?? ''
if (!results.includes('class="row"')) fails.push('boot: #results rendered no rows')
if (!(panes['#filters']?.innerHTML ?? '').includes('data-cat=')) fails.push('boot: #filters rendered no category chips')
if (!(panes['#stat']?.textContent ?? '').length) fails.push('boot: #stat is empty')

// Drive the real delegated click handler once per term, exactly as a user click would.
const click = docListeners.click?.[0]
if (!click) fails.push('no document click handler registered')

let rendered = 0
for (const t of TERMS) {
  if (!click) break
  panes['#detail'].innerHTML = ''
  const fakeTarget = { closest: (sel) => (sel === '.row' ? { dataset: { id: t.id } } : null) }
  try {
    click({ target: fakeTarget })
  } catch (e) {
    fails.push(`${t.id}: threw while rendering — ${e.message}`)
    continue
  }
  const out = panes['#detail'].innerHTML
  if (!out || out.length < 80) { fails.push(`${t.id}: detail pane rendered ${out.length} chars`); continue }
  if (!out.includes('term-head')) { fails.push(`${t.id}: detail pane has no header`); continue }
  // Every entry must show its headword in the pane, in whichever language leads.
  const head = t.direction === 'zh-to-en' ? t.zh_headword : t.en
  if (head && !out.includes(head.replace(/&/g, '&amp;').replace(/</g, '&lt;')))
    fails.push(`${t.id}: headword "${head}" missing from rendered pane`)
  // Look for template leakage specifically, not the word — entry prose legitimately
  // discusses undefined terms ("'important data' remains the load-bearing undefined term").
  if (/>undefined<|>\s*undefined\s*<|="undefined"|>undefined<\//.test(out))
    fails.push(`${t.id}: rendered pane leaks "undefined" into the markup`)
  rendered++
}

console.log(`booted ok · ${(results.match(/class="row"/g) || []).length} rows listed · ${rendered}/${TERMS.length} detail panes rendered`)
if (fails.length) {
  console.log(`\n${fails.length} FAILURE(S):`)
  for (const f of fails.slice(0, 30)) console.log('  x ' + f)
  if (fails.length > 30) console.log(`  … ${fails.length - 30} more`)
  process.exit(1)
}
console.log('render: every term renders cleanly')
