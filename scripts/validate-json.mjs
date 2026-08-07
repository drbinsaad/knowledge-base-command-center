import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const names = ["package.json", "package-lock.json", "manifest.json", "versions.json", "tsconfig.json", "tsconfig.eslint.json"];
const parsed = new Map();
for (const name of names) {
  const raw = await readFile(name, "utf8");
  const value = JSON.parse(raw);
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${name} must contain a JSON object.`);
  parsed.set(name, value);
}

const packageJson = parsed.get("package.json");
const packageLock = parsed.get("package-lock.json");
const manifest = parsed.get("manifest.json");
const versions = parsed.get("versions.json");
assert.equal(packageJson.version, manifest.version);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[""].version, packageJson.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.isDesktopOnly, false);
process.stdout.write(`Validated ${names.length} JSON configuration files and cross-file release metadata.\n`);
