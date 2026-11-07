import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { RecoveryCopyModal, type RecoveryCopyModalCallbacks } from "../src/recovery-copy-modal.ts";
import { RECOVERY_COPY_CONFLICT_RESCUE_KIND } from "../src/recovery-copy.ts";
import { SyncRecoveryCenterModal } from "../src/sync-recovery-modal.ts";
import { createDefaultStore, migrateData, type PluginStore } from "../src/model.ts";
import { Notice } from "./support/obsidian-stub.ts";
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
}

async function wired(): Promise<Wired> {
  const files = new Map<string, string>();
  const adapterCalls: string[] = [];
  const adapter = {
    exists: async (path: string) => files.has(path),
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
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null, adapter },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  let disk = createDefaultStore(migrateData(null), 100, VAULT);
  disk.bases[0].data.settings.exportsFolder = EXPORTS;
  const plugin = new EntVaultCommandCenterPlugin(app as never, { dir: PLUGIN_DIR } as never);
  plugin.loadData = async () => structuredClone(disk);
  plugin.saveData = async (value: unknown) => { disk = structuredClone(value) as PluginStore; };
  await plugin.loadPluginData(false);
  let captured: RecoveryCopyModalCallbacks | null = null;
  RecoveryCopyModal.prototype.open = function open(this: RecoveryCopyModal): void {
    captured = (this as unknown as { callbacks: RecoveryCopyModalCallbacks }).callbacks;
  };
  plugin.openRecoveryCopyReview();
  delete (RecoveryCopyModal.prototype as { open?: unknown }).open; // back to the inherited open()
  return { plugin, files, callbacks: () => { assert.ok(captured); return captured; }, disk: () => disk, adapterCalls };
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
  assert.equal((await callbacks.onApply(make())).status, "failed");
  assert.equal(w.plugin.getKnowledgeBases(true).length, 1);
  // Source restored: the same bytes pass.
  w.files.set(path, rescueText("Alpha"));
  const intent = make();
  const result = await callbacks.onApply(intent);
  assert.equal(result.status, "applied", JSON.stringify(result));
  assert.equal(w.plugin.getActiveKnowledgeBaseId(), "base-default");
  assert.equal(w.disk().bases.length, 2);
  await callbacks.onOpenRestored(intent.newBaseId);
  assert.equal(w.plugin.getActiveKnowledgeBaseId(), intent.newBaseId);
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
