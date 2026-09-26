import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgets = [
  // Collections workflow + staged creation/Undo, scoped search, write guards,
  // and saved-note recovery add about 18 kB raw / 4.4 kB gzip over 0.23.1.
  // No runtime dependencies, image assets, or network capabilities are added.
  // Multi-file attachments with any-type preview/link choice and pre-copy
  // checks add about 3.7 kB raw / 1.5 kB gzip over 0.24.0 (1,222,306 raw /
  // 321,154 gzip). Plain-language messages, command names, and the Run setup
  // again command add about 1.6 kB raw / 0.5 kB gzip on top of that. The
  // curated 0.25.0 What's new text adds about 1.2 kB raw / 0.45 kB gzip.
  // 0.26.0 adds the cache-only attachment projection, bounded/persisted divider,
  // accessible panel actions and compact disclosures. The initial integrated
  // candidate adds ~15.7 kB raw / 4.1 kB gzip over 0.25.1 (1,229,742 /
  // 323,923). Keep bounded feature headroom, no new runtime dependencies.
  { file: "main.js", raw: 1_250_000, gzip: 329_500 },
  // Touch-sized membership choices/actions and tablet wrapping add ~1.6 kB raw.
  // Compact disclosures, attachment rows and resizing add ~6 kB raw / 1 kB
  // gzip over 0.25.1 (162,088 / 22,375), including safe touch/focus states.
  { file: "styles.css", raw: 170_000, gzip: 23_700 },
];

for (const budget of budgets) {
  const info = await stat(budget.file);
  if (!info.isFile() || info.size === 0) throw new Error(`${budget.file} is missing or empty; run npm run build first.`);
  const gzipBytes = gzipSync(await readFile(budget.file), { level: 9 }).byteLength;
  if (info.size > budget.raw) throw new Error(`${budget.file} is ${info.size} bytes; raw budget is ${budget.raw} bytes.`);
  if (gzipBytes > budget.gzip) throw new Error(`${budget.file} is ${gzipBytes} gzip bytes; gzip budget is ${budget.gzip} bytes.`);
  process.stdout.write(`${budget.file}: ${info.size}/${budget.raw} raw bytes, ${gzipBytes}/${budget.gzip} gzip bytes.\n`);
}
