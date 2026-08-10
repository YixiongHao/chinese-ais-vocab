// Service worker. Two jobs:
//
//  1. Own the card payload, so the 327 KB of definitions, citations and examples is
//     parsed once per worker lifetime rather than once per page.
//  2. Own site access. The extension ships with no host permissions at all. The user
//     grants a site (or all sites) from the popup, and this worker registers the content
//     script for exactly the origins that were granted.
//
// Nothing here runs on a page the user did not opt into.

const CARDS_URL = chrome.runtime.getURL('data/cards.json')
let cardsPromise = null

function cards() {
  if (!cardsPromise) {
    cardsPromise = fetch(CARDS_URL)
      .then((r) => r.json())
      .then((d) => d.terms)
      .catch((e) => { cardsPromise = null; throw e })
  }
  return cardsPromise
}

// ---------------------------------------------------------------- site access

// The content script, as a list rather than a manifest block, because it is now injected
// dynamically. scripts/test-extension.mjs parses these two arrays — keep them literal.
const INJECT_JS = ['data/index.js', 'src/matcher.js', 'src/content.js']
const INJECT_CSS = ['src/highlight.css']

const SCRIPT_ID = 'caisv-main'
const INJECTABLE = /^(https?|file):/

const grantedOrigins = () =>
  chrome.permissions.getAll().then((p) => (p.origins || []).filter((o) => INJECTABLE.test(o)))

// Register the content script for every granted origin, and only those. Called on
// install, on startup, and whenever a permission is added or removed. Registration
// persists across sessions, so it is always torn down before it is rebuilt.
async function syncRegistration() {
  const origins = await grantedOrigins()

  const existing = await chrome.scripting
    .getRegisteredContentScripts({ ids: [SCRIPT_ID] })
    .catch(() => [])
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {})
  }

  if (!origins.length) return
  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    matches: origins,
    js: INJECT_JS,
    css: INJECT_CSS,
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  }]).catch(() => {})
}

// Registration only affects the next navigation. A user who grants access expects the
// page in front of them to light up, so inject into whatever is already open.
async function injectExistingTabs(origins) {
  if (!origins.length) return
  const tabs = await chrome.tabs.query({ url: origins }).catch(() => [])
  for (const tab of tabs) {
    if (!tab.id) continue
    const target = { tabId: tab.id }
    chrome.scripting.insertCSS({ target, files: INJECT_CSS }).catch(() => {})
    chrome.scripting.executeScript({ target, files: INJECT_JS }).catch(() => {})
  }
}

chrome.permissions.onAdded.addListener((p) => {
  const origins = (p.origins || []).filter((o) => INJECTABLE.test(o))
  syncRegistration().then(() => injectExistingTabs(origins)).catch(() => {})
})

// Highlights already on a page survive until it reloads. Chrome gives no way to reach
// into a page the extension no longer has permission for, which is the point of revoking.
chrome.permissions.onRemoved.addListener(() => { syncRegistration().catch(() => {}) })

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg) return

  if (msg.type === 'caisv-card') {
    cards()
      .then((list) => respond(list[msg.ord] || null))
      .catch(() => respond(null))
    return true                       // keep the channel open for the async respond
  }

  if (msg.type === 'caisv-count' && sender.tab) {
    const n = msg.count | 0
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: n ? String(n) : '' })
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#a03e2f' })
    const ARROW = msg.answerIn === 'zh' ? 'English → 中文' : '中文 → English'
    chrome.action.setTitle({
      tabId: sender.tab.id,
      title: n
        ? `${n} term${n === 1 ? '' : 's'} highlighted — ${ARROW}`
        : 'AI Safety Terminology — no terms found on this page',
    })
    return false
  }
})

// Warm the payload when the worker starts so the first hover is not the slow one, and
// make sure registration matches the permissions Chrome actually remembers.
function boot() {
  cards().catch(() => {})
  syncRegistration().catch(() => {})
}
chrome.runtime.onInstalled.addListener(boot)
chrome.runtime.onStartup.addListener(boot)
