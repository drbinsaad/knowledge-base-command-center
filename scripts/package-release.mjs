import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const manifest = await readJson("manifest.json");
const packageJson = await readJson("package.json");
const versions = await readJson("versions.json");
const assets = ["main.js", "manifest.json", "styles.css"];

if (manifest.id !== "ent-vault-command-center") throw new Error(`Unexpected plugin ID: ${manifest.id || "missing"}`);
if (manifest.version !== packageJson.version) throw new Error(`Version mismatch: manifest ${manifest.version} / package ${packageJson.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error(`versions.json does not map ${manifest.version} to ${manifest.minAppVersion}`);
if (manifest.isDesktopOnly !== false) throw new Error("Release must remain mobile-compatible (isDesktopOnly: false).");

for (const asset of assets) {
  const assetPath = path.join(root, asset);
  const info = await stat(assetPath);
  if (!info.isFile() || info.size === 0) throw new Error(`Release asset is missing or empty: ${asset}`);
  const content = await readFile(assetPath, "utf8");
  if (/(?:\/Users\/|\/Volumes\/|(?:^|[\s"'(])[A-Za-z]:[\\/])/m.test(content)) throw new Error(`Release asset contains a local absolute path: ${asset}`);
}

const dist = path.join(root, "dist");
const baseName = `knowledge-base-command-center-${manifest.version}`;
const zipPath = path.join(dist, `${baseName}.zip`);
const checksumPath = `${zipPath}.sha256`;
await mkdir(dist, { recursive: true });
await rm(zipPath, { force: true });
await rm(checksumPath, { force: true });

const zip = spawnSync("/usr/bin/zip", ["-j", "-X", zipPath, ...assets.map((asset) => path.join(root, asset))], {
  cwd: root,
  encoding: "utf8",
});
if (zip.status !== 0) throw new Error(zip.stderr || zip.stdout || "zip failed");

const listing = spawnSync("/usr/bin/unzip", ["-Z1", zipPath], { encoding: "utf8" });
if (listing.status !== 0) throw new Error(listing.stderr || "Unable to inspect release ZIP.");
const entries = listing.stdout.trim().split("\n").filter(Boolean).sort();
const expected = [...assets].sort();
if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error(`Unexpected ZIP contents: ${entries.join(", ")}`);

const archive = await readFile(zipPath);
const checksum = createHash("sha256").update(archive).digest("hex");
await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`, "utf8");

process.stdout.write([
  `Created ${path.relative(root, zipPath)}`,
  `Contents: ${entries.join(", ")}`,
  `SHA-256: ${checksum}`,
  "Privacy check: no data.json, note content, or local absolute workspace paths included.",
].join("\n") + "\n");
