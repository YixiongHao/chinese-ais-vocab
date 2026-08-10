#!/usr/bin/env node
// Tests the extension's matching logic and checks the bundle is internally consistent.
//
//   node scripts/test-extension.mjs
//
// The DOM half of the content script (TreeWalker, MutationObserver, hover) is not
// exercised here — that needs a real browser, so it is verified by loading the unpacked
// extension. What IS tested is the part where the bugs actually live: which strings match,
// which do not, and whether the index and the card payload still agree with each other.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXT = join(ROOT, 'extension')
const fails = []
const ok = (cond, msg) => { if (!cond) fails.push(msg) }

// ---------------------------------------------------------------- load the bundle

const sandbox = {}
new Function('self', readFileSync(join(EXT, 'data', 'index.js'), 'utf8'))(sandbox)
new Function('self', readFileSync(join(EXT, 'src', 'matcher.js'), 'utf8'))(sandbox)
const INDEX = sandbox.CAISV_INDEX
const M = sandbox.CAISVMatcher
const cards = JSON.parse(readFileSync(join(EXT, 'data', 'cards.json'), 'utf8')).terms

ok(!!INDEX && !!M, 'index.js / matcher.js did not load')
ok(INDEX.ids.length === cards.length, `index has ${INDEX.ids.length} ids but cards.json has ${cards.length}`)
for (let i = 0; i < INDEX.ids.length; i++) {
  if (INDEX.ids[i] !== cards[i].i) { fails.push(`ordinal ${i}: index says "${INDEX.ids[i]}", cards say "${cards[i].i}"`); break }
}

// ---------------------------------------------------------------- manifest integrity

const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))
const workerSrc = readFileSync(join(EXT, 'src', 'background.js'), 'utf8')

// The content script is registered at runtime from the arrays in background.js, so the
// file list lives there rather than in the manifest. Pull it back out and check it.
const arrayLiteral = (name) => {
  const m = workerSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
const injectJs = arrayLiteral('INJECT_JS')
const injectCss = arrayLiteral('INJECT_CSS')
ok(!!injectJs && !!injectCss, 'background.js no longer declares INJECT_JS / INJECT_CSS')

const referenced = [
  manifest.background.service_worker,
  ...(injectJs || []),
  ...(injectCss || []),
  manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon),
  ...Object.values(manifest.icons),
]
for (const f of [...new Set(referenced)]) {
  ok(existsSync(join(EXT, f)), `referenced file is missing: ${f}`)
}
ok(manifest.manifest_version === 3, 'not manifest v3')
ok(!JSON.stringify(manifest).includes('"tabs"'), 'manifest requests the broad "tabs" permission')

// Site access is opt-in. Anything below re-introduces the install-time "read all your
// data on all websites" warning, which is the thing that puts the listing in slow review.
ok(!manifest.content_scripts, 'manifest declares static content_scripts — that is required host access')
ok(!manifest.host_permissions, 'manifest declares host_permissions — those are granted at install')
ok(Array.isArray(manifest.optional_host_permissions),
  'manifest is missing optional_host_permissions')
ok((manifest.permissions || []).includes('scripting'),
  'manifest is missing the "scripting" permission needed to register the content script')

// every JS file must parse
for (const f of ['src/matcher.js', 'src/content.js', 'src/background.js', 'popup.js', 'data/index.js']) {
  try { execFileSync(process.execPath, ['--check', join(EXT, f)], { stdio: 'pipe' }) }
  catch (e) { fails.push(`${f} is not valid JS: ${String(e.stderr).split('\n')[0]}`) }
}

// ---------------------------------------------------------------- matching

const zh = M.compile(INDEX, 'zh', { includeShort: false })
const zhShort = M.compile(INDEX, 'zh', { includeShort: true })
const en = M.compile(INDEX, 'en', {})
ok(zh && en, 'matchers failed to compile')

const idOf = (hit) => INDEX.ids[hit.ord]
const hits = (m, s) => M.find(m, s).map((h) => [h.text, idOf(h)])

function expect(m, text, wantIds, label) {
  const got = hits(m, text)
  const gotIds = got.map((g) => g[1])
  for (const w of wantIds) {
    if (!gotIds.includes(w)) fails.push(`${label}: expected to match "${w}" in ${JSON.stringify(text)}, got ${JSON.stringify(got)}`)
  }
}
function expectNone(m, text, label) {
  const got = hits(m, text)
  if (got.length) fails.push(`${label}: expected no match in ${JSON.stringify(text)}, got ${JSON.stringify(got)}`)
}

// English side
expect(en, 'Recent work on scalable oversight and reward hacking.', ['scalable-oversight', 'reward-hacking'], 'en basic')
expect(en, 'They trained it with RLHF and then SFT.', ['rlhf', 'supervised-fine-tuning'], 'en abbreviations')
expect(en, 'Sparse autoencoders reveal interpretable features.', ['sparse-autoencoder'], 'en plural')
expect(en, 'the paper studies Alignment Faking in production models', ['alignment-faking'], 'en case-insensitive')
// Longest-match: the phrase should win over its own prefix.
{
  const got = hits(en, 'we rely on chain-of-thought monitoring here')
  const ids = got.map((g) => g[1])
  ok(ids.includes('cot-monitoring'), `en longest-match: got ${JSON.stringify(got)}`)
}
// Word boundaries: a term must not match inside a longer word. ("scalable oversights" DOES
// match — that is the plural rule working, not a boundary failure.)
expectNone(en, 'a reevaluation of the benchmarking subsystem', 'en no mid-word match')
expectNone(en, 'nonalignment and misalignmentish coinages', 'en no affixed match')

