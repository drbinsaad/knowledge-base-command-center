import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  // Collections workflow + staged creation/Undo, scoped search, write guards,
  // and saved-note recovery add about 18 kB raw / 4.4 kB gzip over 0.23.1.
  // No runtime dependencies, image assets, or network capabilities are added.
  { file: "main.js", raw: 1_225_000, gzip: 322_000 },
  // Touch-sized membership choices/actions and tablet wrapping add ~1.6 kB raw.
  { file: "styles.css", raw: 163_000, gzip: 22_600 },
];

for (const budget of budgets) {
  const info = await stat(budget.file);
  if (!info.isFile() || info.size === 0) throw new Error(`${budget.file} is missing or empty; run npm run build first.`);
  const gzipBytes = gzipSync(await readFile(budget.file), { level: 9 }).byteLength;
  if (info.size > budget.raw) throw new Error(`${budget.file} is ${info.size} bytes; raw budget is ${budget.raw} bytes.`);
  if (gzipBytes > budget.gzip) throw new Error(`${budget.file} is ${gzipBytes} gzip bytes; gzip budget is ${budget.gzip} bytes.`);
  process.stdout.write(`${budget.file}: ${info.size}/${budget.raw} raw bytes, ${gzipBytes}/${budget.gzip} gzip bytes.\n`);
}
