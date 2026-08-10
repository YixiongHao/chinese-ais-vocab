# Audit brief — semantic review of the terminology database

Read with `SCHEMA.md`. This brief governs audit passes; `RESEARCH-BRIEF.md` governs
research passes.

## Why this exists

An entry was found whose `id` said `specification-hacking`, whose English headword said
"evaluation gaming", and whose definition and Chinese rendering both described *evaluation
awareness* — a model noticing it is under test. Three parts of one entry describing three
different things. It was caught by a reader, not by any check.

A mechanical audit (`node scripts/audit-integrity.mjs`) now catches the structural version
of that. It cannot catch the semantic version: an entry that is internally consistent and
simply wrong about the field, or two entries that describe one concept in different words.
That is what an audit pass is for.

## What to check, per entry

1. **Do the parts agree?** `id`, `en`, `en_aliases`, `definition_en`, `definition_zh`, and
   the recommended rendering must all describe ONE concept. Where they disagree, work out
   which is right from the evidence *in the entry* — usually the definition and the
   citations are right and the headword drifted.
2. **Is the definition true to the field?** Not merely plausible. Would a researcher in
   that subfield accept it? Watch for definitions that describe a neighbouring concept,
   overclaim, or quietly merge two ideas with "or".
3. **Are the aliases real synonyms?** An alias must denote the SAME concept, not a related
   one. `causal tracing` for activation patching is fine. A neighbouring-but-distinct
   concept parked in `en_aliases` is how conflation starts.
4. **Is the recommended rendering the right choice** given the attestations actually
   present? Check that `preferred_zh` is not a rendering with weaker evidence than a
   sibling, and that a `deprecated` rendering is not recommended.
5. **Do the citations support what the entry claims?** Spot-check: does the quote contain
   the rendering, and does the surrounding claim match what the source is saying?
6. **Is `related` accurate?** Links should point to genuinely related concepts. A link to
   a concept that is actually the SAME thing is a merge candidate, not a link.
7. **Is the category right?**

## What counts as a finding

Report a finding when a reader would be misled. Do not report style, phrasing preferences,
or the mere absence of a citation — `confidence: low` with no citation is an honest state
this project uses deliberately, and is already tracked separately.

Severity:
- `wrong` — the entry states something false about the field, or its parts contradict.
- `conflated` — one entry covers two concepts, or an alias is a different concept.
- `duplicate` — another entry already covers this; name it.
- `weak` — defensible but the recommended rendering is not the best-evidenced option.

## Fixing versus reporting

**Fix in place** when the correction is determined by evidence already in the entry: a
headword that contradicts its own definition and citations, an alias that is plainly a
different concept, a `preferred_zh` pointing at weaker evidence than a sibling.

**Report without editing** when the fix needs a judgement across entries — merges, splits,
recategorisation, or anything requiring new research. Merging is never a solo decision:
two entries may look identical and exist because Chinese and English carve the concept
differently, which is exactly what this database is for.

Never invent a citation, and never delete a citation to make an entry tidier.

## Renaming an id

Ids are referenced by `related` links across files and by the site's URL fragments. If you
rename one, update every `related` reference to it in **your own files** and report the
rename prominently so cross-file references can be repointed.
