// Copia o worker do encoder Ogg/Opus (opus-recorder) para public/opus/ para
// que seja servido na MESMA ORIGEM da app — Web Workers cross-origin são
// bloqueados pelo navegador. O .wasm vem embutido no próprio worker (não há
// arquivo .wasm separado para o encoder).
//
// Roda como passo do `dev`/`build` (ver package.json) em vez de pre/postinstall:
// determinístico, independe do flag enable-pre-post-scripts do pnpm, e
// re-sincroniza sozinho quando a versão da lib muda. public/opus/ é gitignored.

import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const publicOpusDir = join(__dirname, '..', 'public', 'opus')

// Só o encoder é necessário (gravação). O decoder do navegador toca ogg/opus
// nativamente, então não precisamos do decoderWorker.
const ASSETS = ['encoderWorker.min.js']

mkdirSync(publicOpusDir, { recursive: true })

for (const name of ASSETS) {
  const src = require.resolve(`opus-recorder/dist/${name}`)
  const dest = join(publicOpusDir, name)
  copyFileSync(src, dest)
  console.log(`[copy-opus-assets] ${name} → public/opus/`)
}
