import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** Recursively discovers .ts files (AppleDouble "._" entries ignored) as sorted [relativePath, content] pairs. */
export async function discoverRuntimeSources(sourceRoot) {
  const walk = async (directory) => {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith("._")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(absolute));
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
    }
    return files;
  };
  const paths = (await walk(sourceRoot)).sort();
  return Promise.all(paths.map(async (absolute) => [path.relative(sourceRoot, absolute).split(path.sep).join("/"), await readFile(absolute, "utf8")]));
}

/**
 * All-source runtime guards. Dependency-free; takes [relativePath, content][]
 * (paths relative to src/, e.g. "extracted/probe.ts"). Regression coverage of
 * explicit invariants, not a defence against arbitrary obfuscation.
 */

/** Rules shared by runtime source and the built bundle. */
export function checkSafetyPatterns(label, content) {
  assert.doesNotMatch(content, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|sendBeacon|requestUrl)\b/, `${label} must not expose a detected network API`);
  assert.doesNotMatch(content, /\b(?:eval|Function)\s*\(/, `${label} must not execute dynamic code`);
  assert.doesNotMatch(content, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/, `${label} must use safe DOM construction`);
  assert.doesNotMatch(content, /navigator\.clipboard\.(?:read|readText)\s*\(/, `${label} clipboard access must remain write-only`);
  assert.equal((content.match(/\.writeText\s*\(/g) ?? []).length, 1, `${label} must contain exactly one clipboard writer`);
  // The ES2018 baseline: ban DOM globals newer than the supported web-view floor
  // (Chrome 73 / iOS 12.2); use cloneJsonValue from model.ts instead.
  assert.doesNotMatch(content, /\bstructuredClone\s*\(/, `${label} must not call structuredClone (needs Chrome 98 / iOS 15.4, above the supported web-view floor)`);
}

const COMMAND_CALLBACKS = /\b(?:callback|checkCallback|editorCallback|editorCheckCallback)\b/;

/**
 * Same-length copy of the source in which comments become spaces and the
 * contents of string and template literals become "_" (quotes stay). Braces and
 * keywords inside strings or comments therefore cannot change structure.
 * Template substitutions are masked with their template (audit boundary).
 */
export function maskSource(content) {
  let out = "";
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") { out += " "; index += 1; }
    } else if (char === "/" && next === "*") {
      const end = content.indexOf("*/", index + 2);
      const stop = end === -1 ? content.length : end + 2;
      while (index < stop) { out += content[index] === "\n" ? "\n" : " "; index += 1; }
    } else if (char === "\"" || char === "'" || char === "`") {
      out += char;
      index += 1;
      while (index < content.length && content[index] !== char) {
        if (content[index] === "\\" && index + 1 < content.length) { out += "__"; index += 2; continue; }
        if (content[index] === "\n" && char !== "`") break;
        out += content[index] === "\n" ? "\n" : "_";
        index += 1;
      }
      if (index < content.length && content[index] === char) { out += char; index += 1; }
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** Reads the real string literal that starts at the opening quote at `at` in the original source. */
function readLiteral(content, at) {
  const quote = content[at];
  let value = "";
  for (let index = at + 1; index < content.length && content[index] !== quote; index += 1) {
    if (content[index] === "\\" && index + 1 < content.length) { index += 1; value += content[index]; continue; }
    value += content[index];
  }
  return value;
}

/** Top level of the object literal opening at `start` in masked text (nested content blanked, same length), or null. */
function shallowObject(masked, start) {
  let depth = 0;
  let shallow = "";
  for (let index = start; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    shallow += depth === 1 && char !== "{" ? char : " ";
    if (depth === 0) return shallow;
  }
  return null;
}

/**
 * Command-shaped object literals: id and name keys plus a Command callback
 * member at the top level of the literal. Each field that is a plain string
 * literal is reported (the other may be dynamic); label-only objects are not
 * recognized. Strings and comments are lexed, not pattern-matched.
 */
export function findCommandDefinitions(content) {
  const masked = maskSource(content);
  const found = [];
  for (let index = masked.indexOf("{"); index !== -1; index = masked.indexOf("{", index + 1)) {
    const shallow = shallowObject(masked, index);
    if (shallow === null || !COMMAND_CALLBACKS.test(shallow)) continue;
    const idMatch = /\bid\s*:\s*/.exec(shallow);
    const nameMatch = /\bname\s*:\s*/.exec(shallow);
    if (!idMatch || !nameMatch) continue;
    const literal = (match) => {
      const at = index + match.index + match[0].length;
      return masked[at] === "\"" || masked[at] === "'" ? readLiteral(content, at) : null;
    };
    found.push({ id: literal(idMatch), name: literal(nameMatch) });
  }
  return found;
}

/**
 * Audit boundary: addCommand may be called with an object literal, or with the
 * loop variable over the audited createQuickEntryCommands() factory. Any other
 * argument form is unsupported and fails closed. A function returning Command[]
 * must contain recognizable command definitions.
 */
export function checkCommands(sources) {
  for (const [name, content] of sources) {
    for (const command of findCommandDefinitions(content)) {
      if (command.id !== null) assert.doesNotMatch(command.id, /ent-vault-command-center|command/, `command IDs must be concise and unprefixed (${name}: ${command.id})`);
      if (command.name !== null) assert.doesNotMatch(command.name, /command/i, `command names must not include the redundant word command (${name}: ${command.name})`);
    }
    for (const match of content.matchAll(/\baddCommand\s*\(\s*([^\s)][^)]{0,40})/g)) {
      const argument = match[1];
      const audited = argument.startsWith("{") || (/^command\b/.test(argument) && /for\s*\(\s*const\s+command\s+of\s+createQuickEntryCommands\s*\(/.test(content));
      assert.ok(audited, `unsupported addCommand argument form in ${name}: ${argument.trim()}; extend the command guard`);
    }
    if (/\)\s*:\s*Command\[\]/.test(content)) {
      assert.ok(findCommandDefinitions(content).length > 0, `${name} returns Command[] but no command-shaped definitions were recognized`);
    }
  }
}

export function checkRuntimeSources(sources) {
  assert.ok(sources.length > 0, "runtime source discovery returned no files");
  const runtime = sources.map(([, content]) => content).join("\n");
  const contentOf = (file) => sources.find(([name]) => name === file)?.[1] ?? "";
  const covers = contentOf("library-cover.ts");
  checkSafetyPatterns("runtime source", runtime);

  assert.doesNotMatch(runtime, /\b(?:require\s*\(|from\s+["'](?:fs|node:|child_process|electron)|process\.)/, "runtime must not use Node or Electron APIs");
  const obsidianImports = [];
  for (const [, content] of sources) {
    for (const match of maskSource(content).matchAll(/import\s*(?:type\s+)?\{([^{}]*)\}\s*from\s*(["'])(_*)\2/g)) {
      const end = match.index + match[0].length;
      if (content.slice(end - match[3].length - 1, end - 1) === "obsidian") obsidianImports.push(match[1]);
    }
  }
  for (const imported of obsidianImports) {
    assert.doesNotMatch(imported, /(?:^|,)\s*(?:request|requestUrl)(?:\s+as\s+[\w$]+)?\s*(?:,|$)/, "runtime must not import Obsidian network APIs");
  }
  assert.doesNotMatch(runtime, /import\s+\*\s+as\s+[\w$]+\s+from\s*["']obsidian["']/, "runtime must use auditable named Obsidian imports");
  assert.doesNotMatch(runtime, /\.flatMap\(/, "runtime must not use flatMap (above the ES2018 baseline)");

  // Vault covers are the sole image-source sink; the owner stays library-cover.ts.
  assert.deepEqual(sources.filter(([, content]) => /createEl\(["']img["']/.test(content)).map(([name]) => name), ["library-cover.ts"]);
  assert.equal((runtime.match(/setAttribute\(["']src["']/g) ?? []).length, 1);
  assert.doesNotMatch(runtime, /\.src\s*=/);
  assert.match(covers, /source: app\.vault\.getResourcePath\(image\)/);
  assert.equal((covers.match(/state: "ready", source:/g) ?? []).length, 1);
  assert.doesNotMatch(runtime, /allowExternal|getExternalLibraryImagesAllowed|setExternalLibraryImagesAllowed/);
  assert.match(covers, /referrerpolicy: "no-referrer"/);
  assert.doesNotMatch(covers, /new URL\(/);

  // Settings contract: deprecated APIs and the redundant heading banned everywhere;
  // the positive entry point stays tied to the real settings module.
  assert.match(contentOf("settings.ts"), /getSettingDefinitions\(\): SettingDefinitionItem\[\]/, "settings.ts must keep the getSettingDefinitions entry point");
  assert.doesNotMatch(runtime, /\bdisplay\(\): void|\.setWarning\(|\.setDynamicTooltip\(/, "deprecated settings APIs must not return");
  assert.doesNotMatch(runtime, /setName\(\s*["']Knowledge Base Command Center["']\s*\)\s*\.setHeading\(\s*\)/, "the redundant product settings heading must not return");

  // Unload behavior: Obsidian's guidance forbids detaching the plugin view on unload.
  assert.doesNotMatch(runtime, /detachLeavesOfType\s*\(\s*VIEW_TYPE\s*\)/, "the plugin view must not be detached from any source");

  checkCommands(sources);
}
