// Précompresse le client construit (Brotli + gzip) : le serveur sert directement ces variantes,
// sans compresser à chaque requête. Usage : node scripts/compress-dist.mjs [dossier]
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(process.argv[2] ?? 'client/dist');
const EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.map', '.webmanifest']);
const MIN_BYTES = 1024;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let before = 0;
let after = 0;
for await (const file of walk(root)) {
  if (!EXT.has(path.extname(file)) || (await stat(file)).size < MIN_BYTES) continue;
  const data = await readFile(file);
  const br = brotliCompressSync(data, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
  });
  await writeFile(`${file}.br`, br);
  await writeFile(`${file}.gz`, gzipSync(data, { level: 9 }));
  before += data.length;
  after += br.length;
}
console.log(`[compression] ${(before / 1e6).toFixed(2)} Mo → ${(after / 1e6).toFixed(2)} Mo (Brotli)`);
