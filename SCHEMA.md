# Term schema

One JSON object per term. `data/terms.json` is the canonical array; the site and any
future browser extension both consume it. Nothing is computed at read time — if a field
is useful, it gets stored.

```jsonc
{
  // ---- identity ----
  "id": "instrumental-convergence",        // kebab-case, stable, never reused
  "en": "instrumental convergence",         // canonical English headword, lowercase unless proper noun
  "en_aliases": ["convergent instrumental goals", "instrumentally convergent subgoals"],
  "abbr": null,                             // "SFT", "RLHF", "ASI" — else null
  "category": "threat-models",              // one of the categories in data/categories.json
  "tags": ["agent-foundations", "classic"],

  // ---- meaning ----
  "definition_en": "1-3 sentences. Written for a bilingual reader who knows some ML but
                    may not know this subfield. No hedging, no 'refers to the idea that'.",
  "definition_zh": "同样 1-3 句，用中文母语者会写的话，而不是英文的逐字翻译。",

  // ---- the actual point of this project ----
  "preferred_zh": "工具性趋同",             // the one rendering we recommend using
  "translation_difficulty": "medium",       // low | medium | high
                                            // high = no settled Chinese rendering exists,
                                            // or the common one distorts the meaning
  "pitfalls": "Optional. What goes wrong in translation: false friends, connotation drift,
               a Chinese word that collapses two English distinctions, an established
               rendering that's actively misleading. Null if the term is unproblematic.",

  "translations": [
    {
      "zh": "工具性趋同",
      "pinyin": "gōngjùxìng qūtóng",
      "status": "established",              // see status vocabulary below
      "literal_back": "instrumental-ness converging",  // back-translation, when illuminating
      "notes": "Dominant in translated LessWrong/80k material; used by 安远AI.",
      "attestations": [
        {
          "quote_zh": "…原文中出现该词的完整句子…",
          "quote_en": "English gloss of that sentence.",
          "source_title": "《2024 年中国 AI 安全报告》",
          "publisher": "安远 AI (Concordia AI)",
          "source_type": "report",          // paper|report|blog|zhihu|podcast|github|gov|standard|media|wiki|forum
          "url": "https://…",
          "date": "2024-10"                 // YYYY or YYYY-MM, best available
        }
      ]
    }
  ],

  // ---- evidence status for the entry as a whole ----
  "confidence": "high",                     // high | medium | low — see below
  "used_by": [
    { "org": "安远 AI (Concordia AI)", "zh_used": "工具性趋同", "note": "in their AI safety primer" }
  ],

  // ---- usage ----
  "usage_examples": [
    { "zh": "如果模型足够强，工具性趋同会促使它设法获取更多资源。",
      "en": "If a model is capable enough, instrumental convergence pushes it to acquire more resources.",
      "source": "constructed" }             // "constructed" or a URL/citation if lifted from a real source
  ],

  // ---- graph ----
  "related": ["power-seeking", "mesa-optimization"],   // ids, both directions get filled at merge time

  // ---- provenance ----
  "sources": ["https://…"],                 // everything consulted, incl. English-side canonical refs
  "last_researched": "2026-08-08"
}
```

## `status` vocabulary (per translation)

| status | meaning |
|---|---|
| `established` | Widely used in Chinese sources; a reader in the field will recognise it. |
| `common` | Appears repeatedly but competes with other renderings. |
| `contested` | Multiple renderings in active use with no winner, and the choice carries meaning. |
| `descriptive` | Chinese sources explain the concept in a phrase rather than with a fixed term. |
| `proposed` | **We are coining or advocating this.** Not attested. Must carry `notes` explaining why. |
| `loanword` | English kept as-is in Chinese text (e.g. `SAE`, `scaling law`). Legitimate and common — record it. |
| `transliteration` | Phonetic rendering. |
| `deprecated` | Attested but we recommend against it; `notes` says why. |

A translation with `status: "proposed"` **must** have an empty `attestations` array and a
non-empty `notes`. A translation with any other status **should** have ≥1 attestation; if it
has zero, the entry's `confidence` cannot be `high`.

## `confidence` (per entry)

- `high` — preferred rendering has ≥2 independent attestations from credible sources.
- `medium` — 1 attestation, or several weak ones (forum posts, single blog).
- `low` — no attestation, or sources disagree and we've made a judgement call.

## Non-negotiables

1. **Never invent an attestation.** No fabricated quotes, publishers, dates, or URLs. If a
   quote can't be recovered verbatim, drop the attestation and lower `confidence`.
2. **A blank is better than a guess.** `null` / `[]` are valid answers everywhere.
3. **Simplified Chinese, PRC mainland usage** is the default. Taiwan/HK renderings only when
   they differ meaningfully, recorded as a separate translation entry with a `notes` flag.
4. **Record loanwords honestly.** If practitioners just say "SAE" in a Chinese sentence, that
   is the answer; a beautiful unused Chinese coinage is not.
