// Service worker. Owns the card payload so the 327 KB of definitions, citations and
// examples is parsed once per worker lifetime rather than once per page.

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

// Warm the payload when the worker starts so the first hover is not the slow one.
chrome.runtime.onInstalled.addListener(() => { cards().catch(() => {}) })
chrome.runtime.onStartup.addListener(() => { cards().catch(() => {}) })
