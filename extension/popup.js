'use strict'

const $ = (s) => document.querySelector(s)
const DEFAULTS = { enabled: true, mode: 'en', includeShort: false }

// Granting these two is what "all sites" means. file:///* is deliberately not in here —
// Chrome refuses to grant file access through a permission prompt. It is a toggle on the
// extension's details page and nothing else can turn it on.
const ALL_ORIGINS = ['http://*/*', 'https://*/*']

// Resolved once, before the user can click anything. chrome.permissions.request must be
// called straight out of a click handler, so nothing may be awaited inside one.
let tab = null
let siteOrigin = null       // "https://example.com/*", or null where access cannot apply
let siteLabel = ''
let isPdf = false
let isFile = false
let restricted = false

function paintStatus(text) { $('#status').textContent = text }

// ---------------------------------------------------------------- access

function show(id, on) { $(id).style.display = on ? 'inline-block' : 'none' }

async function refreshAccess() {
  const hasAll = await chrome.permissions.contains({ origins: ALL_ORIGINS }).catch(() => false)
  const hasSite = siteOrigin
    ? await chrome.permissions.contains({ origins: [siteOrigin] }).catch(() => false)
    : false

  let state
  if (hasAll) state = 'Running on <b>all sites</b>.'
  else if (hasSite) state = `Running on <b>${siteLabel}</b>.`
  else if (restricted) state = 'Chrome blocks extensions on this page.'
  else if (isFile) state = 'Local files need <b>Allow access to file URLs</b> on the extension’s details page.'
  else if (siteOrigin) state = `Not running on <b>${siteLabel}</b>.`
  else state = 'No page to enable here.'
  $('#accessState').innerHTML = state

  show('#grantSite', !hasAll && !hasSite && !!siteOrigin && !isFile)
  show('#grantAll', !hasAll && !restricted)
  show('#revokeSite', !hasAll && hasSite)
  show('#revokeAll', hasAll)

  return hasAll || hasSite
}

// Callback form on purpose. An `await` before the request would spend the user gesture
// and Chrome would reject the prompt.
$('#grantSite').addEventListener('click', () => {
  if (!siteOrigin) return
  chrome.permissions.request({ origins: [siteOrigin] }, () => setTimeout(reload, 200))
})
$('#grantAll').addEventListener('click', () => {
  chrome.permissions.request({ origins: ALL_ORIGINS }, () => setTimeout(reload, 200))
})
$('#revokeSite').addEventListener('click', () => {
  if (!siteOrigin) return
  chrome.permissions.remove({ origins: [siteOrigin] }, () => setTimeout(reload, 200))
})
$('#revokeAll').addEventListener('click', () => {
  chrome.permissions.remove({ origins: ALL_ORIGINS }, () => setTimeout(reload, 200))
})

// ---------------------------------------------------------------- page status

async function refreshStatus(hasAccess) {
  if (!tab) return paintStatus('No active tab.')
  if (restricted && !isPdf) return paintStatus('Chrome blocks extensions on this page.')
  if (isPdf) return paintStatus('Not available in the PDF viewer.')
  if (!hasAccess) return paintStatus('Not enabled for this page.')

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'caisv-status' })
    if (!res) throw new Error('no response')
    if (!res.enabled) return paintStatus('Off for this page.')
    const arrow = res.answerIn === 'zh' ? 'English → 中文' : '中文 → English'
    paintStatus(res.count ? `${res.count} highlighted · ${arrow}` : `No terms found · ${arrow}`)
  } catch (e) {
    paintStatus('Reload the page to start highlighting.')
  }
}

// ---------------------------------------------------------------- settings

function apply(s) {
  $('#enabled').checked = s.enabled
  $('#includeShort').checked = s.includeShort
  const r = document.querySelector(`input[name="mode"][value="${s.mode}"]`)
  if (r) r.checked = true
}

function save(patch) {
  chrome.storage.sync.set(patch, () => setTimeout(reload, 350))
}

$('#enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }))
$('#includeShort').addEventListener('change', (e) => save({ includeShort: e.target.checked }))
for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked) save({ mode: e.target.value }) })
}

// ---------------------------------------------------------------- boot

async function reload() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true })
  tab = t || null
  const url = (tab && tab.url) || ''

  // Chrome renders PDFs in a built-in viewer that content scripts cannot enter. Say so
  // here rather than letting the user conclude the extension is broken.
  isPdf = /\.pdf(\?|#|$)/i.test(url) ||
    url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai')
  isFile = url.startsWith('file:')
  restricted = /^(chrome|edge|about|devtools|chrome-extension):/i.test(url)

  siteOrigin = null
  siteLabel = ''
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      siteOrigin = `${u.protocol}//${u.hostname}/*`
      siteLabel = u.hostname
    }
  } catch (e) { /* no usable URL — the buttons stay hidden */ }

  $('#pdf').style.display = isPdf ? 'block' : 'none'

  const hasAccess = await refreshAccess()
  await refreshStatus(hasAccess)
}

chrome.storage.sync.get(DEFAULTS, (s) => { apply(s); reload() })
