// Gera os ícones PWA a partir de public/bee.gif (primeiro quadro).
// Uso: node scripts/gen-icons.mjs
// Requer: sharp (devDependency)
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const SRC = path.join(pub, "bee.gif");
const BG = { r: 255, g: 255, b: 255, alpha: 1 }; // fundo branco

// Primeiro quadro da GIF, recortado/normalizado e nítido.
function frame(size) {
  return sharp(SRC, { page: 0 })
    .resize(size, size, { fit: "contain", background: BG })
    .flatten({ background: BG })
    .png();
}

// Ícone "any": abelha preenchendo o quadro.
async function plain(size, out) {
  await frame(size).toFile(path.join(pub, out));
  console.log("✓", out, `${size}x${size}`);
}

// Maskable: conteúdo dentro da safe area (~80%), resto preenchido com o fundo.
async function maskable(size, out, pad = 0.16) {
  const inner = Math.round(size * (1 - pad * 2));
  const bee = await sharp(SRC, { page: 0 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: bee, top: offset, left: offset }])
    .png()
    .toFile(path.join(pub, out));
  console.log("✓", out, `${size}x${size} (maskable)`);
}

// Badge de notificação: silhueta monocromática branca sobre transparente.
async function badge(size, out) {
  const bee = await sharp(SRC, { page: 0 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  // Usa o canal alpha da abelha como máscara branca.
  await sharp(bee)
    .ensureAlpha()
    .toColourspace("b-w")
    .negate({ alpha: false })
    .png()
    .toFile(path.join(pub, out));
  console.log("✓", out, `${size}x${size} (badge)`);
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
await plain(180, "apple-touch-icon.png");
await maskable(512, "icon-maskable.png");
await badge(96, "badge.png");

// Favicon .ico multi-resolução (16/32/48). sharp não exporta ICO, então
// montamos o container ICO manualmente com PNGs embutidos (aceito pelos browsers).
import { writeFileSync } from "node:fs";
async function favicon() {
  const sizes = [16, 32, 48];
  // O decoder de ICO do Next exige PNG em RGBA — flatten p/ branco e mantém alpha.
  const pngs = await Promise.all(
    sizes.map((s) =>
      sharp(SRC, { page: 0 })
        .resize(s, s, { fit: "contain", background: BG })
        .flatten({ background: BG })
        .ensureAlpha()
        .png()
        .toBuffer()
    )
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4); // count
  const entries = [];
  let offset = 6 + sizes.length * 16;
  pngs.forEach((png, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // width
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8); // size
    e.writeUInt32LE(offset, 12); // offset
    offset += png.length;
    entries.push(e);
  });
  const ico = Buffer.concat([header, ...entries, ...pngs]);
  writeFileSync(path.join(root, "app", "favicon.ico"), ico);
  console.log("✓", "app/favicon.ico", `(${sizes.join("/")} px)`);
}
await favicon();

console.log("\nPronto. Ícones gerados em public/.");
