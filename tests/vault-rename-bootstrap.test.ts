import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, { VAULT_RENAME_JOURNAL_KEY } from "../src/main.ts";
import { createDefaultStore, migrateData, type PluginStore } from "../src/model.ts";
import {
  MAX_VAULT_RENAME_JOURNAL_BYTES,
  parseVaultRenameJournal,
  type VaultRenameJournal,
} from "../src/vault-rename-journal.ts";
import { Notice, TAbstractFile, TFile, TFolder } from "./support/obsidian-stub.ts";

// D03. Synthetic data only. A rename captured while primary authority is
// missing stays pending until an authoritative, compatible store is adopted
// and its path repair is durable.

type Internals = {
  pendingVaultRenames: Array<{ oldPath: string; newPath: string; folderRename: boolean }>;
  vaultRenameRepairQueue: Promise<void>;
  loadVaultRenameJournal(): void;
  activateVaultRenameJournalForCurrentStore(): boolean;
  schedulePendingVaultRenameRepairs(): void;
  handleVaultRenameEvent(file: TAbstractFile, oldPath: string): void;
  projectPendingRenamePath(path: string): string;
  scheduleRefresh(): void;
};

interface Harness {
  plugin: EntVaultCommandCenterPlugin;
  internal: Internals;
  local: Map<string, unknown>;
  files: Map<string, TAbstractFile>;
  disk: { value: unknown };
  saves: PluginStore[];
  /** Same sequence onload runs: journal load, primary load, activation. */
  start(): Promise<void>;
  rename(from: string, to: string, folder?: boolean): void;
}

function harness(options: {
  disk: unknown;
  local?: Map<string, unknown>;
  files?: readonly TAbstractFile[];
}): Harness {
  const local = options.local ?? new Map<string, unknown>();
  const files = new Map<string, TAbstractFile>((options.files ?? []).map((file) => [file.path, file]));
  const disk = { value: structuredClone(options.disk) };
  const saves: PluginStore[] = [];
  const created = new Map<string, string>();
  const vault = {
    configDir: ".obsidian",
    getMarkdownFiles: (): TFile[] => [...files.values()].filter((file): file is TFile => file instanceof TFile),
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    createFolder: async (): Promise<void> => {},
    create: async (path: string, content: string): Promise<TFile> => { created.set(path, content); return new TFile(path); },
    adapter: {
      stat: async (path: string) => (created.has(path) ? { size: new TextEncoder().encode(created.get(path)).length } : null),
      read: async (path: string) => {
        const text = created.get(path);
        if (text === undefined) throw new Error("ENOENT");
        return text;
      },
    },
  };
  const app = {
    vault,
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(local.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { local.set(key, structuredClone(value)); },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadData = async () => structuredClone(disk.value);
  plugin.saveData = async (value: unknown) => {
    saves.push(structuredClone(value) as PluginStore);
    disk.value = structuredClone(value);
  };
  const internal = plugin as unknown as Internals;
  internal.scheduleRefresh = () => {};
  return {
    plugin,
    internal,
    local,
    files,
    disk,
    saves,
    async start() {
      internal.loadVaultRenameJournal();
      await plugin.loadPluginData(false);
      if (internal.activateVaultRenameJournalForCurrentStore()) internal.schedulePendingVaultRenameRepairs();
      await internal.vaultRenameRepairQueue;
    },
    rename(from, to, folder = false) {
      const target = files.get(from);
      files.delete(from);
      const next = folder ? new TFolder(to) : new TFile(to);
      files.set(to, next);
      void target;
      internal.handleVaultRenameEvent(next, from);
    },
  };
}

function establishedStore(vaultId: string, paths: string[]): PluginStore {
  const data = migrateData(null);
  data.directIndexPaths = [...paths];
  data.pinnedPaths = [...paths];
  return createDefaultStore(data, 100, vaultId);
}

async function arrive(h: Harness, store: unknown): Promise<void> {
  h.disk.value = structuredClone(store);
  await h.plugin.onExternalSettingsChange();
  await h.internal.vaultRenameRepairQueue;
}

function journalOf(h: Harness): VaultRenameJournal | null {
  const raw = h.local.get(VAULT_RENAME_JOURNAL_KEY);
  return raw === null || raw === undefined ? null : parseVaultRenameJournal(raw);
}

const A = "Notes/Alpha.md";
const B = "Notes/Beta.md";
const C = "Notes/Gamma.md";

test("D03: a rename during a missing-primary start is kept and resolves at its new path when the established store arrives", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  await h.internal.vaultRenameRepairQueue;
  const waiting = journalOf(h);
  assert.equal(waiting?.scope.kind, "bootstrap", "the event is journaled as provisional");
  assert.deepEqual(waiting?.renames, [{ oldPath: A, newPath: B, folderRename: false }]);
  assert.deepEqual(h.internal.pendingVaultRenames, [], "nothing is repaired or projected against the empty fallback");

  await arrive(h, establishedStore("vault-d03-established", [A]));
  assert.deepEqual(h.plugin.data.directIndexPaths, [B]);
  assert.deepEqual(h.plugin.data.pinnedPaths, [B]);
  assert.equal(h.local.get(VAULT_RENAME_JOURNAL_KEY), null, "cleanup follows the durable save");
  assert.deepEqual((h.disk.value as PluginStore).bases[0]?.data.directIndexPaths, [B], "the repair reached data.json");
});

test("D03: a rename chain A to B to C resolves at C although B no longer exists", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  h.rename(B, C);
  assert.equal(journalOf(h)?.renames.length, 2);
  await arrive(h, establishedStore("vault-d03-chain", [A]));
  assert.deepEqual(h.plugin.data.directIndexPaths, [C]);
  assert.equal(h.local.get(VAULT_RENAME_JOURNAL_KEY), null);
});

