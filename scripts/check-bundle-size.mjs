import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  // The reviewed safety, scoped-search, and progressive-disclosure build measures
  // about 1.13 MB raw / 295 kB gzip. Keep a small, explicit integration margin.
  { file: "main.js", raw: 1_140_000, gzip: 300_000 },
  { file: "styles.css", raw: 150_000, gzip: 20_500 },
];

for (const budget of budgets) {
  const info = await stat(budget.file);
  if (!info.isFile() || info.size === 0) throw new Error(`${budget.file} is missing or empty; run npm run build first.`);
  const gzipBytes = gzipSync(await readFile(budget.file), { level: 9 }).byteLength;
  if (info.size > budget.raw) throw new Error(`${budget.file} is ${info.size} bytes; raw budget is ${budget.raw} bytes.`);
  if (gzipBytes > budget.gzip) throw new Error(`${budget.file} is ${gzipBytes} gzip bytes; gzip budget is ${budget.gzip} bytes.`);
  process.stdout.write(`${budget.file}: ${info.size}/${budget.raw} raw bytes, ${gzipBytes}/${budget.gzip} gzip bytes.\n`);
}
