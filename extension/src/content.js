// Finds database terms in the page, wraps them, and shows a card on hover.
//
// Constraints that shaped this file:
//  - It runs on every page, so nothing expensive happens before we know there is work.
//  - It must not fight the host page's CSS, so the card lives in a shadow root.
//  - It must not carpet a page: highlights are capped per term and in total.
//  - It must be undoable, because a user toggling the mode off expects the page back.

;(function () {
  'use strict'
  if (window.__caisvLoaded) return
  window.__caisvLoaded = true

  const HL = 'caisv-hl'
  const MAX_PER_TERM = 3        // seeing 安全 forty times teaches nobody anything
  const MAX_TOTAL = 400
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT',
                        'OPTION', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'])

  let settings = { enabled: true, mode: 'auto', includeShort: false }
  // Both directions can be live at once. A matched string already tells you its own
  // script, so each highlight carries its own direction and there is nothing to guess
  // about the page as a whole.
  let matchers = { zh: null, en: null }
  const perTerm = new Map()
  let total = 0
  let observer = null
  let rescanTimer = 0

  // ---------------------------------------------------------------- highlighting

  function skippable(node) {
    for (let p = node.parentNode; p && p !== document.body; p = p.parentNode) {
      if (p.nodeType !== 1) continue
      if (SKIP.has(p.tagName)) return true
      if (p.classList && p.classList.contains(HL)) return true
      if (p.isContentEditable) return true
      if (p.getAttribute && p.getAttribute('aria-hidden') === 'true') return true
    }
    return false
  }

  function collectTextNodes(root) {
    const out = []
    if (!root || (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11)) return out
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || n.nodeValue.length < 2) return NodeFilter.FILTER_REJECT
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let n
    while ((n = walker.nextNode())) out.push(n)
    return out
  }

  // Run whichever directions are live and merge the results. A text node can legitimately
  // contain both — "我们用 RLHF 做后训练" has a Chinese term and an English one — so the
  // two hit lists are merged and overlaps resolved longest-first rather than one winning
  // wholesale.
  function collectHits(text) {
    const all = []
    for (const dir of ['zh', 'en']) {
      const m = matchers[dir]
      if (!m) continue
      for (const h of CAISVMatcher.find(m, text)) { h.dir = dir; all.push(h) }
    }
    if (all.length < 2) return all
    all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
    const kept = []
    let end = -1
    for (const h of all) if (h.start >= end) { kept.push(h); end = h.end }
    return kept
  }

  function highlightNode(node) {
    if (total >= MAX_TOTAL) return false
    const text = node.nodeValue
    const hits = collectHits(text)
    if (!hits.length) return false
    if (skippable(node)) return false

    const frag = document.createDocumentFragment()
    let cursor = 0
    let used = 0

    for (const h of hits) {
      if (total >= MAX_TOTAL) break
      const seen = perTerm.get(h.ord) || 0
      if (seen >= MAX_PER_TERM) continue
      if (h.start < cursor) continue

      if (h.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, h.start)))
      const mark = document.createElement('mark')
      mark.className = HL
      mark.dataset.caisv = String(h.ord)
      mark.dataset.caisvDir = h.dir          // this match's own direction, not the page's
      mark.textContent = h.text
      frag.appendChild(mark)

      perTerm.set(h.ord, seen + 1)
      total++
      used++
      cursor = h.end
    }
    if (!used) return false
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
    node.parentNode.replaceChild(frag, node)
    return true
  }

  // Work in idle slices. A long Chinese article can hold thousands of text nodes and we
  // would rather take three frames than block one.
  function processNodes(nodes, done) {
    let i = 0
    const step = (deadline) => {
      while (i < nodes.length && total < MAX_TOTAL) {
        if (deadline && deadline.timeRemaining() <= 1 && i > 0) break
        const n = nodes[i++]
        if (n.parentNode) { try { highlightNode(n) } catch (e) { /* node went away */ } }
      }
      if (i < nodes.length && total < MAX_TOTAL) schedule(step)
      else if (done) done()
    }
    schedule(step)
  }
  const schedule = (fn) =>
    (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(() => fn(null), 16))

  function clearHighlights() {
    for (const el of document.querySelectorAll('mark.' + HL)) {
      const parent = el.parentNode
      if (!parent) continue
      parent.replaceChild(document.createTextNode(el.textContent), el)
      parent.normalize()
    }
    perTerm.clear()
    total = 0
  }

  // ---------------------------------------------------------------- the card

  let host = null, shadow = null, card = null, hideTimer = 0, showTimer = 0, currentOrd = -1

  function ensureCard() {
    if (host) return
    host = document.createElement('div')
    host.id = 'caisv-host'
    host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647'
    shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = CARD_CSS
    card = document.createElement('div')
    card.className = 'card'
    card.hidden = true
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer))
    card.addEventListener('mouseleave', scheduleHide)
    shadow.append(style, card)
    document.documentElement.appendChild(host)
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  function renderCard(t, direction) {
    // Direction decides which side is the answer, and it comes from the matched string
    // itself: if you hovered Chinese, you can already read the Chinese, so the useful
    // half is the English — and the reverse.
    const zhOrigin = t.g === 1
    const answer = direction === 'zh'
      ? (zhOrigin ? (t.n || t.e) : t.e)          // reading Chinese -> answer in English
      : (t.z || null)                            // reading English -> answer in Chinese
    const answerIsZh = direction === 'en'
    const sub = direction === 'zh'
      ? (t.z && t.z !== answer ? t.z : null)
      : (t.p || null)

    const badges = [
      t.s ? `<span class="b s-${esc(t.s)}">${esc(t.s)}</span>` : '',
      `<span class="b c-${esc(t.c)}">confidence: ${esc(t.c)}</span>`,
      t.cites ? `<span class="b">${t.cites} citation${t.cites === 1 ? '' : 's'}</span>` : '<span class="b warn">no citation</span>',
      zhOrigin ? '<span class="b zh">Chinese-origin</span>' : '',
    ].filter(Boolean).join('')

    const ex = t.x ? `
      <div class="sec">
        <div class="lbl">In use</div>
        <div class="ex${answerIsZh ? ' cjk' : ' cjk'}">${esc(t.x.z)}</div>
        ${t.x.e ? `<div class="exen">${esc(t.x.e)}</div>` : ''}
        ${t.x.s ? `<div class="exsrc">— ${esc(t.x.s)}</div>` : ''}
      </div>` : ''

    const src = t.u && t.u.length ? `
      <div class="sec">
        <div class="lbl">Used by</div>
        <div class="srcs">${t.u.map((u) => `<span class="src">${esc(u)}</span>`).join('')}</div>
      </div>` : ''

    card.innerHTML = `
      <div class="hd">
        <div class="ans ${answerIsZh ? 'cjk' : ''}">${answer ? esc(answer) : '<em class="none">no settled rendering</em>'}</div>
        ${sub ? `<div class="sub ${direction === 'zh' ? 'cjk' : ''}">${esc(sub)}</div>` : ''}
        <div class="from">${esc(direction === 'zh' ? (t.z || t.e) : t.e)}${t.a ? ` · ${esc(t.a)}` : ''}</div>
      </div>
      <div class="badges">${badges}</div>
      ${t.def ? `<div class="def">${esc(t.def)}</div>` : ''}
      ${t.pit ? `<div class="pit"><b>Pitfall.</b> ${esc(t.pit)}</div>` : ''}
      ${src}${ex}
      <div class="ft">${t.r > 1 ? `${t.r} renderings recorded · ` : ''}${esc(t.i)}</div>`
  }

  function positionCard(rect) {
    card.hidden = false
    card.style.visibility = 'hidden'
    card.style.left = '0px'; card.style.top = '0px'
    const cw = card.offsetWidth, ch = card.offsetHeight
    const pad = 8
    let left = rect.left + window.scrollX
    let top = rect.bottom + window.scrollY + pad
    if (left + cw > window.scrollX + document.documentElement.clientWidth - pad)
      left = window.scrollX + document.documentElement.clientWidth - cw - pad
    if (left < window.scrollX + pad) left = window.scrollX + pad
    // Flip above when there is no room below.
    if (rect.bottom + ch + pad * 2 > document.documentElement.clientHeight)
      top = rect.top + window.scrollY - ch - pad
    if (top < window.scrollY + pad) top = rect.bottom + window.scrollY + pad
    card.style.left = left + 'px'
    card.style.top = top + 'px'
    card.style.visibility = 'visible'
  }

  function scheduleHide() {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { if (card) { card.hidden = true; currentOrd = -1 } }, 180)
  }

  async function showFor(el) {
    const ord = Number(el.dataset.caisv)
    if (!Number.isFinite(ord)) return
    const dir = el.dataset.caisvDir === 'zh' ? 'zh' : 'en'
    ensureCard()
    clearTimeout(hideTimer)
    const key = ord + ':' + dir
    if (key === currentOrd && !card.hidden) { positionCard(el.getBoundingClientRect()); return }
    let t
    try {
      t = await chrome.runtime.sendMessage({ type: 'caisv-card', ord })
    } catch (e) { return }            // worker asleep or extension reloaded
    if (!t) return
    currentOrd = key
    renderCard(t, dir)
    positionCard(el.getBoundingClientRect())
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target && e.target.closest && e.target.closest('mark.' + HL)
    clearTimeout(showTimer)
    if (!el) return
    showTimer = setTimeout(() => showFor(el), 110)
  }, true)

  document.addEventListener('mouseout', (e) => {
    const el = e.target && e.target.closest && e.target.closest('mark.' + HL)
    if (el) { clearTimeout(showTimer); scheduleHide() }
  }, true)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card && !card.hidden) { card.hidden = true; currentOrd = -1 }
  })

  // ---------------------------------------------------------------- lifecycle

  function teardown() {
    if (observer) { observer.disconnect(); observer = null }
    clearHighlights()
    if (card) { card.hidden = true; currentOrd = -1 }
    report(0)
  }

  function report(n) {
    // sendMessage returns a promise in MV3; a sleeping or reloaded worker rejects it,
    // and an uncaught rejection here would surface as a page error on every navigation.
    try {
      const p = chrome.runtime.sendMessage({ type: 'caisv-count', count: n, mode: settings.mode })
      if (p && p.catch) p.catch(() => {})
    } catch (e) {}
  }

  function watch() {
    if (observer) observer.disconnect()
    observer = new MutationObserver((muts) => {
      if (total >= MAX_TOTAL) return
      let added = false
      for (const m of muts) {
        if (m.type !== 'childList') continue
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains(HL)) continue
          if (n.nodeType === 1 || n.nodeType === 3) { added = true; break }
        }
        if (added) break
      }
      if (!added) return
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(() => {
        const nodes = collectTextNodes(document.body)
        processNodes(nodes, () => report(total))
      }, 500)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function run() {
    if (!document.body) return
    clearHighlights()
    if (!settings.enabled || settings.mode === 'off') { teardown(); return }

    // "Automatic" means both directions at once. There is no page-level language to
    // guess: a mixed page gets its Chinese terms answered in English and its English
    // terms answered in Chinese, which is what a bilingual reader actually wants.
    const dirs = settings.mode === 'auto' ? ['zh', 'en'] : [settings.mode]
    matchers = { zh: null, en: null }
    for (const d of dirs) {
      matchers[d] = CAISVMatcher.compile(self.CAISV_INDEX, d, { includeShort: settings.includeShort })
    }
    if (!matchers.zh && !matchers.en) return

    processNodes(collectTextNodes(document.body), () => { report(total); watch() })
  }

  function load() {
    chrome.storage.sync.get({ enabled: true, mode: 'auto', includeShort: false }, (s) => {
      settings = s
      run()
    })
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    for (const k of Object.keys(changes)) settings[k] = changes[k].newValue
    run()
  })

  chrome.runtime.onMessage.addListener((msg, _s, respond) => {
    if (msg && msg.type === 'caisv-status') {
      const byDir = { zh: 0, en: 0 }
      for (const el of document.querySelectorAll('mark.' + HL)) {
        byDir[el.dataset.caisvDir === 'zh' ? 'zh' : 'en']++
      }
      respond({ count: total, byDir, mode: settings.mode,
                enabled: settings.enabled && settings.mode !== 'off' })
      return true
    }
    if (msg && msg.type === 'caisv-rescan') { run(); respond({ ok: true }); return true }
  })

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load)
  else load()

  // ---------------------------------------------------------------- card styles

  const CARD_CSS = `
  :host { all: initial; }
  .card {
    position: absolute; box-sizing: border-box;
    width: 340px; max-width: 92vw; max-height: 70vh; overflow-y: auto;
    background: #fbfaf8; color: #17181c; border: 1px solid #d9d6d0;
    border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.16);
    padding: 12px 14px 10px; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align: left;
  }
  @media (prefers-color-scheme: dark) {
    .card { background: #191a1e; color: #eceaea; border-color: #33353c; box-shadow: 0 8px 28px rgba(0,0,0,.5); }
    .sub, .from, .exsrc, .ft, .exen { color: #9a9dab !important; }
    .def { color: #c9c8cc !important; }
    .b { border-color: #3a3d45 !important; color: #a5a8b6 !important; }
    .src { background: #24262c !important; color: #c1c3cc !important; }
    .ex { border-left-color: #3a3d45 !important; }
    .pit { background: #2a1f1c !important; color: #e5c4ba !important; }
  }
  .cjk { font-family: "Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif; }
  .hd { margin-bottom: 8px; }
  .ans { font-size: 19px; font-weight: 650; line-height: 1.3; }
  .ans .none { font-size: 14px; font-weight: 400; color: #8b8fa3; }
  .sub { font-size: 12.5px; color: #6c7080; font-style: italic; margin-top: 1px; }
  .from { font-size: 11.5px; color: #8b8fa3; margin-top: 3px; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .b { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600;
       border: 1px solid #ddd9d2; color: #55596a; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
  .b.s-established { border-color: #4f8a55; color: #4f8a55; }
  .b.s-contested   { border-color: #c9762f; color: #c9762f; }
  .b.s-proposed    { border-color: #a03e2f; color: #a03e2f; }
  .b.s-deprecated  { text-decoration: line-through; }
  .b.s-loanword    { border-color: #7d6aa8; color: #7d6aa8; }
  .b.c-low         { border-color: #c9762f; color: #c9762f; }
  .b.warn          { border-color: #c0483c; color: #c0483c; }
  .b.zh            { border-color: #5a7fa8; color: #5a7fa8; }
  .def { font-size: 12.5px; color: #3f424f; margin-bottom: 8px; }
  .pit { font-size: 12px; background: #f6ece9; border-radius: 6px; padding: 7px 9px; margin-bottom: 8px; color: #6b3226; }
  .sec { margin-top: 9px; }
  .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: #8b8fa3; font-weight: 600; margin-bottom: 3px; }
  .srcs { display: flex; flex-wrap: wrap; gap: 4px; }
  .src { font-size: 11px; background: #efedE8; border-radius: 4px; padding: 1px 6px; color: #4a4d59; }
  .ex { border-left: 2px solid #e0ddd6; padding-left: 9px; font-size: 12.5px; }
  .exen { font-size: 11.5px; color: #8b8fa3; margin-top: 2px; }
  .exsrc { font-size: 10.5px; color: #a2a5b2; margin-top: 3px; }
  .ft { margin-top: 10px; padding-top: 7px; border-top: 1px solid #eae7e1; font-size: 10.5px; color: #a2a5b2; }
  `
})()
