import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkJsonExportRoutes } from "./json-export-routes.mjs";
import { checkRuntimeSources, checkSafetyPatterns, discoverRuntimeSources } from "./runtime-source-guards.mjs";

// Static, repository-local invariants that mirror high-risk Community review
// checks. This is not a substitute for Obsidian staff review or device testing.
// All runtime source rules live in runtime-source-guards.mjs and apply to every
// discovered src/**/*.ts file; bundle, README and manifest checks stay here.
const root = process.cwd();
const sources = await discoverRuntimeSources(path.join(root, "src"));
assert.ok(sources.length > 0, "runtime source discovery must find files");
assert.ok(sources.some(([name]) => name === "main.ts"), "runtime source discovery must include main.ts");
const runtime = sources.map(([, content]) => content).join("\n");
assert.ok(runtime.length > 1_000, "runtime sources must not be empty");
const bundle = await readFile(path.join(root, "main.js"), "utf8");
const readme = await readFile(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.isDesktopOnly, false);
assert.equal(manifest.id, "ent-vault-command-center");
assert.ok(bundle.length > 1_000, "main.js must be a nonempty production bundle; run npm run build first");

checkRuntimeSources(sources);
checkSafetyPatterns("built main.js", bundle);

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
assert.match(runtime, /Platform\.isMobile/);
assert.match(runtime, /writePortableJson\("backup"/);
// Every JSON export reaches the vault through one audited helper
// (deliverJsonExport). The route checks are bound to the real reachable call
// sites (Sync recovery modal -> export center backup purpose, automatic
// recovery package, portfolio export) and are unit-tested for non-vacuity in
// tests/verify-community-guard.test.ts.
checkJsonExportRoutes(sources);

const enumerationCalls = runtime.match(/\.get(?:MarkdownFiles|Files|AllLoadedFiles)\s*\(/g) ?? [];
const bulkReads = runtime.match(/\.(?:read|cachedRead)\s*\(/g) ?? [];
process.stdout.write(`Community-oriented static verification passed: ${sources.length} runtime files plus built main.js (${bundle.length} bytes), ${enumerationCalls.length} enumeration call sites, ${bulkReads.length} targeted read call sites, no detected programmatic network APIs, one vault-resolved cover-image sink, one clipboard writer, and no clipboard-read API.\n`);
