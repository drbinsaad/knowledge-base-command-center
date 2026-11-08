import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { RecoveryCopyModal, type RecoveryCopyModalCallbacks } from "../src/recovery-copy-modal.ts";
import { RECOVERY_COPY_CONFLICT_RESCUE_KIND } from "../src/recovery-copy.ts";
import { SyncRecoveryCenterModal } from "../src/sync-recovery-modal.ts";
import { createDefaultStore, migrateData, type PluginStore } from "../src/model.ts";
import { Notice, TFile } from "./support/obsidian-stub.ts";
import { RecoveryFilePicker } from "../src/recovery-copy-modal.ts";
import { RECOVERY_COPY_LIMITS, createRecoveryRestoreIntent as makeIntent } from "../src/recovery-copy.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";

// A07 entry wiring. Synthetic data only; the adapter is an in-memory map.
const VAULT = "vault-entry-synthetic";
const EXPORTS = "Exports Elsewhere";
const PLUGIN_DIR = ".obsidian/plugins/synthetic";
const NOW = Date.now();

function rescueText(name: string): string {
  const data = migrateData(null);
  data.settings.workspaceName = name;
  const store = createDefaultStore(data, NOW - 1000, VAULT);
  return JSON.stringify({ kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND, version: 1, exportedAt: new Date(NOW - 5000).toISOString(), store });
}

interface Wired {
  plugin: EntVaultCommandCenterPlugin;
  files: Map<string, string>;
  callbacks: () => RecoveryCopyModalCallbacks;
  disk: () => PluginStore;
  adapterCalls: string[];
  pickable: TFile[];
}

async function wired(manifest: Record<string, string> = { dir: PLUGIN_DIR }, existingFolders: readonly string[] = []): Promise<Wired> {
  const files = new Map<string, string>();
  const adapterCalls: string[] = [];
  const pickable: TFile[] = [];
  const adapter = {
    exists: async (path: string) => files.has(path) || existingFolders.includes(path),
    write: async (path: string, text: string) => { files.set(path, text); },
    read: async (path: string) => { const text = files.get(path); if (text === undefined) throw new Error("ENOENT"); return text; },
    remove: async (path: string) => { files.delete(path); },
    rename: async (from: string, to: string) => { const text = files.get(from); if (text !== undefined) { files.set(to, text); files.delete(from); } },
    list: async (folder: string) => {
      adapterCalls.push(`list ${folder}`);
      const prefix = `${folder}/`;
      const found = [...files.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
      if (found.length === 0 && folder !== PLUGIN_DIR) throw new Error("ENOENT");
      return { files: found, folders: [] };
    },
    stat: async (path: string) => {
      adapterCalls.push("stat");
      const text = files.get(path);
      return text === undefined ? null : { type: "file", ctime: 0, mtime: NOW, size: new TextEncoder().encode(text).length };
    },
    readBinary: async (path: string) => {
      adapterCalls.push("readBinary");
      const text = files.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return new TextEncoder().encode(text).buffer;
    },
  };
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getFiles: () => [...pickable], getAbstractFileByPath: () => null, adapter },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  let disk = createDefaultStore(migrateData(null), 100, VAULT);
  disk.bases[0].data.settings.exportsFolder = EXPORTS;
  const plugin = new EntVaultCommandCenterPlugin(app as never, manifest as never);
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => { disk = structuredClone(value) as PluginStore; };
  await plugin.loadPluginData(false);
  let captured: RecoveryCopyModalCallbacks | null = null;
  RecoveryCopyModal.prototype.open = function open(this: RecoveryCopyModal): void {
    captured = (this as unknown as { callbacks: RecoveryCopyModalCallbacks }).callbacks;
  };
  plugin.openRecoveryCopyReview();
  delete (RecoveryCopyModal.prototype as { open?: unknown }).open; // back to the inherited open()
  return { plugin, files, callbacks: () => { assert.ok(captured); return captured; }, disk: () => disk, adapterCalls, pickable };
}