test("D03: a folder rename chain composes prefix changes in event order", async () => {
  const note = "Old/note.md";
  const h = harness({ disk: null, files: [new TFolder("Old"), new TFile(note)] });
  await h.start();
  h.rename("Old", "Mid", true);
  h.files.set("Mid/note.md", new TFile("Mid/note.md"));
  h.rename("Mid", "New", true);
  h.files.set("New/note.md", new TFile("New/note.md"));
  await arrive(h, establishedStore("vault-d03-folder", [note]));
  assert.deepEqual(h.plugin.data.directIndexPaths, ["New/note.md"]);
});

test("D03: a restart between the rename and the delivery keeps the same episode, then binds once", async () => {
  const first = harness({ disk: null, files: [new TFile(A)] });
  await first.start();
  first.rename(A, B);
  const stored = structuredClone(first.local.get(VAULT_RENAME_JOURNAL_KEY));

  const stillMissing = harness({ disk: null, local: new Map(first.local), files: [new TFile(B)] });
  await stillMissing.start();
  assert.deepEqual(stillMissing.local.get(VAULT_RENAME_JOURNAL_KEY), stored, "an unchanged bootstrap journal survives a missing-primary restart");
  assert.deepEqual(stillMissing.internal.pendingVaultRenames, []);

  const delivered = harness({
    disk: establishedStore("vault-d03-restart", [A]),
    local: new Map(stillMissing.local),
    files: [new TFile(B)],
  });
  await delivered.start();
  assert.deepEqual(delivered.plugin.data.directIndexPaths, [B]);
  assert.equal(delivered.local.get(VAULT_RENAME_JOURNAL_KEY), null);
  assert.equal(delivered.saves.length >= 1, true);
});

test("D03: a foreign vault identity is never replayed, projected or rebound", async () => {
  const entry = { oldPath: A, newPath: B, folderRename: false };
  const bootstrap = {
    version: 2,
    scope: { kind: "bootstrap", bootstrapId: "bootstrap-d03", expectedVaultId: "vault-d03-expected" },
    renames: [entry],
    blocked: null,
  };
  const boundV2 = { version: 2, scope: { kind: "bound", vaultId: "vault-d03-expected" }, renames: [entry], blocked: null };
  const boundV1 = { version: 1, vaultId: "vault-d03-expected", renames: [entry] };
  for (const [label, retained] of [["bootstrap", bootstrap], ["bound v2", boundV2], ["bound v1", boundV1]] as const) {
    const h = harness({
      disk: establishedStore("vault-d03-other", [A]),
      local: new Map([[VAULT_RENAME_JOURNAL_KEY, retained]]),
      files: [new TFile(B)],
    });
    await h.start();
    assert.deepEqual(h.plugin.data.directIndexPaths, [A], `${label}: no semantic rewrite`);
    assert.deepEqual(h.internal.pendingVaultRenames, [], `${label}: no projection`);
    assert.equal(h.internal.projectPendingRenamePath(A), A);
    assert.deepEqual(h.local.get(VAULT_RENAME_JOURNAL_KEY), retained, `${label}: evidence preserved byte for byte`);
    assert.equal(h.saves.length, 0, `${label}: nothing written`);
  }
  // Foreign adoption through the Sync worker is equally inert.
  const waiting = harness({ disk: null, local: new Map([[VAULT_RENAME_JOURNAL_KEY, bootstrap]]), files: [new TFile(B)] });
  await waiting.start();
  await arrive(waiting, establishedStore("vault-d03-other", [A]));
  assert.deepEqual(waiting.plugin.data.directIndexPaths, [A]);
  assert.deepEqual(waiting.local.get(VAULT_RENAME_JOURNAL_KEY), bootstrap);
});

