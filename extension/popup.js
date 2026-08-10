'use strict'

const $ = (s) => document.querySelector(s)
const DEFAULTS = { enabled: true, mode: 'auto', includeShort: false }

function paintStatus(text) { $('#status').textContent = text }

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function refreshStatus() {
  const tab = await activeTab()
  if (!tab) return paintStatus('No active tab.')

  // Chrome renders PDFs in a built-in viewer that content scripts cannot enter. Say so
  // here rather than letting the user conclude the extension is broken.
  const isPdf = /\.pdf(\?|#|$)/i.test(tab.url || '') || (tab.url || '').startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai')
  $('#pdf').style.display = isPdf ? 'block' : 'none'

  const restricted = /^(chrome|edge|about|devtools|chrome-extension):/i.test(tab.url || '')
  if (restricted && !isPdf) return paintStatus('Chrome blocks extensions on this page.')

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'caisv-status' })
    if (!res) throw new Error('no response')
    if (!res.enabled) return paintStatus('Off for this page.')
    if (!res.count) return paintStatus('No terms found on this page.')
    const b = res.byDir || { zh: 0, en: 0 }
    const parts = []
    if (b.zh) parts.push(`${b.zh} 中文→EN`)
    if (b.en) parts.push(`${b.en} EN→中文`)
    paintStatus(parts.join(' · ') || `${res.count} highlighted`)
  } catch (e) {
    paintStatus(isPdf ? 'Not available in the PDF viewer.' : 'Reload the page to start highlighting.')
  }
}

function apply(s) {
  $('#enabled').checked = s.enabled
  $('#includeShort').checked = s.includeShort
  const r = document.querySelector(`input[name="mode"][value="${s.mode}"]`)
  if (r) r.checked = true
}

function save(patch) {
  chrome.storage.sync.set(patch, () => setTimeout(refreshStatus, 350))
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  apply(s)
  refreshStatus()
})

$('#enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }))
$('#includeShort').addEventListener('change', (e) => save({ includeShort: e.target.checked }))
for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked) save({ mode: e.target.value }) })
}
