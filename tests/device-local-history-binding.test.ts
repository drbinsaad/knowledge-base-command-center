import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, { DEVICE_LOCAL_STATE_KEY } from "../src/main.ts";
import {
  boundedSemanticLineage,
  createDefaultStore,
  createDeviceLocalPluginState,
  createKnowledgeBaseEntry,
  migrateData,
  DeviceLocalFutureVersionError,
  nextSemanticHead,
  parseDeviceLocalPluginState,
  semanticEntryFingerprint,
  snapshotPersonal,
  type PluginStore,
} from "../src/model.ts";
import { Notice, TFile } from "obsidian";

// D06 fixtures H01-H16. Everything here is synthetic.

type TestPlugin = EntVaultCommandCenterPlugin & { loadedData: unknown; savedData: unknown[] };
type LocalState = ReturnType<typeof createDeviceLocalPluginState>;

interface Harness {
  plugin: TestPlugin;
  localValues: Map<string, unknown>;
  localWrites: Array<[string, unknown]>;
  primaryWrites: () => unknown[];
  deviceValue: () => LocalState | null;
}

function harness(primary: unknown, local: unknown = null, files: readonly TFile[] = []): Harness {
  const localValues = new Map<string, unknown>();
  if (local !== null) localValues.set(DEVICE_LOCAL_STATE_KEY, structuredClone(local));
  const localWrites: Array<[string, unknown]> = [];
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => [...files],
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      createFolder: async () => {},
      create: async (path: string) => new TFile(path),
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(localValues.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      localValues.set(key, structuredClone(value));
      localWrites.push([key, structuredClone(value)]);
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as TestPlugin;
  plugin.loadedData = structuredClone(primary);
  return {
    plugin,
    localValues,
    localWrites,
    primaryWrites: () => plugin.savedData,
    deviceValue: () => (localValues.get(DEVICE_LOCAL_STATE_KEY) as LocalState | undefined) ?? null,
  };
}

/** A valid causal descendant, exactly as another device would have synced it. */
function advance(entry: PluginStore["bases"][number], change: () => void): void {
  const parentHead = entry.semanticHead;
  change();
  entry.semanticRevision += 1;
  entry.semanticHash = semanticEntryFingerprint(entry);
  entry.semanticHead = nextSemanticHead(parentHead, entry.semanticHash);
  entry.semanticLineage = boundedSemanticLineage([parentHead, ...entry.semanticLineage], entry.semanticHead);
  entry.updatedAt += 1;
}

function resetNotices(): void {
  Notice.messages.length = 0;
}

function historyNotices(): string[] {
  return Notice.messages.filter((message) => /undo history was reset/i.test(message));
}

/** Pin X on a fresh store (so Undo is real), then return the stopped plugin's two stores. */
async function recordPinX(vaultId: string): Promise<{ s0: PluginStore; s1: PluginStore; local: LocalState }> {
  const s0 = createDefaultStore(migrateData(null), 100, vaultId);
  const first = harness(s0);
  await first.plugin.loadPluginData(false);
  await first.plugin.mutate("Pin X", () => { first.plugin.data.pinnedPaths = ["X.md"]; });
  const s1 = structuredClone(first.plugin.savedData.at(-1)) as PluginStore;
  const local = first.deviceValue();
  assert.ok(local, "the first run persisted its device-local profile");
  assert.equal(local.bases[0]?.view.undoStack.length, 1, "pin X has an Undo step");
  return { s0, s1, local };
}

test("H01: history recorded before the primary was replaced by a valid descendant is not executable", async () => {
  resetNotices();
  const { s1, local } = await recordPinX("vault-h01");
  const s2 = structuredClone(s1);
  advance(s2.bases[0], () => { s2.bases[0].data.pinnedPaths = ["X.md", "Y.md"]; });

  const second = harness(s2, local);
  await second.plugin.loadPluginData(false);

  assert.deepEqual(second.plugin.data.pinnedPaths, ["X.md", "Y.md"]);
  assert.equal(second.plugin.data.undoStack.length, 0, "Undo recorded against the old state must not attach to the new state");
  await second.plugin.undo();
  assert.deepEqual(second.plugin.data.pinnedPaths, ["X.md", "Y.md"], "X and Y both survive");
  assert.equal(second.primaryWrites().length, 0, "no history-driven primary write");
  assert.equal(historyNotices().length, 1, "one plain notice");
  assert.match(historyNotices()[0] ?? "", /notes and organization are unchanged/i);
});

const BASE_ID = "base-default";
const LOCAL_VERSION = 5;

function firstBase(state: LocalState | null): LocalState["bases"][number] {
  const base = state?.bases[0];
  assert.ok(base);
  return base;
}

test("H02: a bound same-state restart keeps both stack directions through Undo, Redo and another restart", async () => {
  resetNotices();
  const { s1, local } = await recordPinX("vault-h02");
  const second = harness(s1, local);
  await second.plugin.loadPluginData(false);
  assert.equal(second.plugin.data.undoStack.length, 1);
  assert.equal(historyNotices().length, 0, "same state is silent");

  await second.plugin.undo();
  assert.deepEqual(second.plugin.data.pinnedPaths, []);
  await second.plugin.redo();
  assert.deepEqual(second.plugin.data.pinnedPaths, ["X.md"]);
  await second.plugin.undo();
  const primary = structuredClone(second.plugin.savedData.at(-1)) as PluginStore;
  const third = harness(primary, second.deviceValue());
  await third.plugin.loadPluginData(false);
  assert.equal(third.plugin.data.undoStack.length, 0);
  assert.equal(third.plugin.data.redoStack.length, 1, "the Redo direction is bound to the post-Undo state");
  await third.plugin.redo();
  assert.deepEqual(third.plugin.data.pinnedPaths, ["X.md"]);
  assert.equal(historyNotices().length, 0);
});

test("H03: equal semantics with a different head keep history; a stale advertised hash does not authorize changed semantics", async () => {
  resetNotices();
  const { s1, local } = await recordPinX("vault-h03");
  const sameSemantics = structuredClone(s1);
  sameSemantics.bases[0].semanticRevision += 5;
  sameSemantics.bases[0].semanticHead = nextSemanticHead(sameSemantics.bases[0].semanticHead, sameSemantics.bases[0].semanticHash);
  const kept = harness(sameSemantics, local);
  await kept.plugin.loadPluginData(false);
  assert.equal(kept.plugin.data.undoStack.length, 1);
  assert.equal(historyNotices().length, 0);

  const changed = structuredClone(s1);
  const staleHash = changed.bases[0].semanticHash;
  changed.bases[0].data.pinnedPaths = ["X.md", "Y.md"];
  changed.bases[0].semanticHash = staleHash;
  const fenced = harness(changed, local);
  await fenced.plugin.loadPluginData(false);
  assert.equal(fenced.plugin.data.undoStack.length, 0, "an advertised hash is not proof");
});

test("H04: only the affected base resets; others, empty stacks, archived bases and navigation are handled per base", async () => {
  resetNotices();
  const build = (name: string, pins: string[], withUndo: boolean) => {
    const data = migrateData(null);
    data.settings.workspaceName = name;
    data.pinnedPaths = pins;
    if (withUndo) data.undoStack = [snapshotPersonal(data, `${name} undo`)];
    return data;
  };
  const store = createDefaultStore(build("Alpha", ["a.md"], true), 100, "vault-h04");
  const add = (id: string, name: string, pins: string[], withUndo: boolean, archivedAt: number | null = null) => {
    const entry = createKnowledgeBaseEntry(build(name, pins, withUndo), id, 200);
    entry.archivedAt = archivedAt;
    store.bases.push(entry);
  };
  add("base-b", "Bravo", ["b.md"], true);
  add("base-c", "Charlie", ["c.md"], false);
  add("base-d", "Delta", ["d.md"], true, 300);
  store.bases[0].data.selectedPath = "Keep/Route.md";
  const local = createDeviceLocalPluginState(store);
  const primary = structuredClone(store);
  for (const entry of primary.bases) { entry.data.undoStack = []; entry.data.selectedPath = ""; }
  advance(primary.bases[0], () => { primary.bases[0].data.pinnedPaths = ["a.md", "remote.md"]; });
  advance(primary.bases[3], () => { primary.bases[3].data.pinnedPaths = ["d.md", "remote.md"]; });

  const run = harness(primary, local);
  await run.plugin.loadPluginData(false);
  const byId = (id: string) => run.plugin.getKnowledgeBases(true).find((entry) => entry.id === id);
  assert.equal(byId(BASE_ID)?.data.undoStack.length, 0);
  assert.equal(byId(BASE_ID)?.data.selectedPath, "Keep/Route.md", "navigation survives the reset");
  assert.equal(byId("base-b")?.data.undoStack.length, 1, "the unchanged base keeps its history");
  assert.equal(byId("base-c")?.data.undoStack.length, 0);
  assert.equal(byId("base-d")?.data.undoStack.length, 0, "an archived changed base is fenced too");
  assert.equal(historyNotices().length, 1);
  assert.match(historyNotices()[0], /Alpha/);
  assert.match(historyNotices()[0], /Delta/);
  assert.doesNotMatch(historyNotices()[0], /Bravo|Charlie/);
});

function legacyProfile(local: LocalState, version: 2 | 3 | 4 | 5): Record<string, unknown> {
  const legacy = structuredClone(local) as unknown as Record<string, unknown>;
  legacy.version = version;
  for (const base of legacy.bases as Array<Record<string, unknown>>) delete base.historyBinding;
  if (version === 2) {
    delete legacy.historyIndexFolderSourcesIncluded;
    for (const base of legacy.bases as Array<{ view: { undoStack: Array<Record<string, unknown>> } }>) {
      for (const snapshot of base.view.undoStack) delete snapshot.indexFolderSources;
    }
  }
  return legacy;
}

test("H05: genuine v2-v5 profiles without the extension load, keep navigation, reset unverified history once and stay stable", async () => {
  for (const version of [2, 3, 4, 5] as const) {
    resetNotices();
    const { s1, local } = await recordPinX(`vault-h05-v${version}`);
    local.bases[0].view.selectedPath = "Legacy/Route.md";
    const legacy = legacyProfile(local, version);
    const run = harness(s1, legacy);
    await run.plugin.loadPluginData(false);
    assert.equal(run.plugin.data.selectedPath, "Legacy/Route.md", `v${version} route survives`);
    assert.equal(run.plugin.data.undoStack.length, 0, `v${version} unverified history is not stamped from the primary`);
    assert.equal(historyNotices().length, 1, `v${version} one notice`);
    const rewritten = run.deviceValue();
    assert.equal(rewritten?.version, LOCAL_VERSION);
    assert.equal(firstBase(rewritten).view.undoStack.length, 0);
    assert.equal(firstBase(rewritten).historyBinding, undefined);
    resetNotices();
    const again = harness(s1, rewritten);
    await again.plugin.loadPluginData(false);
    assert.equal(historyNotices().length, 0, `v${version} restart is stable`);
  }
});

test("H06: supported, absent, malformed and future bindings follow the chosen parser policy", async () => {
  const { s1, local } = await recordPinX("vault-h06");
  const good = parseDeviceLocalPluginState(structuredClone(local));
  assert.equal(good.bases[0].historyBinding?.v, 1);
  const withBinding = (binding: unknown) => {
    const copy = structuredClone(local) as unknown as { bases: Array<Record<string, unknown>> };
    if (binding === undefined) delete copy.bases[0].historyBinding;
    else copy.bases[0].historyBinding = binding;
    return copy;
  };
  assert.equal(parseDeviceLocalPluginState(withBinding(undefined)).bases[0].historyBinding, undefined);
  for (const malformed of [{ v: 1, fingerprint: "zz" }, { v: 1 }, "x", { v: 1, fingerprint: "0123456789abcdef", extra: 1 }, { v: 0, fingerprint: "0123456789abcdef" }]) {
    const parsed = parseDeviceLocalPluginState(withBinding(malformed));
    assert.equal(parsed.bases[0].historyBinding, undefined, "malformed means unbound, not a deleted profile");
    assert.equal(parsed.bases[0].view.undoStack.length, 1, "stacks still parse");
  }
  assert.throws(() => parseDeviceLocalPluginState(withBinding({ v: 2, fingerprint: "0123456789abcdef" })), DeviceLocalFutureVersionError);
  const future = { ...structuredClone(local), version: 6 };
  assert.throws(() => parseDeviceLocalPluginState(future), DeviceLocalFutureVersionError);

  // Plugin level: the raw value is untouched, history is empty, nothing replaces it until Clear.
  for (const raw of [future, withBinding({ v: 2, fingerprint: "0123456789abcdef" })]) {
    resetNotices();
    const run = harness(s1, raw);
    await run.plugin.loadPluginData(false);
    assert.equal(run.plugin.data.undoStack.length, 0);
    await run.plugin.mutate("Pin Z", () => { run.plugin.data.pinnedPaths = ["X.md", "Z.md"]; });
    await run.plugin.saveViewState();
    assert.deepEqual(run.localWrites.filter(([key]) => key === DEVICE_LOCAL_STATE_KEY), [], "no device-local write while a newer value is retained");
    assert.deepEqual(run.localValues.get(DEVICE_LOCAL_STATE_KEY), raw, "the raw value is unchanged");
    await assert.rejects(run.plugin.mutate("Needs undo", () => { run.plugin.data.pinnedPaths = []; }, { requireUndo: true }), /newer version/);
    const primaryBefore = run.primaryWrites().length;
    await run.plugin.clearDeviceLocalData();
    assert.equal(run.localValues.get(DEVICE_LOCAL_STATE_KEY), null, "explicit Clear still discards it");
    assert.equal(run.primaryWrites().length, primaryBefore, "Clear writes no data.json");
  }
});

test("H07: a 0.26.1 round trip strips the extension and the fixed build resets those bases", async () => {
  const { s1, local } = await recordPinX("vault-h07");
  const afterOldWriter = legacyProfile(local, 5);
  const run = harness(s1, afterOldWriter);
  await run.plugin.loadPluginData(false);
  assert.equal(run.plugin.data.undoStack.length, 0);
});

test("H08: a required-Undo journal keeps older history only with its prior binding and exact candidate proof", async () => {
  const data = migrateData(null);
  data.undoStack = [snapshotPersonal(data, "Earlier undo")];
  const baseline = createDefaultStore(data, 100, "vault-h08");
  const live = harness(baseline, createDeviceLocalPluginState(baseline));
  await live.plugin.loadPluginData(false);
  let candidate: PluginStore | null = null;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  live.plugin.saveData = async (value: unknown) => {
    candidate = structuredClone(value) as PluginStore;
    entered();
    await releasePromise;
    live.plugin.savedData.push(structuredClone(value));
  };
  const mutation = live.plugin.mutate("Crash-guarded", () => { live.plugin.data.pinnedPaths = ["C.md"]; }, { requireUndo: true });
  await enteredPromise;
  const pending = structuredClone(live.deviceValue());
  release();
  await mutation;
  const prior = pending?.pendingRequiredUndoCommit?.priorHistoryBinding;
  assert.ok(prior, "prior binding captured before the action");
  assert.equal(firstBase(pending).historyBinding?.fingerprint, prior.fingerprint, "no false candidate stamp while staged");
  assert.ok(candidate);

  const exact = harness(candidate, pending);
  await exact.plugin.loadPluginData(false);
  assert.deepEqual(exact.plugin.data.undoStack.map((s) => s.label), ["Earlier undo", "Crash-guarded"]);

  const newer = structuredClone(candidate) as PluginStore;
  advance(newer.bases[0], () => { newer.bases[0].data.pinnedPaths = ["C.md", "Newer.md"]; });
  const fenced = harness(newer, pending);
  await fenced.plugin.loadPluginData(false);
  assert.deepEqual(fenced.plugin.data.undoStack, []);
  assert.deepEqual(fenced.plugin.data.pinnedPaths, ["C.md", "Newer.md"]);

  const beforePrimary = harness(baseline, pending);
  await beforePrimary.plugin.loadPluginData(false);
  assert.deepEqual(beforePrimary.plugin.data.undoStack.map((s) => s.label), ["Earlier undo"], "prior history returns with its binding and matches the parent");

  // A genuine old marker (no prior binding anywhere) keeps only the proven step.
  const old = structuredClone(pending) as unknown as Record<string, unknown>;
  for (const base of old.bases as Array<Record<string, unknown>>) delete base.historyBinding;
  delete (old.pendingRequiredUndoCommit as Record<string, unknown>).priorHistoryBinding;
  const legacy = harness(candidate, old);
  await legacy.plugin.loadPluginData(false);
  assert.deepEqual(legacy.plugin.data.undoStack.map((s) => s.label), ["Crash-guarded"]);
});

test("H13: saves after fencing never re-stamp old history; a new edit starts a fresh bound chain", async () => {
  resetNotices();
  const { s1, local } = await recordPinX("vault-h13");
  const s2 = structuredClone(s1);
  advance(s2.bases[0], () => { s2.bases[0].data.pinnedPaths = ["X.md", "Y.md"]; });
  const run = harness(s2, local);
  await run.plugin.loadPluginData(false);
  await run.plugin.saveViewState();
  assert.equal(firstBase(run.deviceValue()).view.undoStack.length, 0);
  assert.equal(firstBase(run.deviceValue()).historyBinding, undefined);
  await run.plugin.mutate("Pin Z", () => { run.plugin.data.pinnedPaths = ["X.md", "Y.md", "Z.md"]; });
  assert.equal(firstBase(run.deviceValue()).view.undoStack.length, 1, "only the new step");
  const next = harness(structuredClone(run.plugin.savedData.at(-1)), run.deviceValue());
  await next.plugin.loadPluginData(false);
  await next.plugin.undo();
  assert.deepEqual(next.plugin.data.pinnedPaths, ["X.md", "Y.md"], "Undo only removes Z, never X or Y");
});

test("H15: a rejected write leaves history valid for the restored state", async () => {
  const { s1, local } = await recordPinX("vault-h15");
  const run = harness(s1, local);
  await run.plugin.loadPluginData(false);
  const originalSave = run.plugin.saveData.bind(run.plugin);
  run.plugin.saveData = async () => { throw new Error("disk full"); };
  await assert.rejects(run.plugin.mutate("Pin Q", () => { run.plugin.data.pinnedPaths = ["X.md", "Q.md"]; }));
  run.plugin.saveData = originalSave;
  assert.equal(run.plugin.data.undoStack.length, 1);
  const restart = harness(s1, run.deviceValue());
  await restart.plugin.loadPluginData(false);
  assert.equal(restart.plugin.data.undoStack.length, 1, "history still names the restored state");
});

test("second gate: applyHistory refuses a pair whose binding no longer names its payload, before any write", async () => {
  resetNotices();
  const { s1, local } = await recordPinX("vault-gate");
  const run = harness(s1, local);
  await run.plugin.loadPluginData(false);
  (run.plugin as unknown as { historyBindingByBase: Map<string, string> }).historyBindingByBase.set(BASE_ID, "0000000000000000");
  await run.plugin.undo();
  assert.deepEqual(run.plugin.data.pinnedPaths, ["X.md"]);
  assert.equal(run.primaryWrites().length, 0);
  assert.equal(run.plugin.data.undoStack.length, 0);
  assert.equal(historyNotices().length, 1);
});

test("H16: Clear removes the profile and nothing recreates it in the suppressed session", async () => {
  const { s1, local } = await recordPinX("vault-h16");
  const run = harness(s1, local);
  await run.plugin.loadPluginData(false);
  await run.plugin.clearDeviceLocalData();
  await run.plugin.saveViewState();
  assert.equal(run.localValues.get(DEVICE_LOCAL_STATE_KEY), null);
  assert.equal(run.primaryWrites().length, 0);
});
