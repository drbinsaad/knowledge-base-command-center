import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  // Per-Library display profiles, guarded settings, cover rendering and versioned
  // portability add about 27.4 kB raw / 6.2 kB gzip JS and 5.0 kB raw / 0.9 kB
  // gzip CSS over 0.22.0. No runtime dependencies or bundled image assets added.
  { file: "main.js", raw: 1_205_000, gzip: 316_000 },
  { file: "styles.css", raw: 158_000, gzip: 22_000 },
];

for (const budget of budgets) {
  const info = await stat(budget.file);
  if (!info.isFile() || info.size === 0) throw new Error(`${budget.file} is missing or empty; run npm run build first.`);
  const gzipBytes = gzipSync(await readFile(budget.file), { level: 9 }).byteLength;
  if (info.size > budget.raw) throw new Error(`${budget.file} is ${info.size} bytes; raw budget is ${budget.raw} bytes.`);
  if (gzipBytes > budget.gzip) throw new Error(`${budget.file} is ${gzipBytes} gzip bytes; gzip budget is ${budget.gzip} bytes.`);
  process.stdout.write(`${budget.file}: ${info.size}/${budget.raw} raw bytes, ${gzipBytes}/${budget.gzip} gzip bytes.\n`);
}