test("the review discovers copies in the configured, legacy and plugin folders without reading them", async () => {
  const w = await wired();
  w.files.set(`${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-000Z.json`, rescueText("Alpha"));
  w.files.set(`Knowledge Base Command Center Exports/knowledge-base-command-center-conflict-2026-11-02T10-00-00-000Z.json`, rescueText("Beta"));
  w.files.set(`${PLUGIN_DIR}/data.json.bak-kept-2026-11-03T10-00-00-000Z`, JSON.stringify(createDefaultStore(migrateData(null), 100, VAULT)));
  w.files.set(`${PLUGIN_DIR}/data.json`, "{}");
  w.adapterCalls.length = 0;
  const found = await w.callbacks().discover();
  assert.equal(found.candidates.length, 3);
  assert.deepEqual(new Set(found.candidates.map((candidate) => candidate.origin)), new Set(["export-folder", "legacy-export-folder", "kept-backup"]));
  assert.equal(w.adapterCalls.includes("readBinary"), false, "discovery reads no contents");
  assert.doesNotMatch(found.summary, /Exports Elsewhere|synthetic|\.obsidian/);
});

test("select, restore and open go through the real hook, and a changed source is refused", async () => {
  const w = await wired();
  const path = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-000Z.json`;
  w.files.set(path, rescueText("Alpha"));
  const callbacks = w.callbacks();
  const [candidate] = (await callbacks.discover()).candidates;
  const loaded = await callbacks.load(candidate);
  assert.ok(loaded.status === "parsed" && loaded.result.ok);
  if (!(loaded.status === "parsed" && loaded.result.ok)) return;
  assert.equal(loaded.result.preview.identity, "same-vault", "identity comes from the live store");
  const reviewed = callbacks.getDestination(); // captured at preview time, as the review window does
  const { createRecoveryRestoreIntent } = await import("../src/recovery-copy.ts");
  const make = () => {
    const made = createRecoveryRestoreIntent({
      parsed: (loaded.result as never),
      selectedBaseId: loaded.result.ok ? loaded.result.store.bases[0].id : "",
      existingNames: callbacks.getExistingNames(),
      existingBaseIds: callbacks.getExistingBaseIds(),
      generateIdentity: () => callbacks.generateIdentity(),
    });
    assert.ok(made.ok);
    return made.ok ? made.intent : (undefined as never);
  };
  // Source changed after the preview: refused, nothing written.
  w.files.set(path, rescueText("Alpha").replace("Alpha", "Alphb"));
  assert.equal((await callbacks.onApply(make(), reviewed)).status, "failed");
  assert.equal(w.plugin.getKnowledgeBases(true).length, 1);
  // Source restored: the same bytes pass.
  w.files.set(path, rescueText("Alpha"));
  const intent = make();
  const result = await callbacks.onApply(intent, reviewed);
  assert.equal(result.status, "applied", JSON.stringify(result));
  assert.equal(w.plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(w.disk().bases.length, 2);
  await callbacks.onOpenRestored(intent.newBaseId);
  assert.equal(w.plugin.getActiveKnowledgeBaseId(), intent.newBaseId);
});

test("a verified no-op Sync reload after the preview does not invalidate the reviewed Apply", async () => {
  const w = await wired();
  const path = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-000Z.json`;
  w.files.set(path, rescueText("Alpha"));
  const callbacks = w.callbacks();
  const [candidate] = (await callbacks.discover()).candidates;
  const loaded = await callbacks.load(candidate);
  assert.ok(loaded.status === "parsed" && loaded.result.ok);
  if (!(loaded.status === "parsed" && loaded.result.ok)) return;
  const reviewed = callbacks.getDestination();
  const epochBefore = w.plugin.getDataEpoch();
  await w.plugin.onExternalSettingsChange(); // same bytes on disk, nothing meaningful changed
  assert.notEqual(w.plugin.getDataEpoch(), epochBefore, "the raw epoch does advance on a reload (why it is not the binding)");
  const made = makeIntent({
    parsed: loaded.result, selectedBaseId: loaded.result.store.bases[0].id,
    existingNames: callbacks.getExistingNames(), existingBaseIds: callbacks.getExistingBaseIds(),
    generateIdentity: () => callbacks.generateIdentity(),
  });
  assert.ok(made.ok);
  if (!made.ok) return;
  const result = await callbacks.onApply(made.intent, reviewed);
  assert.equal(result.status, "applied", JSON.stringify(result));
  assert.equal(w.disk().bases.length, 2);
});