// Chinese side
expect(zh, '近年来关于可扩展监督的研究越来越多。', ['scalable-oversight'], 'zh basic')
expect(zh, '该模型出现了奖励黑客行为。', ['reward-hacking'], 'zh basic 2')
expect(zh, '论文讨论了大模型的能力涌现。', ['big-model'], 'zh origin term')
expect(zh, '算法备案制度自2022年起实施。', ['algorithm-filing'], 'zh regulatory')

// Two-character terms are gated behind the setting, and must appear once it is on.
// (安全 is deliberately NOT a key — no entry's recommended rendering is the bare word;
// the entries are 人工智能安全 and 安保. 算力 is a real two-character key.)
{
  const off = hits(zh, '各地都在建设算力基础设施。')
  const on = hits(zhShort, '各地都在建设算力基础设施。')
  ok(!off.some((h) => h[0] === '算力'), `short gate off: 算力 should not match, got ${JSON.stringify(off)}`)
  ok(on.some((h) => h[0] === '算力'), `short gate on: 算力 should match, got ${JSON.stringify(on)}`)
  ok(Object.keys(INDEX.zh).indexOf('安全') === -1, 'bare 安全 should not be a match key')
}

// The mode is the reader's language, and it selects which script to hunt for. Nothing
// about the page is inspected — the old per-page heuristic is gone, and these cases pin
// down that a mixed page still yields exactly one script's worth of highlights.
ok(!M.detectDirection, 'detectDirection should be gone — the mode is the reader\'s, not the page\'s')

const FIND_FOR = { en: 'zh', zh: 'en' }        // must mirror content.js
ok(FIND_FOR.en === 'zh' && FIND_FOR.zh === 'en', 'reading English means hunting Chinese, and vice versa')

const MIXED = 'The Politburo readout says 自主可控, and researchers study scalable oversight and 可扩展监督.'
{
  // Reader reads English -> only the Chinese gets underlined.
  const hits = M.find(M.compile(INDEX, FIND_FOR.en, {}), MIXED)
  ok(hits.length > 0, 'English reader: expected Chinese matches in the mixed sentence')
  for (const h of hits) {
    ok(/[一-鿿]/.test(h.text), `English reader: underlined non-Chinese text "${h.text}"`)
  }
}
{
  // Reader reads Chinese -> only the English gets underlined.
  const hits = M.find(M.compile(INDEX, FIND_FOR.zh, {}), MIXED)
  ok(hits.length > 0, 'Chinese reader: expected English matches in the mixed sentence')
  for (const h of hits) {
    ok(!/[一-鿿]/.test(h.text), `Chinese reader: underlined Chinese text "${h.text}"`)
  }
}
{
  // The two modes must not both claim the same span of a mixed page.
  const a = M.find(M.compile(INDEX, 'zh', {}), MIXED).map((h) => h.text)
  const b = M.find(M.compile(INDEX, 'en', {}), MIXED).map((h) => h.text)
  ok(!a.some((x) => b.includes(x)), `the two modes overlap on: ${JSON.stringify(a.filter((x) => b.includes(x)))}`)
}
{
  // Matches within one mode must never nest or overlap.
  const hits = M.find(zh, '我们讨论可扩展监督与人工智能安全治理框架的关系。')
  for (let i = 1; i < hits.length; i++) {
    ok(hits[i].start >= hits[i - 1].end, `overlapping matches emitted: ${JSON.stringify(hits.map((h) => h.text))}`)
  }
}

// Card payload sanity: every ordinal a match can produce must resolve to a usable card.
const sampled = new Set()
for (const m of [zhShort, en]) for (const k of Object.keys(m.map)) sampled.add(m.map[k])
for (const ord of sampled) {
  const c = cards[ord]
  if (!c) { fails.push(`ordinal ${ord} has no card`); break }
  if (!c.e || !c.i) { fails.push(`card ${ord} missing en/id`); break }
}

// ---------------------------------------------------------------- report

const shortKeys = Object.keys(INDEX.zh).filter((k) => k.length <= 2).length
console.log(`bundle    ${cards.length} terms · ${Object.keys(INDEX.en).length} en keys · ${Object.keys(INDEX.zh).length} zh keys`)
console.log(`matchers  en=${en.size} zh=${zh.size} (+${shortKeys} short, opt-in)`)
console.log(`reachable ${sampled.size}/${cards.length} terms are reachable from at least one match key`)

if (fails.length) {
  console.log(`\n${fails.length} FAILURE(S):`)
  for (const f of fails.slice(0, 30)) console.log('  x ' + f)
  process.exit(1)
}
console.log('extension: all checks pass')
