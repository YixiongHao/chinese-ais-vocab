// Term matching. Deliberately dependency-free and side-effect-free so the same file can
// run inside the content script and inside a Node test harness.
//
// Two directions, named by the language of the page you are reading:
//   dir "zh" — find Chinese terms (you are on a Chinese page; the card answers in English)
//   dir "en" — find English terms (you are on an English page; the card answers in Chinese)

;(function (root) {
  'use strict'

  const RE_ESC = /[.*+?^${}()|[\]\\]/g
  const esc = (s) => s.replace(RE_ESC, '\\$&')
  const HAS_CJK = /[一-鿿]/

  // Chinese renderings of two characters are usually ordinary vocabulary (安全, 对齐,
  // 评估). They are often the most important entries in the database and also the ones
  // that would carpet a page, so they are opt-in rather than dropped.
  const SHORT_ZH_LEN = 2

  /**
   * Compile an index direction into a matcher.
   * @param index  the generated CAISV_INDEX
   * @param dir    "zh" | "en"
   * @param opts   { includeShort?: boolean }
   */
  function compile(index, dir, opts) {
    opts = opts || {}
    const map = index[dir] || {}
    let keys = Object.keys(map)
    if (dir === 'zh' && !opts.includeShort) keys = keys.filter((k) => k.length > SHORT_ZH_LEN)
    if (!keys.length) return null

    // Keys arrive longest-first from the build, which makes regex alternation prefer the
    // most specific match ("chain of thought monitoring" over "chain of thought").
    const body = keys.map(esc).join('|')

    // Lookarounds rather than \b: several keys start or end with punctuation ("人工智能+",
    // "d/acc") where \b silently does the wrong thing.
    const re = dir === 'en'
      ? new RegExp('(?<![A-Za-z0-9_])(?:' + body + ')(?![A-Za-z0-9_])', 'gi')
      : new RegExp('(?:' + body + ')', 'g')

    return { dir, re, map, size: keys.length }
  }

  /**
   * Find every match in a string.
   * @returns [{ start, end, text, ord }] in document order, non-overlapping.
   */
  function find(matcher, text) {
    if (!matcher || !text) return []
    const out = []
    matcher.re.lastIndex = 0
    let m
    while ((m = matcher.re.exec(text)) !== null) {
      const hit = m[0]
      // The regex is case-insensitive on the English side; the index is lowercased.
      let ord = matcher.map[hit]
      if (ord === undefined && matcher.dir === 'en') ord = matcher.map[hit.toLowerCase()]
      if (ord === undefined) continue
      out.push({ start: m.index, end: m.index + hit.length, text: hit, ord })
      if (matcher.re.lastIndex === m.index) matcher.re.lastIndex++   // zero-width guard
    }
    return out
  }

  // There is deliberately no page-language detection here. An earlier version guessed a
  // single direction per page by comparing Han-character and Latin-letter counts, and was
  // wrong in both directions — a short Chinese sentence read as English, an English essay
  // quoting Chinese read as Chinese. The guess was never necessary: a matched string
  // already carries its own script, so direction is a property of each match, not of the
  // document. The content script runs both directions and labels each highlight.

  root.CAISVMatcher = { compile, find, HAS_CJK, SHORT_ZH_LEN }
})(typeof self !== 'undefined' ? self : globalThis)
