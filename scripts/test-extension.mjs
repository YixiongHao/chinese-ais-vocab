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
const referenced = [
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon),
  ...Object.values(manifest.icons),
]
for (const f of [...new Set(referenced)]) {
  ok(existsSync(join(EXT, f)), `manifest references missing file: ${f}`)
}
ok(manifest.manifest_version === 3, 'not manifest v3')
ok(!JSON.stringify(manifest).includes('"tabs"'), 'manifest requests the broad "tabs" permission')

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

// Mixed-script pages. There is no page-level language guess any more; both directions run
// and each match carries its own. These cases are exactly the ones the old heuristic got
// wrong, so they are pinned as the reason it was removed.
ok(!M.detectDirection, 'detectDirection should be gone — direction is per match, not per page')

function bothDirs(text) {
  const all = []
  for (const [dir, m] of [['zh', zhShort], ['en', en]]) {
    for (const h of M.find(m, text)) all.push({ ...h, dir })
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const kept = []
  let end = -1
  for (const h of all) if (h.start >= end) { kept.push(h); end = h.end }
  return kept
}

{
  // Chinese prose quoting English terms: both sides should be found.
  const hits = bothDirs('我们使用 RLHF 对模型进行后训练，并研究其可解释性。')
  const dirs = new Set(hits.map((h) => h.dir))
  ok(dirs.has('zh'), `mixed zh-dominant: expected a Chinese match, got ${JSON.stringify(hits.map((h) => [h.text, h.dir]))}`)
  ok(dirs.has('en'), `mixed zh-dominant: expected an English match (RLHF), got ${JSON.stringify(hits.map((h) => [h.text, h.dir]))}`)
}
{
  // English analysis quoting Chinese: the old heuristic called this page Chinese and
  // dropped every English term on it.
  const hits = bothDirs('The Politburo readout says 自主可控, which is about supply chains, not scalable oversight.')
  const dirs = new Set(hits.map((h) => h.dir))
  ok(dirs.has('en'), `mixed en-dominant: expected an English match, got ${JSON.stringify(hits.map((h) => [h.text, h.dir]))}`)
  ok(dirs.has('zh'), `mixed en-dominant: expected a Chinese match, got ${JSON.stringify(hits.map((h) => [h.text, h.dir]))}`)
}
{
  // Overlap resolution: a match must never be emitted inside another match.
  const hits = bothDirs('我们讨论可扩展监督与人工智能安全治理框架的关系。')
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
