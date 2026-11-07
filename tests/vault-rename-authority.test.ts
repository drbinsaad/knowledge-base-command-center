import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, { DEVICE_LOCAL_STATE_KEY, VAULT_RENAME_JOURNAL_KEY } from "../src/main.ts";
import { createDefaultStore, createDeviceLocalPluginState, migrateData, type PluginStore } from "../src/model.ts";
import {
  MAX_PENDING_VAULT_RENAMES,
  parseVaultRenameJournal,
  type VaultRenameJournal,
} from "../src/vault-rename-journal.ts";
import { TAbstractFile, TFile, TFolder } from "obsidian";

// D03 correction batch (R1-R4). Each case is an actual-handler reproduction of
// a reviewed defect; synthetic data only.

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
  start(): Promise<void>;
  rename(from: string, to: string, folder?: boolean): void;
}

function harness(options: { disk: unknown; local?: Map<string, unknown>; files?: readonly TAbstractFile[] }): Harness {
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
    plugin, internal, local, files, disk, saves,
    async start() {
      internal.loadVaultRenameJournal();
      await plugin.loadPluginData(false);
      if (internal.activateVaultRenameJournalForCurrentStore()) internal.schedulePendingVaultRenameRepairs();
      await internal.vaultRenameRepairQueue;
    },
    rename(from, to, folder = false) {
      files.delete(from);
      const next = folder ? new TFolder(to) : new TFile(to);
      files.set(to, next);
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
const ENTRY = { oldPath: A, newPath: B, folderRename: false };

test("D03 R2: a persisted fresh-ID primary keeps ordinary rename behaviour", async () => {
  const h = harness({ disk: establishedStore("vault-fresh-abcdefghijklmnop", [A]), files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  await h.internal.vaultRenameRepairQueue;
  assert.deepEqual(h.plugin.data.directIndexPaths, [B]);
  assert.equal(h.saves.length, 1, "one semantic save");
  assert.equal(h.local.get(VAULT_RENAME_JOURNAL_KEY), null, "the journal clears after the durable save");
});

// vault-migrated-<fingerprint>-<nonce> is created for upgraded stores that had
// no vault ID (model.ts migrateStore) and is then written back and kept: it is
// a real, persisted identity, not a transient one.
const MIGRATED_ID = "vault-migrated-0123456789abcdef-abcdefghijkl";

test("D03: a persisted vault-migrated primary keeps ordinary rename behaviour (one save, journal cleared)", async () => {
  const h = harness({ disk: establishedStore(MIGRATED_ID, [A]), files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  await h.internal.vaultRenameRepairQueue;
  assert.deepEqual(h.plugin.data.directIndexPaths, [B]);
  assert.equal(h.local.get(VAULT_RENAME_JOURNAL_KEY), null);
  assert.equal(h.saves.length, 1);
});

test("D03: a bootstrap journal binds to a persisted vault-migrated primary loaded from disk at startup", async () => {
  const bootstrap = {
    version: 2,
    scope: { kind: "bootstrap", bootstrapId: "bootstrap-d03-migrated", expectedVaultId: null },
    renames: [ENTRY],
    blocked: null,
  };
  const h = harness({
    disk: establishedStore(MIGRATED_ID, [A]),
    local: new Map([[VAULT_RENAME_JOURNAL_KEY, bootstrap]]),
    files: [new TFile(B)],
  });
  await h.start();
  assert.deepEqual(h.plugin.data.directIndexPaths, [B], "the persisted identity is authoritative at startup");
  assert.equal(h.local.get(VAULT_RENAME_JOURNAL_KEY), null);
  // And a later ordinary rename is not stranded in the closed episode.
  h.files.set(B, new TFile(B));
  h.rename(B, C);
  await h.internal.vaultRenameRepairQueue;
  assert.deepEqual(h.plugin.data.directIndexPaths, [C]);
});

test("D03 R3: a retained bound journal (v1 and v2) never relinks a reused source path on restart", async () => {
  const raws = [
    { version: 1, vaultId: "vault-bound", renames: [ENTRY] },
    { version: 2, scope: { kind: "bound", vaultId: "vault-bound" }, renames: [ENTRY], blocked: null },
  ];
  for (const raw of raws) {
    const h = harness({
      disk: establishedStore("vault-bound", [A]),
      local: new Map([[VAULT_RENAME_JOURNAL_KEY, raw]]),
      files: [new TFile(A), new TFile(B)],
    });
    await h.start();
    assert.deepEqual(h.plugin.data.directIndexPaths, [A], "the new note at the old name keeps its membership");
    assert.equal(h.saves.length, 0);
    const kept = journalOf(h);
    assert.equal(kept?.blocked, "ambiguous-path", "evidence is kept and visibly blocked");
    assert.deepEqual(kept?.renames, [ENTRY]);
  }
});

test("D03 R3: a file rename whose terminal path became a folder is rejected (and the reverse)", async () => {
  const wrongKind = harness({ disk: null, files: [new TFile(A)] });
  await wrongKind.start();
  wrongKind.rename(A, B);
  wrongKind.files.set(B, new TFolder(B));
  await arrive(wrongKind, establishedStore("vault-wrongtype", [A]));
  assert.deepEqual(wrongKind.plugin.data.directIndexPaths, [A]);
  assert.equal(journalOf(wrongKind)?.blocked, "ambiguous-path");

  const reverse = harness({ disk: null, files: [new TFolder("Old")] });
  await reverse.start();
  reverse.rename("Old", "New", true);
  reverse.files.set("New", new TFile("New"));
  await arrive(reverse, establishedStore("vault-wrongtype-reverse", ["Old/n.md"]));
  assert.deepEqual(reverse.plugin.data.directIndexPaths, ["Old/n.md"]);
  assert.equal(journalOf(reverse)?.blocked, "ambiguous-path");
});

test("D03 R4: a blocked bound journal keeps its complete prefix and does not grow", async () => {
  const raw = { version: 2, scope: { kind: "bound", vaultId: "vault-blocked" }, renames: [ENTRY], blocked: "overflow" };
  const h = harness({
    disk: establishedStore("vault-blocked", [A]),
    local: new Map([[VAULT_RENAME_JOURNAL_KEY, raw]]),
    files: [new TFile(B), new TFile(C)],
  });
  await h.start();
  h.rename(C, "Notes/Delta.md");
  await h.internal.vaultRenameRepairQueue;
  assert.deepEqual(journalOf(h)?.renames, [ENTRY]);
  assert.equal(h.internal.pendingVaultRenames.length, 1);
  assert.equal(journalOf(h)?.blocked, "overflow");
});

test("D03 R1: two Sync captures (legacy, then established) never bind early to the provisional identity", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  const flat = migrateData(null);
  flat.directIndexPaths = [A];
  flat.pinnedPaths = [A];
  h.disk.value = structuredClone(flat);
  const first = h.plugin.onExternalSettingsChange();
  h.disk.value = structuredClone(establishedStore("vault-final-established", [A]));
  const second = h.plugin.onExternalSettingsChange();
  await Promise.all([first, second]);
  await h.internal.vaultRenameRepairQueue;
  assert.equal(h.plugin.store.vaultId, "vault-final-established");
  assert.deepEqual(h.plugin.data.directIndexPaths, [B], "the repair reaches the final identity");
  const left = journalOf(h);
  if (left !== null) assert.deepEqual(left.scope, { kind: "bound", vaultId: "vault-final-established" });
  assert.equal(h.plugin.isDataReadOnly(), false);
});

test("D03 R1: a legacy-only arrival does not discharge the missing-primary episode", async () => {
  const h = harness({ disk: null, files: [new TFile(A)] });
  await h.start();
  h.rename(A, B);
  const flat = migrateData(null);
  flat.directIndexPaths = [A];
  await arrive(h, flat);
  assert.equal(journalOf(h)?.scope.kind, "bootstrap", "still waiting for an established identity");
  assert.deepEqual(h.plugin.data.directIndexPaths, [A]);
});

test("D03 R1: a retained bound journal that conflicts with a retained profile is preserved, not replayed", async () => {
  const raw = { version: 2, scope: { kind: "bound", vaultId: "vault-expected-x" }, renames: [ENTRY], blocked: null };
  const profile = createDeviceLocalPluginState(establishedStore("vault-expected-y", [A]));
  const h = harness({
    disk: null,
    local: new Map<string, unknown>([[VAULT_RENAME_JOURNAL_KEY, raw], [DEVICE_LOCAL_STATE_KEY, profile]]),
    files: [new TFile(B)],
  });
  await h.start();
  await arrive(h, establishedStore("vault-expected-x", [A]));
  assert.deepEqual(h.plugin.data.directIndexPaths, [A]);
  assert.deepEqual(h.local.get(VAULT_RENAME_JOURNAL_KEY), raw, "conflicting evidence is preserved byte for byte");
});

test("D03 R4: a foreign retained journal in a read-only session cannot grow the pending array past the bound", async () => {
  const raw = { version: 2, scope: { kind: "bound", vaultId: "vault-foreign" }, renames: [ENTRY], blocked: null };
  const h = harness({
    disk: establishedStore("vault-current", [A]),
    local: new Map([[VAULT_RENAME_JOURNAL_KEY, raw]]),
    files: [new TFile(B)],
  });
  await h.start();
  await arrive(h, { ...establishedStore("vault-current", [A]), version: 9999 });
  assert.equal(h.plugin.isDataReadOnly(), true);
  const oldError = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < MAX_PENDING_VAULT_RENAMES + 1; i += 1) {
      h.internal.handleVaultRenameEvent(new TFile(`New/${i}.md`), `Old/${i}.md`);
    }
    assert.ok(h.internal.pendingVaultRenames.length <= MAX_PENDING_VAULT_RENAMES);
    await h.internal.vaultRenameRepairQueue;
    assert.ok(h.internal.pendingVaultRenames.length <= MAX_PENDING_VAULT_RENAMES);
    assert.deepEqual(h.local.get(VAULT_RENAME_JOURNAL_KEY), raw, "foreign raw authority is never overwritten");
    assert.equal(h.internal.projectPendingRenamePath("Old/0.md"), "Old/0.md", "foreign entries are not projected");
  } finally {
    console.error = oldError;
  }
});