test("switching away and back after the preview is still refused", async () => {
  const w = await wired();
  const path = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-000Z.json`;
  w.files.set(path, rescueText("Alpha"));
  await w.plugin.createKnowledgeBase("Other", "generic", "Knowledge Base");
  await w.plugin.switchKnowledgeBase("base-default");
  const callbacks = w.callbacks();
  const [candidate] = (await callbacks.discover()).candidates;
  const loaded = await callbacks.load(candidate);
  assert.ok(loaded.status === "parsed" && loaded.result.ok);
  if (!(loaded.status === "parsed" && loaded.result.ok)) return;
  const reviewed = callbacks.getDestination();
  const otherId = w.plugin.getKnowledgeBases().find((entry) => entry.id !== "base-default")?.id ?? "";
  await w.plugin.switchKnowledgeBase(otherId);
  await w.plugin.switchKnowledgeBase("base-default");
  assert.equal(w.plugin.getActiveKnowledgeBaseId(), reviewed.activeBaseId, "back on the reviewed base");
  const made = makeIntent({
    parsed: loaded.result, selectedBaseId: loaded.result.store.bases[0].id,
    existingNames: callbacks.getExistingNames(), existingBaseIds: callbacks.getExistingBaseIds(),
    generateIdentity: () => callbacks.generateIdentity(),
  });
  assert.ok(made.ok);
  if (!made.ok) return;
  const before = w.disk().bases.length;
  assert.equal((await callbacks.onApply(made.intent, reviewed)).status, "failed");
  assert.equal(w.disk().bases.length, before);
});

test("creating or switching a base after the preview refuses the old window's Apply", async () => {
  for (const change of ["create", "switch"] as const) {
    const w = await wired();
    const path = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-000Z.json`;
    w.files.set(path, rescueText("Alpha"));
    const callbacks = w.callbacks();
    const [candidate] = (await callbacks.discover()).candidates;
    const loaded = await callbacks.load(candidate);
    assert.ok(loaded.status === "parsed" && loaded.result.ok);
    if (!(loaded.status === "parsed" && loaded.result.ok)) return;
    const reviewed = callbacks.getDestination(); // what the window captured at preview time
    const { createRecoveryRestoreIntent } = await import("../src/recovery-copy.ts");
    const made = createRecoveryRestoreIntent({
      parsed: loaded.result, selectedBaseId: loaded.result.store.bases[0].id,
      existingNames: callbacks.getExistingNames(), existingBaseIds: callbacks.getExistingBaseIds(),
      generateIdentity: () => callbacks.generateIdentity(),
    });
    assert.ok(made.ok);
    if (!made.ok) return;
    if (change === "create") await w.plugin.createKnowledgeBase("Made after preview", "generic", "Knowledge Base");
    else {
      await w.plugin.createKnowledgeBase("Other", "generic", "Knowledge Base");
    }
    const before = w.disk().bases.length;
    if (change === "switch") await w.plugin.switchKnowledgeBase(w.plugin.getKnowledgeBases()[1].id);
    Notice.messages.length = 0;
    const result = await callbacks.onApply(made.intent, reviewed);
    assert.equal(result.status, "failed", change);
    assert.equal(w.disk().bases.length, before, "no new base on disk");
    assert.match(Notice.messages.join("\n"), /Reopen the review\. Nothing was changed/);
  }
});

