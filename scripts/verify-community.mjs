import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Static, repository-local invariants that mirror high-risk Community review
// checks. This is not a substitute for Obsidian staff review or device testing.
const root = process.cwd();
const sourceRoot = path.join(root, "src");
async function discoverRuntimeSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith("._")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discoverRuntimeSources(absolute));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}
const sourcePaths = (await discoverRuntimeSources(sourceRoot)).sort();
const sources = await Promise.all(sourcePaths.map(async (absolute) => [
  path.relative(sourceRoot, absolute),
  await readFile(absolute, "utf8"),
]));
const runtime = sources.map(([, content]) => content).join("\n");
const main = sources.find(([name]) => name === "main.ts")?.[1] ?? "";
const bundle = await readFile(path.join(root, "main.js"), "utf8");
const readme = await readFile(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.isDesktopOnly, false);
assert.equal(manifest.id, "ent-vault-command-center");
assert.ok(bundle.length > 1_000, "main.js must be a nonempty production bundle; run npm run build first");

for (const [label, content] of [["runtime source", runtime], ["built main.js", bundle]]) {
  assert.doesNotMatch(content, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|sendBeacon|requestUrl)\b/, `${label} must not expose a detected network API`);
  assert.doesNotMatch(content, /\b(?:eval|Function)\s*\(/, `${label} must not execute dynamic code`);
  assert.doesNotMatch(content, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/, `${label} must use safe DOM construction`);
  assert.doesNotMatch(content, /navigator\.clipboard\.(?:read|readText)\s*\(/, `${label} clipboard access must remain write-only`);
  assert.equal((content.match(/\.writeText\s*\(/g) ?? []).length, 1, `${label} must contain exactly one clipboard writer`);
  // The ES2018 baseline is enforced for library methods by tsconfig's pinned
  // lib, but DOM-declared globals slip past both that pin and esbuild's
  // syntax-only target. Ban the ones newer than the supported web-view floor
  // (Chrome 73 / iOS 12.2); use cloneJsonValue from model.ts instead of
  // structuredClone (Chrome 98 / iOS 15.4).
  assert.doesNotMatch(content, /\bstructuredClone\s*\(/, `${label} must not call structuredClone (needs Chrome 98 / iOS 15.4, above the supported web-view floor)`);
}

assert.doesNotMatch(runtime, /\b(?:require\s*\(|from\s+["'](?:fs|node:|child_process|electron)|process\.)/, "runtime must not use Node or Electron APIs");
const obsidianImports = [...runtime.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']obsidian["']/g)].map((match) => match[1]);
for (const imported of obsidianImports) {
  assert.doesNotMatch(imported, /(?:^|,)\s*(?:request|requestUrl)(?:\s+as\s+[\w$]+)?\s*(?:,|$)/, "runtime must not import Obsidian network APIs");
}
assert.doesNotMatch(runtime, /import\s+\*\s+as\s+[\w$]+\s+from\s*["']obsidian["']/, "runtime must use auditable named Obsidian imports");
assert.doesNotMatch(bundle, /\b(?:process\.|Buffer\b|__dirname\b|__filename\b)/, "built main.js must not use Node globals");
assert.doesNotMatch(bundle, /(?:\.request(?:Url)?\b|\[\s*["']request(?:Url)?["']\s*\])/, "built main.js must not reference Obsidian network APIs");
const bundledRequires = [...bundle.matchAll(/\brequire\s*\(\s*([^)]*?)\s*\)/g)].map((match) => match[1]);
assert.ok(bundledRequires.length > 0, "built main.js must retain Obsidian as an external module");
for (const required of bundledRequires) {
  assert.match(required, /^["']obsidian["']$/, `built main.js must not require external module ${required}`);
}
assert.doesNotMatch(bundle, /sourceMappingURL/, "production main.js must not embed a source map");
assert.match(bundle, /ent-vault-command-center/, "built main.js must contain the stable plugin ID");
assert.match(readme, /never reads clipboard contents/i);
assert.match(readme, /enumerates whole-vault Markdown file paths/i);
assert.match(readme, /enumerates all loaded vault entries before retaining folder paths/i);
assert.match(readme, /enumerates all vault file paths before retaining JSON packages/i);
assert.match(runtime, /getSettingDefinitions\(\): SettingDefinitionItem\[\]/);
assert.doesNotMatch(runtime, /\bdisplay\(\): void|\.setWarning\(|\.setDynamicTooltip\(/, "deprecated settings APIs must not return");
assert.doesNotMatch(main, /id:\s*["'][^"']*(?:ent-vault-command-center|command)[^"']*["']/, "command IDs must be concise and unprefixed");
assert.doesNotMatch(main, /name:\s*["'][^"']*command[^"']*["']/i, "command names must not include the redundant word command");
assert.match(runtime, /Platform\.isMobile/);
assert.match(runtime, /writePortableJson\("backup"/);
// Every JSON export reaches the vault through one audited helper: the mobile
// branch writes through writePortableJson(kind, …) and the desktop branch only
// hands a blob to the user. Assert the helper and the surviving callers — the
// portable package (which carries the workspace component; the standalone
// workspace export was removed with the legacy Manage-index path) and the
// same-vault recovery backup.
assert.match(runtime, /await plugin\.writePortableJson\(kind, value\)/);
assert.match(runtime, /deliverJsonExport\(\s*this\.plugin,\s*"portable"/);
assert.match(runtime, /deliverJsonExport\(this\.plugin, "backup"/);

const enumerationCalls = runtime.match(/\.get(?:MarkdownFiles|Files|AllLoadedFiles)\s*\(/g) ?? [];
const bulkReads = runtime.match(/\.(?:read|cachedRead)\s*\(/g) ?? [];
process.stdout.write(`Community-oriented static verification passed: ${sourcePaths.length} runtime files plus built main.js (${bundle.length} bytes), ${enumerationCalls.length} enumeration call sites, ${bulkReads.length} targeted read call sites, no detected network APIs, one clipboard writer, and no clipboard-read API.\n`);
