import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assets = ["main.js", "manifest.json", "styles.css"];
const lines = [];
for (const asset of assets) {
  const digest = createHash("sha256").update(await readFile(asset)).digest("hex");
  lines.push(`${digest}  ${path.basename(asset)}`);
}
await writeFile("SHA256SUMS.txt", `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`Wrote SHA256SUMS.txt for ${assets.length} release assets.\n`);