test("a missing manifest.dir never lists the vault root: derive the folder from the config folder and id, or omit it", async () => {
  const kept = "data.json.bak-kept-2026-11-03T10-00-00-000Z";
  // Derived and verified to exist: the kept backup is found there, and the root is never listed.
  const derived = await wired({ id: "synthetic" }, [PLUGIN_DIR]);
  derived.files.set(`${PLUGIN_DIR}/${kept}`, "{}");
  derived.adapterCalls.length = 0;
  const found = await derived.callbacks().discover();
  assert.equal(found.candidates.some((candidate) => candidate.origin === "kept-backup"), true);
  assert.equal(derived.adapterCalls.includes("list "), false, "the vault root is never listed");
  assert.equal(derived.adapterCalls.includes(`list ${PLUGIN_DIR}`), true);
  // Not derivable (no id) or not present: omitted with an honest, path-free explanation.
  for (const [manifest, folders] of [[{}, []], [{ id: "synthetic" }, []]] as const) {
    const w = await wired({ ...manifest }, folders);
    w.adapterCalls.length = 0;
    const result = await w.callbacks().discover();
    assert.equal(w.adapterCalls.includes("list "), false);
    assert.equal(w.adapterCalls.some((call) => call.startsWith("list .obsidian")), false);
    assert.match(result.summary, /plugin folder could not be identified/);
    assert.doesNotMatch(result.summary, /\.obsidian|synthetic/);
  }
});

async function choose(w: Wired, file: TFile | null): Promise<Awaited<ReturnType<NonNullable<RecoveryCopyModalCallbacks["pickExplicit"]>>>> {
  RecoveryFilePicker.prototype.open = function open(this: RecoveryFilePicker): void {
    if (file) this.onChooseItem(file);
    else (this as unknown as { finish(value: null): void }).finish(null);
  };
  try {
    const picked = await w.callbacks().pickExplicit?.();
    assert.notEqual(picked, undefined, "Choose another file is wired");
    return picked ?? null;
  } finally {
    delete (RecoveryFilePicker.prototype as { open?: unknown }).open;
  }
}

test("Choose another file: a valid file is previewed, an unchosen picker returns nothing, the path is not in messages", async () => {
  const w = await wired();
  const path = "Elsewhere/retained-rescue.json";
  w.files.set(path, rescueText("Chosen"));
  const file = new TFile(path);
  w.pickable.push(file);
  assert.equal(await choose(w, null), null);
  const candidate = await choose(w, file);
  assert.ok(candidate);
  if (!candidate) return;
  assert.equal(candidate.origin, "chosen-file");
  assert.equal(candidate.displayName, "retained-rescue.json");
  const loaded = await w.callbacks().load(candidate);
  assert.ok(loaded.status === "parsed" && loaded.result.ok);
  if (loaded.status === "parsed" && loaded.result.ok) assert.equal(loaded.result.preview.bases[0].name, "Chosen");
});

test("Choose another file offers recognized raw kept copies as well as JSON files, and nothing else", async () => {
  const w = await wired();
  const kept = new TFile("Old Copies/data.json.bak-kept-2026-11-03T10-00-00-000Z");
  const bak = new TFile("Old Copies/data.json.bak");
  const rescue = new TFile("Old Copies/rescue.json");
  const upper = new TFile("Old Copies/Rescue.JSON"); // the old picker matched the extension case-insensitively
  w.pickable.push(upper);
  for (const other of ["Old Copies/note.md", "Old Copies/data.json.bak-other", "Old Copies/image.png", "Old Copies/data.json.backup"]) w.pickable.push(new TFile(other));
  w.pickable.push(kept, bak, rescue);
  let items: string[] = [];
  RecoveryFilePicker.prototype.open = function open(this: RecoveryFilePicker): void {
    items = this.getItems().map((file) => file.path);
    this.onChooseItem(kept);
  };
  try {
    const candidate = await w.callbacks().pickExplicit?.();
    assert.deepEqual(items, ["Old Copies/Rescue.JSON", "Old Copies/data.json.bak", "Old Copies/data.json.bak-kept-2026-11-03T10-00-00-000Z", "Old Copies/rescue.json"]);
    assert.equal(candidate?.displayName, kept.name);
    // The filename only nominates it: parse, size and exact bytes still decide.
    w.files.set(kept.path, JSON.stringify(createDefaultStore(migrateData(null), 100, VAULT)));
    const loaded = candidate ? await w.callbacks().load(candidate) : null;
    assert.ok(loaded?.status === "parsed" && loaded.result.ok);
    w.files.set(kept.path, "not json");
    const bad = candidate ? await w.callbacks().load(candidate) : null;
    assert.ok(bad?.status === "parsed" && !bad.result.ok);
  } finally {
    delete (RecoveryFilePicker.prototype as { open?: unknown }).open;
  }
});

