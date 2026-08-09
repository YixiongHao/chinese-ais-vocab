// Shared text normalisation for comparing a Chinese rendering against the quote that is
// supposed to attest it. The comparison should be insensitive to typography that carries
// no meaning, and sensitive to everything that does.
//
// Deliberately NOT normalised: Simplified vs Traditional characters, and any character
// substitution. 权力/权利 and 机制/机械 differ by one character and mean different things —
// collapsing those would hide exactly the findings this project exists to record.

/** Fold away meaning-free typography so a rendering can be sought inside a quote. */
export function zhKey(s) {
  return String(s ?? '')
    .replace(/[《》〈〉「」『』【】（）()［］\[\]"'“”‘’]/g, '')  // title & quote brackets
    .replace(/[–—―ー－]/g, '-')                                  // dash variants → ASCII
    .replace(/[，。、；：！？]/g, '')                              // CJK punctuation
    .replace(/\s+/g, '')                                          // all whitespace
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>                          // fullwidth → ASCII
      String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
}

/**
 * Reduce a recorded rendering to the bare term: drop a trailing parenthetical gloss
 * ("稀疏自编码器（SAE）" → "稀疏自编码器") and keep only the first of a slash-list
 * ("蒸馏 / 知识蒸馏" → "蒸馏"). Research passes write both forms freely.
 */
export function bareZh(s) {
  const stripped = String(s ?? '').replace(/[（(][^）)]*[）)]\s*$/, '').trim()
  return stripped.split(/\s*[/／、]\s*/)[0].trim()
}

/** Does `quote` attest `zh`? Latin-only renderings are exempt — they are loanwords. */
export function attests(zh, quote) {
  if (!/[一-鿿]/.test(zh)) return true
  const k = zhKey(zh)
  return k.length > 0 && zhKey(quote).includes(k)
}
