# Chrome Web Store assets

Listing images for the extension. Nothing here ships inside the extension package.

```
screenshots/
  01-prompt-injection.png        1280x800, 24-bit PNG — upload these
  02-capability-elicitation.png  1280x800, 24-bit PNG
  source/                        the raw captures, kept so they can be refitted
```

## Store requirements

| Asset | Requirement |
|---|---|
| Screenshot | exactly 1280x800 or 640x400, JPEG or 24-bit PNG, 1 to 5 of them |
| Store icon | 128x128 — use `extension/icons/icon128.png` |

24-bit means RGB with no alpha channel. A 32-bit RGBA PNG is rejected.

## How the fitted files were made

Neither capture is 16:10. Each one was scaled down to fit inside 1280x800 and then
centred on a canvas filled with the capture's own corner colour, which is white in both
cases. The padding is invisible against the white page background.

Padding was chosen over cropping because a 16:10 crop of `01` cuts the chart in half.

To refit after replacing a source file, scale it to fit and centre it on a 1280x800
white canvas. Any image editor does this. Save as PNG without an alpha channel.
