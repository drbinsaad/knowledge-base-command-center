import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const version = process.argv[2] || manifest.version;
const changelog = await readFile("CHANGELOG.md", "utf8");
const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const match = new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## \\S|(?![\\s\\S]))`, "m").exec(changelog);
if (!match?.[1]?.trim()) throw new Error(`CHANGELOG.md has no release notes for ${version}.`);
process.stdout.write(`${match[1].trim()}\n`);
