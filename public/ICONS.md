# PWA icons

The PWA manifest (`manifest.webmanifest`) and the service worker (`sw.js`) reference these raster icons:

- `icon-192.png` — 192×192 PNG, transparent or solid bg.
- `icon-512.png` — 512×512 PNG, transparent or solid bg.
- `icon-maskable.png` — 512×512 PNG with safe area for Android maskable (padded content).
- `badge.png` — small monochrome PNG (~96×96) used as Android notification badge.

These files are **not yet committed**. `icon.svg` in this folder is the source-of-truth glyph (a chat-bubble with three dots).

## Generating the PNGs

One-shot option (no install — uses Chrome under the hood):

```bash
pnpx pwa-asset-generator public/icon.svg public/ \
  --background "#ffffff" \
  --icon-only \
  --favicon \
  --maskable false
```

Then run again with `--maskable true --padding "20%"` to produce the maskable variant, and rename outputs to match the names above.

Alternatively use any vector-to-raster tool (Figma export, ImageMagick, Inkscape, `sharp`).

## What happens without them

- v1 will still run. Chrome desktop & Android will show a console warning ("Manifest: Icon resource is empty or invalid"), and the PWA install prompt will be unavailable.
- iOS Safari requires `apple-touch-icon` (180×180) and a real icon to allow Add-to-Home-Screen.
- Notifications still display — but with the OS default fallback icon.

Ship the PNGs before announcing PWA install.
