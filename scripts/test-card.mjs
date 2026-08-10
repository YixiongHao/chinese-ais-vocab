#!/usr/bin/env node
// Runs extension/src/content.js against a DOM + chrome API stub and renders the hover
// card for every term, in both modes.
//
//   node scripts/test-card.mjs
//
// The card is built by string templates inside an async handler with no error boundary,
// so a single bad reference makes it fail silently: no card, no console error the user
// would notice. This test turns that into a loud failure.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXT = join(ROOT, 'extension')
const cards = JSON.parse(readFileSync(join(EXT, 'data', 'cards.json'), 'utf8')).terms

const errors = []
process.on('unhandledRejection', (e) => errors.push('unhandled rejection: ' + (e && e.stack || e)))

// ---------------------------------------------------------------- stubs

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    className: '', id: '', innerHTML: '', textContent: '', hidden: false,
    dataset: {}, style: { cssText: '', setProperty() {} }, children: [],
    offsetWidth: 320, offsetHeight: 240,
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, append(...k) { this.children.push(...k) },
    appendChild(k) { this.children.push(k); return k },
    setAttribute() {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 }),
    attachShadow() { this.shadow = makeEl('shadow'); return this.shadow },
    closest: () => null, querySelectorAll: () => [],
  }
  return el
}

const docListeners = {}
const document = {
  readyState: 'complete',
  documentElement: makeEl('html'),
  body: makeEl('body'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, nodeValue: t }),
  createDocumentFragment: () => makeEl('fragment'),
  createTreeWalker: () => ({ nextNode: () => null }),
  querySelectorAll: () => [],
  addEventListener(type, fn) { (docListeners[type] ??= []).push(fn) },
}
document.body.innerText = 'placeholder'

let storedSettings = { enabled: true, mode: 'en', includeShort: false }
const chrome = {
  storage: { sync: { get: (d, cb) => cb({ ...d, ...storedSettings }) }, onChanged: { addListener() {} } },
  runtime: {
    // A live extension context has an id; losing it is how the content script knows it
    // was orphaned by a reload. Omitting it here made every card silently become the
    // error card while the test still counted them as rendered.
    id: 'test-extension-id',
    getURL: (p) => 'chrome-extension://test/' + p,
    onMessage: { addListener() {} },
    sendMessage: (msg) => {
      if (msg && msg.type === 'caisv-card') return Promise.resolve(cards[msg.ord] || null)
      return Promise.resolve(undefined)
    },
  },
}

const window = { requestIdleCallback: null, __caisvLoaded: false }
const NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }
class MutationObserver { observe() {} disconnect() {} }

// ---------------------------------------------------------------- boot

const src = readFileSync(join(EXT, 'src', 'content.js'), 'utf8')
const matcherSrc = readFileSync(join(EXT, 'src', 'matcher.js'), 'utf8')
const indexSrc = readFileSync(join(EXT, 'data', 'index.js'), 'utf8')

const self = {}
new Function('self', indexSrc)(self)
new Function('self', matcherSrc)(self)

try {
  new Function(
    'document', 'window', 'chrome', 'NodeFilter', 'self', 'CAISVMatcher', 'MutationObserver',
    'setTimeout', 'clearTimeout', 'requestIdleCallback',
    src,
  )(document, window, chrome, NodeFilter, self, self.CAISVMatcher, MutationObserver,
    (fn) => { fn(); return 0 }, () => {}, (fn) => { fn({ timeRemaining: () => 50 }); return 0 })
} catch (e) {
  console.error('BOOT FAILED: ' + e.stack)
  process.exit(1)
}

const hover = docListeners.mouseover && docListeners.mouseover[0]
if (!hover) { console.error('no mouseover handler registered — the card can never open'); process.exit(1) }

// ---------------------------------------------------------------- exercise

