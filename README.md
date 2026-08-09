# AI Safety Terminology · English ↔ 中文

A vocabulary database for people doing AI safety work across the English/Chinese language
boundary. The premise: much of the language English-language AI safety uses — especially
around existential risk, loss of control, and misalignment — either has no settled Chinese
rendering, has several competing ones, or has an established one that quietly distorts the
concept. This project records which of those three situations each term is in, **with
evidence**.

MVP scope: ~165 terms across 9 categories, English-facing. A Chinese-facing view and a
browser extension that highlights terms in place are the intended next steps; the data
format is built for both.

## Layout

```
data/
  categories.json     the 9 categories
  seed-terms.json     the term list + research leads (input to the research pass)
  raw/<category>.json per-category research output — EDIT THESE
  terms.json          GENERATED — canonical merged database
site/
  index.html          the site: search, filter, term detail. Open it directly.
  terms-data.js       GENERATED — data/terms.json wrapped for file:// loading
exports/
  terms.csv           GENERATED — flat sheet for native-speaker review passes
scripts/
  build.mjs           merge + validate + emit
SCHEMA.md             the term schema. Binding — read before editing data.
RESEARCH-BRIEF.md     methodology and source list handed to research agents.
```

## Use it

```bash
node scripts/build.mjs      # merge data/raw/*.json → terms.json, site data, CSV
```

Then open `site/index.html` in a browser. No server, no build step, no dependencies —
`terms-data.js` is a plain script tag, which is why the site works over `file://`.

`build.mjs --strict` exits non-zero on schema errors; wire it into CI when there is one.

## Editing

`data/raw/*.json` are the files humans edit. `data/terms.json`, `site/terms-data.js` and
`exports/terms.csv` are generated — never hand-edit them, they get overwritten.

The build enforces the rules in `SCHEMA.md`: valid status values, `proposed` renderings
must justify themselves and carry no attestations, `high` confidence requires two
independent citations on the recommended rendering, `related` links resolve and are made
reciprocal. It also flags any attestation whose quote does not literally contain the
rendering it's cited as evidence for — a cheap tripwire against fabricated citations,
which are the one failure mode that would make this database worse than useless.

For a native-speaker review round: hand out `exports/terms.csv`, which carries three empty
`REVIEWER_*` columns, and fold corrections back into `data/raw/*.json`.

## What the data is good for beyond the site

`data/terms.json` is a plain array with stable `id`s and no site-specific structure. A
browser extension can load it directly, match on `en` / `en_aliases` / `abbr` / every
`translations[].zh`, and deep-link to `site/index.html#<id>`, which the site honours.

## Honesty rules

Attestations are real quotes from real pages, or they are absent. An entry marked
`confidence: low` with no citation is a correct and useful answer; a fabricated citation
is not. Where a concept has no Chinese term at all, that is recorded as a finding
(`status: "proposed"` plus reasoning) rather than papered over with a plausible-looking
coinage nobody uses.