test("D03: a new file with the old name is not confused with the renamed one", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  h.files.set(A, new TFile(A)); // an unrelated new note now uses the old name
  Notice.messages.length = 0;
  await arrive(h, establishedStore("vault-d03-same-name", [A]));
  assert.ok(Notice.messages.includes(
    "A note was renamed while organization was still loading, and this plugin cannot tell for certain which note the old link meant (another note may now have its old name, or the renamed item is missing or is a different kind of item). To avoid linking the wrong note, it did not repair that rename. Your notes were not changed. Check that note's place in your organization.",
  ), "the paused repair says what happened, that nothing was lost, and what to check");
  assert.deepEqual(h.plugin.data.directIndexPaths, [A], "the new file's membership is not rewritten");
  const kept = journalOf(h);
  assert.equal(kept?.blocked, "ambiguous-path");
  assert.equal(kept?.scope.kind, "bootstrap");
  assert.equal(kept?.renames.length, 1);
  assert.equal(h.saves.every((save) => !JSON.stringify(save).includes(B)), true);
  const restarted = harness({ disk: h.disk.value, local: new Map(h.local), files: [...h.files.values()] });
  await restarted.start();
  assert.deepEqual(restarted.plugin.data.directIndexPaths, [A], "a restart does not replay it either");
  assert.equal(journalOf(restarted)?.blocked, "ambiguous-path");
});

test("D03: a missing terminal target is not guessed", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  h.files.delete(B); // the destination vanished before the store arrived
  await arrive(h, establishedStore("vault-d03-missing-target", [A]));
  assert.deepEqual(h.plugin.data.directIndexPaths, [A]);
  assert.equal(journalOf(h)?.blocked, "ambiguous-path");
});

test("D03: unsupported journals and read-only data never bind or rewrite", async () => {
  const future = { version: 3, scope: { kind: "bound", vaultId: "vault-d03-future" }, renames: [], blocked: null };
  const unsupported = harness({
    disk: establishedStore("vault-d03-future", [A]),
    local: new Map([[VAULT_RENAME_JOURNAL_KEY, future]]),
    files: [new TFile(B)],
  });
  await unsupported.start();
  assert.equal(unsupported.plugin.isDataReadOnly(), true, "a future journal fails read-only");
  assert.deepEqual(unsupported.local.get(VAULT_RENAME_JOURNAL_KEY), future, "raw evidence is preserved");
  assert.equal(unsupported.saves.length, 0);

  const bootstrap = {
    version: 2,
    scope: { kind: "bootstrap", bootstrapId: "bootstrap-d03-ro", expectedVaultId: null },
    renames: [{ oldPath: A, newPath: B, folderRename: false }],
    blocked: null,
  };
  const futureStore = { ...establishedStore("vault-d03-ro", [A]), version: 9999 };
  const readOnly = harness({ disk: futureStore, local: new Map([[VAULT_RENAME_JOURNAL_KEY, bootstrap]]), files: [new TFile(B)] });
  await readOnly.start();
  assert.equal(readOnly.plugin.isDataReadOnly(), true);
  assert.deepEqual(readOnly.local.get(VAULT_RENAME_JOURNAL_KEY), bootstrap, "no binding while unsupported data is read-only");
  assert.equal(readOnly.saves.length, 0);
});

test("D03: overflow keeps the bound, persists an incomplete marker and never replays", async () => {
  const h = harness({ disk: null });
  await h.start();
  const long = (n: number): string => `${"d".repeat(3900)}${n}.md`;
  let lastGood = 0;
  for (let n = 0; n < 700; n += 1) {
    h.files.set(`${long(n)}.moved`, new TFile(`${long(n)}.moved`));
    h.internal.handleVaultRenameEvent(new TFile(`${long(n)}.moved`), long(n));
    const journal = journalOf(h);
    if (journal?.blocked === "overflow") break;
    lastGood = journal?.renames.length ?? 0;
  }
  const blocked = journalOf(h);
  assert.ok(Notice.messages.includes(
    "Many notes were renamed while organization was still loading, more than this plugin can safely track. Automatic link repair for those renames is paused. Your notes were not changed. Before restarting Obsidian, run “Back up, export, or import…” and export “Same-vault recovery”.",
  ), "the overflow notice names the real command and export option");
  assert.equal(blocked?.blocked, "overflow");
  assert.equal(blocked?.renames.length, lastGood, "the recorded prefix is kept whole");
  assert.ok(new TextEncoder().encode(JSON.stringify(h.local.get(VAULT_RENAME_JOURNAL_KEY))).length <= MAX_VAULT_RENAME_JOURNAL_BYTES);
  // Further events do not grow it.
  h.internal.handleVaultRenameEvent(new TFile("Extra/after.md"), "Extra/before.md");
  assert.equal(journalOf(h)?.renames.length, lastGood);
  assert.equal(journalOf(h)?.blocked, "overflow");
  // The marker survives restart and the journal is not replayed or discharged.
  const restarted = harness({ disk: establishedStore("vault-d03-overflow", [long(0)]), local: new Map(h.local) });
  await restarted.start();
  assert.equal(journalOf(restarted)?.blocked, "overflow");
  assert.deepEqual(restarted.plugin.data.directIndexPaths, [long(0)], "no replay while incomplete");
  assert.equal(restarted.saves.length, 0);
});

