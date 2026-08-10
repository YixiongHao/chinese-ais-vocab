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

  // `mode` is the language the reader wants ANSWERS in, and it is a property of the
  // reader, not of the page. Answering in English means hunting for Chinese on the page;
  // answering in Chinese means hunting for English. Nothing about the page is inspected
  // or guessed — a page holding both scripts still gets exactly one of them highlighted,
  // because highlighting the language you already read is noise, not help.
  const FIND_FOR = { en: 'zh', zh: 'en' }

  let settings = { enabled: true, mode: 'en', includeShort: false }
  let answerIn = 'en'
  let matcher = null
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

  function highlightNode(node) {
    if (total >= MAX_TOTAL) return false
    const text = node.nodeValue
    const hits = CAISVMatcher.find(matcher, text)
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

  // Badge colours run green → amber → red as the evidence weakens, so the reliability of
  // an entry is legible before any of its text is read. The words alone do not carry it:
  // "common" sounds like praise but is a weaker claim than "established".
  const STATUS_HELP = {
    established: 'Widely used in Chinese sources; someone in the field will recognise it.',
    common: 'Appears repeatedly, but competes with other renderings.',
    contested: 'Several renderings in active use with no winner — the choice carries meaning.',
    descriptive: 'Chinese sources explain the concept in a phrase rather than with a fixed term.',
    proposed: 'Not attested anywhere. Our own coinage.',
    loanword: 'The English is kept as-is inside Chinese text. Often the honest answer.',
    transliteration: 'Phonetic rendering of the English.',
    deprecated: 'Attested, but we recommend against it.',
  }
  const CONF_HELP = {
    high: 'Two or more independent publishers verified for the recommended rendering.',
    medium: 'One citation, or several weak ones.',
    low: 'No citation, or the sources disagree and we made a judgement call.',
  }

  function renderCard(t) {
    // `answerIn` is the reader's language. The headline is always the half they do not
    // already have; what they hovered goes underneath as confirmation of what matched.
    const zhOrigin = t.g === 1
    const answerIsZh = answerIn === 'zh'
    const answer = answerIsZh
      ? (t.z || null)                            // hovered English -> answer in Chinese
      : (zhOrigin ? (t.n || t.e) : t.e)          // hovered Chinese -> answer in English
    const hovered = answerIsZh ? t.e : (t.z || t.e)
    // Pinyin belongs beside whichever line holds Chinese, in either mode — the reader
    // either has to pronounce the answer or the term they just hovered.
    const pinyin = t.p || null

    const badges = [
      t.s ? `<span class="b s-${esc(t.s)}" title="${esc(STATUS_HELP[t.s] || '')}">${esc(t.s)}</span>` : '',
      `<span class="b c-${esc(t.c)}" title="${esc(CONF_HELP[t.c] || '')}">${esc(t.c)} confidence</span>`,
      t.cites
        ? `<span class="b cite" title="Verbatim quotations from real sources backing this rendering.">${t.cites} citation${t.cites === 1 ? '' : 's'}</span>`
        : '<span class="b warn" title="Nothing in the database evidences this rendering yet.">no citation</span>',
      zhOrigin ? '<span class="b zh" title="Chinese is the source language here; the English is the approximation.">Chinese-origin</span>' : '',
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

    // The commentary sits last, after everything that is sourced. It is our own analysis,
    // not a citation, and putting it under a label that says so keeps the distinction
    // between evidence and opinion visible at a glance.
    const commentary = t.pit ? `
      <div class="sec">
        <div class="lbl cmt-lbl">Claude's commentary · not from a source</div>
        <div class="cmt">${esc(t.pit)}</div>
      </div>` : ''

    card.innerHTML = `
      <div class="hd">
        <div class="ans ${answerIsZh ? 'cjk' : ''}">${answer ? esc(answer) : '<em class="none">no settled rendering</em>'}</div>
        ${answerIsZh && pinyin ? `<div class="pin">${esc(pinyin)}</div>` : ''}
        <div class="from ${answerIsZh ? '' : 'cjk'}">${esc(hovered)}${t.a ? ` · ${esc(t.a)}` : ''}</div>
        ${!answerIsZh && pinyin ? `<div class="pin">${esc(pinyin)}</div>` : ''}
      </div>
      <div class="badges">${badges}</div>
      ${t.def ? `<div class="def">${esc(t.def)}</div>` : ''}
      ${src}${ex}${commentary}
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

  // Getting the card payload has two ways to fail, and both used to end in `return`,
  // which looks exactly like a broken extension: the underline is there, hovering does
  // nothing, no error anywhere a user would see.
  //
  //  1. The extension was reloaded while this page stayed open. The content script is
  //     orphaned, `chrome.runtime.id` is gone, and messaging throws. Only a page reload
  //     fixes it, so the card has to say that.
  //  2. The service worker did not answer — asleep, restarting, or its payload fetch
  //     failed. Recoverable: load the payload here instead.
  let localCards = null

  async function fetchCard(ord) {
    if (!chrome.runtime || !chrome.runtime.id) return { problem: 'stale' }

    try {
      const t = await chrome.runtime.sendMessage({ type: 'caisv-card', ord })
      if (t) return { term: t }
    } catch (e) {
      if (/context invalidated|Receiving end does not exist/i.test(e && e.message || '')) {
        if (!chrome.runtime.id) return { problem: 'stale' }
      }
    }

    try {
      if (!localCards) {
        localCards = fetch(chrome.runtime.getURL('data/cards.json'))
          .then((r) => r.json()).then((d) => d.terms)
          .catch((e) => { localCards = null; throw e })
      }
      const list = await localCards
      if (list && list[ord]) return { term: list[ord] }
    } catch (e) { /* fall through to the visible failure */ }

    return { problem: 'unavailable' }
  }

  function renderProblem(kind) {
    const body = kind === 'stale'
      ? `<div class="ans">Reload this page</div>
         <div class="def">The extension was updated or reloaded while this page was open,
         so the highlights on it are left over from the previous version and can no longer
         reach the database. Reloading the page restores them.</div>`
      : `<div class="ans">Definition unavailable</div>
         <div class="def">The extension could not load its database just now. Reloading the
         page usually fixes it; if it persists, the bundled data may be missing.</div>`
    card.innerHTML = body + `<div class="ft">AI Safety Terminology</div>`
  }

  async function showFor(el) {
    const ord = Number(el.dataset.caisv)
    if (!Number.isFinite(ord)) return
    ensureCard()
    clearTimeout(hideTimer)
    const key = ord + ':' + answerIn
    if (key === currentOrd && !card.hidden) { positionCard(el.getBoundingClientRect()); return }

    const got = await fetchCard(ord)
    currentOrd = key
    if (got.term) renderCard(got.term)
    else renderProblem(got.problem)
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
      const p = chrome.runtime.sendMessage({ type: 'caisv-count', count: n, answerIn })
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
    if (!settings.enabled) { teardown(); return }

    answerIn = settings.mode === 'zh' ? 'zh' : 'en'
    matcher = CAISVMatcher.compile(self.CAISV_INDEX, FIND_FOR[answerIn],
                                   { includeShort: settings.includeShort })
    if (!matcher) return

    processNodes(collectTextNodes(document.body), () => { report(total); watch() })
  }

  function load() {
    chrome.storage.sync.get({ enabled: true, mode: 'en', includeShort: false }, (s) => {
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
      respond({ count: total, answerIn, enabled: settings.enabled })
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
    .pin, .from, .exsrc, .ft, .exen { color: #9a9dab !important; }
    .def { color: #c9c8cc !important; }
    .b { border-color: #3a3d45; color: #a5a8b6; background: transparent; }
    .src { background: #24262c !important; color: #c1c3cc !important; }
    .ex { border-left-color: #3a3d45 !important; }
    .cmt { background: #2a1f1c !important; color: #e5c4ba !important; border-left-color: #e08b78 !important; }
    .cmt-lbl { color: #e08b78 !important; }
    /* Keep the green/amber/red grading legible on a dark ground rather than letting the
       generic dark override above flatten every badge to the same grey. */
    .b.s-established, .b.c-high { border-color: #6aa872 !important; color: #8dc294 !important; background: #1b2620 !important; }
    .b.s-common      { border-color: #93ad5f !important; color: #a9c37a !important; background: #1f2419 !important; }
    .b.s-contested, .b.c-medium { border-color: #d09a45 !important; color: #e0b66d !important; background: #2a2317 !important; }
    .b.s-proposed, .b.s-deprecated, .b.c-low, .b.warn { border-color: #d0685c !important; color: #e59183 !important; background: #2a1b19 !important; }
    .b.s-loanword    { border-color: #9c8ac8 !important; color: #b5a6db !important; background: #221f2c !important; }
    .b.zh            { border-color: #7aa2c4 !important; color: #9dbcd8 !important; background: #1a2029 !important; }
  }
  .cjk { font-family: "Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif; }
  .hd { margin-bottom: 8px; }
  .ans { font-size: 19px; font-weight: 650; line-height: 1.3; }
  .ans .none { font-size: 14px; font-weight: 400; color: #8b8fa3; }
  .from { font-size: 11.5px; color: #8b8fa3; margin-top: 3px; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .b { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; font-weight: 600;
       border: 1px solid #ddd9d2; color: #55596a; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
  /* Green = safe to use. Amber = check it. Red = weak or actively discouraged.
     Blue and violet are outside that scale: they classify rather than grade. */
  .b.s-established { border-color: #3f7d4a; color: #3f7d4a; background: #eef5ef; }
  .b.s-common      { border-color: #7a9a3f; color: #5d7a2c; background: #f2f5ea; }
  .b.s-contested   { border-color: #c07a1e; color: #a3660f; background: #fbf2e2; }
  .b.s-descriptive { border-color: #8b8fa3; color: #6c7080; }
  .b.s-transliteration { border-color: #8b8fa3; color: #6c7080; }
  .b.s-proposed    { border-color: #c0483c; color: #b03c31; background: #fbeceb; }
  .b.s-deprecated  { border-color: #c0483c; color: #b03c31; text-decoration: line-through; }
  .b.s-loanword    { border-color: #7d6aa8; color: #6d5a98; background: #f2eff8; }
  .b.c-high        { border-color: #3f7d4a; color: #3f7d4a; background: #eef5ef; }
  .b.c-medium      { border-color: #c07a1e; color: #a3660f; background: #fbf2e2; }
  .b.c-low         { border-color: #c0483c; color: #b03c31; background: #fbeceb; }
  .b.cite          { border-color: #ddd9d2; color: #55596a; }
  .b.warn          { border-color: #c0483c; color: #b03c31; background: #fbeceb; }
  .b.zh            { border-color: #5a7fa8; color: #4d7096; background: #eef2f7; }
  .pin { font-size: 12.5px; color: #6c7080; font-style: italic; margin-top: 2px; letter-spacing: .01em; }
  .def { font-size: 12.5px; color: #3f424f; margin-bottom: 8px; }
  .cmt-lbl { color: #a03e2f; }
  .cmt { font-size: 12px; background: #f6ece9; border-left: 3px solid #a03e2f;
         border-radius: 0 6px 6px 0; padding: 8px 10px; color: #6b3226; }
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