test("Choose another file: oversized and unreadable files are preserved but not restorable, with no read for the oversized one", async () => {
  const w = await wired();
  const big = "Elsewhere/big.json";
  w.files.set(big, "x");
  const bigFile = new TFile(big);
  w.pickable.push(bigFile);
  // Declare a size above the cap through the adapter without allocating it.
  const adapter = (w.plugin.app.vault as unknown as { adapter: { stat(path: string): Promise<unknown> } }).adapter;
  const stat = adapter.stat.bind(adapter);
  adapter.stat = async (path: string) => (path === big ? { type: "file", ctime: 0, mtime: 0, size: RECOVERY_COPY_LIMITS.maxBytes + 1 } : stat(path));
  const candidate = await choose(w, bigFile);
  assert.ok(candidate);
  if (!candidate) return;
  w.adapterCalls.length = 0;
  const oversized = await w.callbacks().load(candidate);
  assert.ok(oversized.status === "parsed" && !oversized.result.ok);
  if (oversized.status === "parsed" && !oversized.result.ok) assert.equal(oversized.result.reason, "too-large");
  assert.equal(w.adapterCalls.includes("readBinary"), false, "bounded before reading");
  adapter.stat = stat;
  w.files.delete(big);
  assert.equal((await w.callbacks().load(candidate)).status, "unreadable");
});

test("Choose another file: a file changed between preview and Apply is refused", async () => {
  const w = await wired();
  const path = "Elsewhere/changing.json";
  w.files.set(path, rescueText("Alpha"));
  const file = new TFile(path);
  w.pickable.push(file);
  const callbacks = w.callbacks();
  const candidate = await choose(w, file);
  assert.ok(candidate);
  if (!candidate) return;
  const loaded = await callbacks.load(candidate);
  assert.ok(loaded.status === "parsed" && loaded.result.ok);
  if (!(loaded.status === "parsed" && loaded.result.ok)) return;
  const destination = callbacks.getDestination();
  const made = makeIntent({
    parsed: loaded.result, selectedBaseId: loaded.result.store.bases[0].id,
    existingNames: callbacks.getExistingNames(), existingBaseIds: callbacks.getExistingBaseIds(),
    generateIdentity: () => callbacks.generateIdentity(),
  });
  assert.ok(made.ok);
  if (!made.ok) return;
  w.files.set(path, rescueText("Alpha").replace("Alpha", "Alphb"));
  Notice.messages.length = 0;
  assert.equal((await callbacks.onApply(made.intent, destination)).status, "failed");
  assert.equal(w.disk().bases.length, 1);
  assert.doesNotMatch(Notice.messages.join("\n"), /Elsewhere|changing\.json/);
  w.files.set(path, rescueText("Alpha"));
  assert.equal((await callbacks.onApply(made.intent, destination)).status, "applied");
});

test("Review kept copies is in the Sync and recovery center, also in protected read-only mode", async () => {
  for (const readOnly of [false, true]) {
    const w = await wired();
    if (readOnly) (w.plugin as unknown as { dataCompatibilityWarning: string }).dataCompatibilityWarning = "Protected for this synthetic test.";
    const dom = createFakeDom();
    const root = dom.document.body.createDiv();
    const title = root.createDiv();
    const content = root.createDiv();
    const modal = new SyncRecoveryCenterModal(w.plugin);
    let closed = 0;
    Object.assign(modal, { modalEl: asHtmlElement(root), titleEl: asHtmlElement(title), contentEl: asHtmlElement(content) });
    modal.close = () => { closed += 1; };
    modal.onOpen();
    const entry = content.querySelectorAll("button").find((button: FakeElement) => button.textContent.includes("Review kept copies"));
    assert.ok(entry, `entry present when readOnly=${String(readOnly)}`);
    assert.match(content.textContent, /Kept copies/);
    let opened = 0;
    w.plugin.openRecoveryCopyReview = () => { opened += 1; };
    Notice.messages.length = 0;
    entry.click();
    assert.equal(opened, 1);
    assert.equal(closed, 1);
  }
});
