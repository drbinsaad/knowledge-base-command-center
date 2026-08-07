import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceNames = (await readdir(path.join(root, "src"))).filter((name) => name.endsWith(".ts") && !name.startsWith("._")).sort();
const sources = await Promise.all(sourceNames.map(async (name) => [name, await readFile(path.join(root, "src", name), "utf8")]));
const runtime = sources.map(([, content]) => content).join("\n");
const main = sources.find(([name]) => name === "main.ts")?.[1] ?? "";
const readme = await readFile(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.isDesktopOnly, false);
assert.equal(manifest.id, "ent-vault-command-center");
assert.doesNotMatch(runtime, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\s*\(/, "runtime must not expose network capability");
assert.doesNotMatch(runtime, /\b(?:eval|Function)\s*\(/, "runtime must not execute dynamic code");
assert.doesNotMatch(runtime, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/, "runtime must use safe DOM construction");
assert.doesNotMatch(runtime, /\b(?:require\s*\(|from\s+["'](?:fs|node:|child_process|electron)|process\.)/, "runtime must not use Node or Electron APIs");
assert.doesNotMatch(runtime, /navigator\.clipboard\.(?:read|readText)\s*\(/, "clipboard access must remain write-only");
assert.equal((runtime.match(/\.writeText\s*\(/g) ?? []).length, 1, "expected one click-gated clipboard writer");
assert.match(readme, /never reads clipboard contents/i);
assert.match(readme, /enumerates Markdown file paths/i);
assert.match(runtime, /getSettingDefinitions\(\): SettingDefinitionItem\[\]/);
assert.doesNotMatch(runtime, /\bdisplay\(\): void|\.setWarning\(|\.setDynamicTooltip\(/, "deprecated settings APIs must not return");
assert.doesNotMatch(main, /id:\s*["'][^"']*(?:ent-vault-command-center|command)[^"']*["']/, "command IDs must be concise and unprefixed");
assert.doesNotMatch(main, /name:\s*["'][^"']*command[^"']*["']/i, "command names must not include the redundant word command");
assert.match(runtime, /Platform\.isMobile/);
assert.match(runtime, /writePortableJson\("backup"/);
assert.match(runtime, /writePortableJson\("workspace"/);

const enumerationCalls = runtime.match(/\.get(?:MarkdownFiles|Files|AllLoadedFiles)\s*\(/g) ?? [];
const bulkReads = runtime.match(/\.(?:read|cachedRead)\s*\(/g) ?? [];
process.stdout.write(`Community verification passed: ${sourceNames.length} runtime files, ${enumerationCalls.length} enumeration call sites, ${bulkReads.length} targeted read call sites, zero network capability, write-only clipboard access.\n`);