test("D03: an interrupted repair keeps the bound journal and a restart finishes it", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  let failing = true;
  const baseSave = h.plugin.saveData.bind(h.plugin);
  h.plugin.saveData = async (value: unknown) => {
    if (failing && JSON.stringify(value).includes(B)) throw new Error("simulated semantic write failure");
    await baseSave(value);
  };
  const established = establishedStore("vault-d03-interrupted", [A]);
  h.disk.value = structuredClone(established);
  await h.plugin.onExternalSettingsChange();
  await h.internal.vaultRenameRepairQueue;
  failing = false;
  const kept = journalOf(h);
  assert.equal(kept?.scope.kind, "bound", "binding was durable before the repair");
  assert.deepEqual(kept?.renames, [{ oldPath: A, newPath: B, folderRename: false }]);
  assert.deepEqual((h.disk.value as PluginStore).bases[0]?.data.directIndexPaths, [A], "data.json still has the old path");

  const restarted = harness({ disk: established, local: new Map(h.local), files: [new TFile(B)] });
  await restarted.start();
  assert.deepEqual(restarted.plugin.data.directIndexPaths, [B]);
  assert.equal(restarted.local.get(VAULT_RENAME_JOURNAL_KEY), null);
});

test("D03: a failed binding write keeps bootstrap scope and defers the repair", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  const stored = structuredClone(h.local.get(VAULT_RENAME_JOURNAL_KEY));
  const app = h.plugin.app as unknown as { saveLocalStorage(key: string, value: unknown): void };
  const save = app.saveLocalStorage.bind(app);
  app.saveLocalStorage = (key, value) => {
    if (key === VAULT_RENAME_JOURNAL_KEY) throw new Error("simulated binding write failure");
    save(key, value);
  };
  await arrive(h, establishedStore("vault-d03-bind-fail", [A]));
  assert.deepEqual(h.plugin.data.directIndexPaths, [A], "no repair without a durable binding");
  assert.deepEqual(h.local.get(VAULT_RENAME_JOURNAL_KEY), stored);
});

test("D03 downgrade: the 0.26.1 reader fails read-only on a v2 journal and deletes nothing", () => {
  // Frozen copy of the released (0.26.1) strict parser contract.
  const releasedParse = (input: unknown): void => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("malformed");
    const value = input as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== ["renames", "vaultId", "version"].join(",")
      || value.version !== 1
      || !Array.isArray(value.renames)
      || value.renames.length === 0) {
      throw new Error("unsupported or malformed shape");
    }
  };
  const entry = { oldPath: A, newPath: B, folderRename: false };
  const written = [
    { version: 2, scope: { kind: "bootstrap", bootstrapId: "bootstrap-x", expectedVaultId: null }, renames: [entry], blocked: null },
    { version: 2, scope: { kind: "bound", vaultId: "vault-d03-down" }, renames: [entry], blocked: null },
  ];
  for (const journal of written) {
    const storage = new Map<string, unknown>([[VAULT_RENAME_JOURNAL_KEY, structuredClone(journal)]]);
    let readOnly = false;
    try { releasedParse(storage.get(VAULT_RENAME_JOURNAL_KEY)); } catch { readOnly = true; }
    assert.equal(readOnly, true, "the released reader treats it as damaged and enters read-only recovery");
    assert.deepEqual(storage.get(VAULT_RENAME_JOURNAL_KEY), journal, "the released reader never rewrites or deletes it");
  }
  // This build never writes the released shape for new journals, and still reads it.
  assert.doesNotThrow(() => releasedParse({ version: 1, vaultId: "vault-d03-down", renames: [entry] }));
  assert.equal(parseVaultRenameJournal({ version: 1, vaultId: "vault-d03-down", renames: [entry] }).scope.kind, "bound");
});
