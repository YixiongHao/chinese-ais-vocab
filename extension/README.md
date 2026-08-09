# AI Safety Terminology — Chrome extension

Highlights terms from [the database](../README.md) as you browse, and shows a card on
hover with the translation, who has used that rendering, how certain it is, and a real
example sentence.

## Install it (unpacked)

The extension is not on the Chrome Web Store. To run it now:

1. Build the bundle (only needed if you changed the data):
   ```bash
   node scripts/build.mjs && node scripts/build-extension.mjs && node scripts/gen-icons.mjs
   ```
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and choose the `extension/` folder
5. Open any page with AI-safety content and look for dotted underlines

To highlight local files (`file:///…`), also open the extension's details page and enable
**Allow access to file URLs**. Chrome keeps that off by default.

## The two directions

Modes are named for the language of the page you are reading, and the card always answers
in the *other* language — the half you don't already have.

| Mode | Highlights | Card shows |
|---|---|---|
| **Chinese pages** | Chinese terms | English |
| **English pages** | English terms | Chinese |
| **Automatic** | whichever the page is written in | the other one |

Automatic looks at the ratio of Han characters to Latin letters in the page text. A page
that is substantively Chinese is treated as Chinese even when its navigation is English.

## Settings

- **Include two-character terms** — 对齐, 算力, 红线, 黑箱 and 59 others. These are among
  the most important entries in the database and also ordinary Chinese vocabulary, so a
  page with them enabled gets busy. Off by default.
- Any single term is highlighted at most **3 times per page**, and a page stops at **400**
  highlights. Seeing 智能体 underlined forty times teaches nobody anything.

Note that the bare word 安全 is deliberately *not* a match key — no entry's recommended
rendering is the bare word. The entries you want are 人工智能安全 and 安保.

## PDFs — no, and here is why

**Chrome's built-in PDF viewer cannot be highlighted by any extension**, this one included.

Chrome renders PDFs with PDFium inside an internal extension
(`mhjfbmdgcfjbbpaeojofohoefgiehjai`). The text is painted by the plugin rather than laid
out as DOM, and content scripts cannot be injected into another extension's pages. There
is no arrangement of permissions that gets around this — the text simply isn't reachable.

The popup detects when you are on a PDF and says so, rather than leaving you to conclude
the extension is broken.

**The route that would work**, if this becomes worth building: bundle
[PDF.js](https://mozilla.github.io/pdf.js/), register a viewer page inside this extension,
and redirect PDF navigations to it with `declarativeNetRequest`. PDF.js renders a real
text layer in the DOM, so the existing content script would highlight it unchanged. The
costs are honest ones — roughly 1.5 MB of vendored library, a fragile interaction with
Chrome's own viewer, and a redirect that users notice. It was not built here because it
could not be verified without a browser, and shipping unverified complexity into the one
path a user is most likely to try is a bad trade.

Two things that *do* work today: HTML pages served from anywhere, and local `.html` files
once file access is enabled.

## Privacy

The extension makes no network requests of any kind. The whole database is bundled inside
it, matching happens locally, and nothing about the pages you visit is transmitted,
logged, or stored anywhere. Settings live in `chrome.storage.sync`, which is Chrome's own
account sync.

Permissions requested:

| Permission | Why |
|---|---|
| `storage` | Remember your mode and coverage settings |
| `activeTab` | Read the current tab's URL when you open the popup, to detect PDFs |
| content scripts on `http`/`https`/`file` | Find and underline terms on the page you are reading |

## Publishing to the Chrome Web Store

This has to be done by a human with the developer account — see the parent README.

```bash
node scripts/package-extension.mjs     # produces dist/chinese-ais-vocab-<version>.zip
```

Then at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole):
register as a developer (one-time US$5), create a new item, upload the zip, fill in the
listing, and submit for review. Review typically takes a few days; extensions that request
broad host access take longer.

## Layout

```
manifest.json          MV3 manifest
data/index.js          GENERATED — match keys only (39 KB, loads on every page)
data/cards.json        GENERATED — hover-card payload (327 KB, loaded once in the worker)
src/matcher.js         compile an index direction into a regex; find matches; detect page language
src/content.js         walk the DOM, wrap matches, build and position the hover card
src/background.js      service worker; owns the card payload and the toolbar badge
src/highlight.css      the underline, written to sit quietly inside a host page
popup.html / popup.js  mode and coverage settings
icons/                 GENERATED by scripts/gen-icons.mjs
```

`data/` and `icons/` are generated. Everything else is source.

Run `node scripts/test-extension.mjs` after changing the matcher or the data — it checks
that the index and card payload still agree, that the manifest references files that
exist, and that a set of known strings match the terms they should.