async function renderAll(label, hover) {
  let rendered = 0, empty = 0
  for (let ord = 0; ord < cards.length; ord++) {
    // Find the shadow-root card element the script created, and blank it each round.
    const host = document.documentElement.children.find((c) => c.id === 'caisv-host')
    const card = host && host.shadow && host.shadow.children.find((c) => c.className === 'card')
    if (card) card.innerHTML = ''

    const mark = makeEl('mark')
    mark.dataset.caisv = String(ord)
    const fake = { target: { closest: (sel) => (sel.startsWith('mark') ? mark : null) } }
    try { hover(fake) } catch (e) { errors.push(`${cards[ord].i}: hover threw — ${e.message}`); continue }
    await new Promise((r) => setImmediate(r))

    const h2 = document.documentElement.children.find((c) => c.id === 'caisv-host')
    const c2 = h2 && h2.shadow && h2.shadow.children.find((c) => c.className === 'card')
    if (!c2) { errors.push(`${cards[ord].i}: no card element exists`); continue }
    if (!c2.innerHTML || c2.innerHTML.length < 40) { empty++; errors.push(`${cards[ord].i}: card empty (${(c2.innerHTML || '').length} chars)`); continue }
    // The card must actually contain THIS term. Length alone is not evidence: an error
    // card clears any length bar, which is how this test first passed while rendering
    // nothing but failures.
    if (!c2.innerHTML.includes(cards[ord].i)) {
      errors.push(`${cards[ord].i}: card rendered but does not identify this term — likely an error card`)
      continue
    }
    // Look for values leaking into markup, not for the words themselves — entry prose
    // legitimately contains "undefined" ("the load-bearing undefined term").
    if (/>\s*(undefined|null|NaN|\[object Object\])\s*</.test(c2.innerHTML) ||
        /="(undefined|null|NaN|\[object Object\])"/.test(c2.innerHTML))
      errors.push(`${cards[ord].i}: card markup leaks a broken value`)
    rendered++
  }
  console.log(`${label}: ${rendered}/${cards.length} cards rendered${empty ? `, ${empty} empty` : ''}`)
}

function cardEl() {
  const h = document.documentElement.children.find((c) => c.id === 'caisv-host')
  return h && h.shadow && h.shadow.children.find((c) => c.className === 'card')
}

async function hoverOnce(hoverFn, ord) {
  const c = cardEl(); if (c) c.innerHTML = ''
  const mark = makeEl('mark')
  mark.dataset.caisv = String(ord)
  hoverFn({ target: { closest: (sel) => (sel.startsWith('mark') ? mark : null) } })
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  return (cardEl() || {}).innerHTML || ''
}

// Boot a fresh copy of the content script under different settings. The script guards
// against double-injection, so the flag has to be cleared too.
function boot() {
  window.__caisvLoaded = false
  docListeners.mouseover = []
  docListeners.mouseout = []
  document.documentElement.children.length = 0
  new Function(
    'document', 'window', 'chrome', 'NodeFilter', 'self', 'CAISVMatcher', 'MutationObserver',
    'setTimeout', 'clearTimeout', 'requestIdleCallback', src,
  )(document, window, chrome, NodeFilter, self, self.CAISVMatcher, MutationObserver,
    (fn) => { fn(); return 0 }, () => {}, (fn) => { fn({ timeRemaining: () => 50 }); return 0 })
  return docListeners.mouseover[0]
}

await renderAll('English mode', hover)

// Both modes must render. The card chooses which language is the answer, so a bug can
// live in one branch and not the other.
storedSettings.mode = 'zh'
const hoverZh = boot()
await renderAll('Chinese mode', hoverZh)

// ---------------------------------------------------------------- failure paths
// These are what actually broke: both used to end in a bare `return`, leaving the
// underline present, the hover dead, and nothing anywhere saying why.

{
  const realSend = chrome.runtime.sendMessage
  chrome.runtime.sendMessage = () => Promise.resolve(null)      // worker answers nothing
  const html = await hoverOnce(hoverZh, 0)
  if (!html || html.length < 40) errors.push('worker-returns-null: card was blank instead of explaining')
  chrome.runtime.sendMessage = realSend
}
{
  const realId = chrome.runtime.id
  chrome.runtime.id = undefined                                  // extension reloaded under us
  // A different ordinal: the card caches by term+mode, so re-hovering the previous one
  // would short-circuit and show the stale render instead of re-fetching.
  const html = await hoverOnce(hoverZh, 1)
  if (!/Reload this page/.test(html))
    errors.push('stale-context: card did not tell the user to reload the page')
  chrome.runtime.id = realId
}

if (errors.length) {
  console.log(`\n${errors.length} FAILURE(S):`)
  for (const e of [...new Set(errors)].slice(0, 15)) console.log('  x ' + e)
  process.exit(1)
}
console.log('card: renders in both modes, and explains itself when the payload is unreachable')
