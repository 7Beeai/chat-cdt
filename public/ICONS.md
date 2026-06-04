# PWA icons

The PWA manifest (`manifest.webmanifest`) and the service worker (`sw.js`) reference these raster icons:

- `icon-192.png` — 192×192 PNG, transparent or solid bg.
- `icon-512.png` — 512×512 PNG, transparent or solid bg.
- `icon-maskable.png` — 512×512 PNG with safe area for Android maskable (padded content).
- `badge.png` — small monochrome PNG (~96×96) used as Android notification badge.

Estes ícones são gerados a partir de `bee.gif` (logo 7bee/CDT) pelo script
`scripts/gen-icons.mjs`. O `apple-touch-icon.png` (180×180) é usado pelo iOS.

## Regenerando os PNGs

```bash
pnpm add -D sharp   # se ainda não tiver
node scripts/gen-icons.mjs
```

Para trocar a imagem-fonte ou a cor de fundo, edite `SRC`/`BG` no topo do script.
`icon.svg` (balão de chat) continua disponível como glyph alternativo.

## What happens without them

- v1 will still run. Chrome desktop & Android will show a console warning ("Manifest: Icon resource is empty or invalid"), and the PWA install prompt will be unavailable.
- iOS Safari requires `apple-touch-icon` (180×180) and a real icon to allow Add-to-Home-Screen.
- Notifications still display — but with the OS default fallback icon.

Ship the PNGs before announcing PWA install.
