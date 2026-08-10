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

const powershellQuote = (value) => `'${value.replaceAll("'", "''")}'`;
const zip = process.platform === "win32"
  ? spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -LiteralPath ${assets.map((asset) => powershellQuote(path.join(root, asset))).join(",")} -DestinationPath ${powershellQuote(zipPath)} -Force`,
    ], { cwd: root, encoding: "utf8" })
  : spawnSync("zip", ["-j", "-X", zipPath, ...assets.map((asset) => path.join(root, asset))], {
      cwd: root,
      encoding: "utf8",
    });
if (zip.status !== 0) throw new Error(zip.stderr || zip.stdout || "zip failed");

const archive = await readFile(zipPath);
const minimumEocdSize = 22;
const maximumZipCommentSize = 0xffff;
let eocdOffset = -1;
for (
  let offset = archive.length - minimumEocdSize;
  offset >= Math.max(0, archive.length - minimumEocdSize - maximumZipCommentSize);
  offset -= 1
) {
  if (archive.readUInt32LE(offset) === 0x06054b50) {
    eocdOffset = offset;
    break;
  }
}
if (eocdOffset < 0) throw new Error("Unable to inspect release ZIP: end-of-central-directory record is missing.");
if (archive.readUInt16LE(eocdOffset + 4) !== 0 || archive.readUInt16LE(eocdOffset + 6) !== 0) {
  throw new Error("Unable to inspect release ZIP: multi-disk archives are unsupported.");
}
const entryCount = archive.readUInt16LE(eocdOffset + 10);
const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
if (centralDirectoryEnd > eocdOffset || centralDirectoryEnd > archive.length) {
  throw new Error("Unable to inspect release ZIP: central directory is out of bounds.");
}
const entries = [];
let centralOffset = centralDirectoryOffset;
for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
  if (centralOffset + 46 > centralDirectoryEnd || archive.readUInt32LE(centralOffset) !== 0x02014b50) {
    throw new Error("Unable to inspect release ZIP: invalid central-directory entry.");
  }
  const offset = centralOffset;
  const nameLength = archive.readUInt16LE(offset + 28);
  const extraLength = archive.readUInt16LE(offset + 30);
  const commentLength = archive.readUInt16LE(offset + 32);
  const nameStart = offset + 46;
  const nextOffset = nameStart + nameLength + extraLength + commentLength;
  if (nextOffset > centralDirectoryEnd) throw new Error("Unable to inspect release ZIP: truncated central directory.");
  entries.push(archive.subarray(nameStart, nameStart + nameLength).toString("utf8"));
  centralOffset = nextOffset;
}
if (centralOffset !== centralDirectoryEnd) throw new Error("Unable to inspect release ZIP: unexpected central-directory data.");
entries.sort();
const expected = [...assets].sort();
if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error(`Unexpected ZIP contents: ${entries.join(", ")}`);

const checksum = createHash("sha256").update(archive).digest("hex");
await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`, "utf8");

process.stdout.write([
  `Created ${path.relative(root, zipPath)}`,
  `Contents: ${entries.join(", ")}`,
  `SHA-256: ${checksum}`,
  "Privacy check: no data.json, note content, or local absolute workspace paths included.",
].join("\n") + "\n");
