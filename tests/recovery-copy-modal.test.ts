import assert from "node:assert/strict";
import test from "node:test";
import { RecoveryCopyModal, type RecoveryApplyResult, type RecoveryCopyModalCallbacks, type RecoveryDestination } from "../src/recovery-copy-modal.ts";
import {
  RECOVERY_DISCOVERY_LIMITS,
  discoverRecoveryCopies,
  loadRecoveryCopy,
  recoverySourceUnchanged,
  type RecoveryCandidate,
  type RecoveryDiscoveryResult,
  type RecoveryHost,
} from "../src/recovery-discovery.ts";
import { RECOVERY_COPY_CONFLICT_RESCUE_KIND, RECOVERY_COPY_LIMITS, createRecoveryRestoreIntent, type RecoveryRestoreIntent } from "../src/recovery-copy.ts";
import { createDefaultStore, snapshotPersonal, type PluginStore } from "../src/model.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";

const VAULT = "vault-synthetic-one";
const EXPORTS = "Private Exports";
const LEGACY = "Legacy Exports";
const PLUGIN_DIR = ".obsidian/plugins/synthetic-plugin";
const NOW = Date.now();

function stamp(index: number): string {
  return `2026-11-0${(index % 9) + 1}T10-00-00-000Z`;
}

function makeStore(vaultId = VAULT, name = "Synthetic Base"): PluginStore {
  const store = createDefaultStore(undefined, NOW - 1000, vaultId);
  const base = store.bases[0];
  base.data.settings.workspaceName = name;
  base.data.pinnedPaths = ["Synthetic/a.md"];
  base.data.undoStack = [snapshotPersonal(base.data, "Undo me")];
  return store;
}

function rescueText(store: PluginStore, exportedAt = new Date(NOW - 60_000).toISOString()): string {
  return JSON.stringify({ kind: RECOVERY_COPY_CONFLICT_RESCUE_KIND, version: 1, exportedAt, reason: "synthetic", privacy: "synthetic", store });
}

interface FileInfo { content: string; mtime: number | null; size?: number }

function makeHost(files: Record<string, FileInfo>, folders: Record<string, string[] | null>) {
  const reads: string[] = [];
  const host: RecoveryHost = {
    list: async (folder) => {
      const entry = folders[folder];
      if (entry === undefined) return null;
      return entry;
    },
    stat: async (path) => {
      const file = files[path];
      return file ? { size: file.size ?? new TextEncoder().encode(file.content).length, mtime: file.mtime } : null;
    },
    read: async (path) => {
      reads.push(path);
      const file = files[path];
      if (!file) throw new Error("missing");
      return file.content;
    },
  };
  return { host, reads };
}

const input = { exportFolders: [EXPORTS], legacyExportFolder: LEGACY, pluginDir: PLUGIN_DIR };

test("discovery lists only documented candidates from the inspected folders, newest first, without reading", async () => {
  const conflictNew = `${EXPORTS}/knowledge-base-command-center-conflict-${stamp(2)}.json`;
  const conflictOld = `${LEGACY}/knowledge-base-command-center-conflict-${stamp(1)}.json`;
  const kept = `${PLUGIN_DIR}/data.json.bak-kept-${stamp(3)}`;
  const files: Record<string, FileInfo> = {
    [conflictNew]: { content: "x", mtime: 300 },
    [conflictOld]: { content: "x", mtime: 100 },
    [kept]: { content: "x", mtime: 200 },
  };
  const { host, reads } = makeHost(files, {
    [EXPORTS]: [conflictNew, `${EXPORTS}/knowledge-base-command-center-portable-${stamp(1)}.json`, `${EXPORTS}/sub/knowledge-base-command-center-conflict-${stamp(1)}.json`, `${EXPORTS}/notes.md`],
    [LEGACY]: [conflictOld],
    [PLUGIN_DIR]: [kept, `${PLUGIN_DIR}/data.json`, `${PLUGIN_DIR}/main.js`],
  });
  const result = await discoverRecoveryCopies(host, input);
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), [conflictNew, kept, conflictOld]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.origin), ["export-folder", "kept-backup", "legacy-export-folder"]);
  assert.equal(result.candidates[0].displayName, `knowledge-base-command-center-conflict-${stamp(2)}.json`);
  assert.equal(result.inspectedFolders, 3);
  assert.equal(result.unreadableFolders, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(reads, [], "discovery never reads file contents");
  assert.match(result.summary, /Found 3 candidate files in the 3 folders checked/);
  assert.match(result.summary, /not searched/);
  assert.match(result.summary, /only a hint/);
  assert.doesNotMatch(result.summary, /Private Exports|Legacy Exports|synthetic-plugin|\//);
});

test("discovery counting never claims a missing or failing folder proves anything", async () => {
  const { host } = makeHost({}, { [EXPORTS]: [] });
  const none = await discoverRecoveryCopies(host, input);
  assert.equal(none.candidates.length, 0);
  assert.equal(none.inspectedFolders, 1);
  assert.equal(none.unreadableFolders, 2);
  assert.match(none.summary, /No candidate files were found in the 1 folder checked/);
  assert.match(none.summary, /2 folders could not be read; that does not mean nothing is there/);
  const throwing = await discoverRecoveryCopies({ ...host, list: async () => { throw new Error("boom"); } }, input);
  assert.equal(throwing.unreadableFolders, 3);
  assert.equal(throwing.inspectedFolders, 0);
});

test("discovery bounds the listing and the files it stats", async () => {
  const files: Record<string, FileInfo> = {};
  const names: string[] = [];
  for (let index = 0; index < 250; index += 1) {
    const path = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-${String(index).padStart(3, "0")}Z.json`;
    files[path] = { content: "x", mtime: index };
    names.push(path);
  }
  const { host } = makeHost(files, { [EXPORTS]: names, [LEGACY]: [], [PLUGIN_DIR]: [] });
  let statCalls = 0;
  const counting: RecoveryHost = { ...host, stat: async (path) => { statCalls += 1; return host.stat(path); } };
  const result = await discoverRecoveryCopies(counting, input);
  assert.equal(result.candidates.length, RECOVERY_DISCOVERY_LIMITS.maxListed);
  assert.equal(statCalls, RECOVERY_DISCOVERY_LIMITS.maxStatted);
  assert.equal(result.truncated, true);
  assert.match(result.summary, /Showing 50 candidate files/);
  assert.match(result.summary, /more were found than are listed/);
  assert.equal(result.candidates[0].mtime, 199, "newest of the stat-ed set first");
});

test("a partial scan says so for zero and nonzero results and never claims more exist without evidence", async () => {
  const bound = RECOVERY_DISCOVERY_LIMITS.maxEntriesPerFolder;
  const match = `${EXPORTS}/knowledge-base-command-center-conflict-${stamp(1)}.json`;
  const notes = Array.from({ length: bound }, (_, index) => `${EXPORTS}/note-${index}.md`);
  // One real candidate plus 2,000 unrelated files: exactly one candidate exists.
  const oneAmongMany = makeHost({ [match]: { content: "x", mtime: 1 } }, { [EXPORTS]: [match, ...notes], [LEGACY]: [], [PLUGIN_DIR]: [] });
  const some = await discoverRecoveryCopies(oneAmongMany.host, input);
  assert.equal(some.candidates.length, 1);
  assert.doesNotMatch(some.summary, /more exist/);
  assert.match(some.summary, /partial/);
  assert.match(some.summary, /may exist/);
  // 2,000 unrelated files before the only candidate: zero found, but not a complete answer.
  const hidden = makeHost({ [match]: { content: "x", mtime: 1 } }, { [EXPORTS]: [...notes, match], [LEGACY]: [], [PLUGIN_DIR]: [] });
  const none = await discoverRecoveryCopies(hidden.host, input);
  assert.equal(none.candidates.length, 0);
  assert.match(none.summary, /partial/);
  assert.match(none.summary, /may exist/);
  assert.doesNotMatch(none.summary, /No candidate files were found in the 3 folders checked\./);
  // Ordinary complete zero result is unchanged and not described as partial.
  const complete = makeHost({}, { [EXPORTS]: [`${EXPORTS}/a.md`], [LEGACY]: [], [PLUGIN_DIR]: [] });
  const empty = await discoverRecoveryCopies(complete.host, input);
  assert.match(empty.summary, /No candidate files were found in the 3 folders checked\./);
  assert.doesNotMatch(empty.summary, /partial|may exist/);
  assert.equal(empty.truncated, false);
  // Candidates actually observed beyond the stat bound are reported as known.
  const files: Record<string, FileInfo> = {};
  const many: string[] = [];
  for (let index = 0; index < RECOVERY_DISCOVERY_LIMITS.maxStatted + 5; index += 1) {
    const path = `${EXPORTS}/knowledge-base-command-center-conflict-2026-11-01T10-00-00-${String(index).padStart(3, "0")}Z.json`;
    files[path] = { content: "x", mtime: index };
    many.push(path);
  }
  const known = await discoverRecoveryCopies(makeHost(files, { [EXPORTS]: many, [LEGACY]: [], [PLUGIN_DIR]: [] }).host, input);
  assert.match(known.summary, /more were found than are listed/);
});

test("one physical folder named twice is counted once", async () => {
  const { host } = makeHost({}, { [PLUGIN_DIR]: [] });
  const result = await discoverRecoveryCopies(host, { exportFolders: [PLUGIN_DIR], legacyExportFolder: PLUGIN_DIR, pluginDir: PLUGIN_DIR });
  assert.equal(result.inspectedFolders, 1);
  assert.match(result.summary, /in the 1 folder checked/);
});

test("discovery examines only the first entries of a huge folder", async () => {
  const filler = Array.from({ length: RECOVERY_DISCOVERY_LIMITS.maxEntriesPerFolder }, (_, index) => `${EXPORTS}/note-${index}.md`);
  const early = `${EXPORTS}/knowledge-base-command-center-conflict-${stamp(1)}.json`;
  const late = `${EXPORTS}/knowledge-base-command-center-conflict-${stamp(2)}.json`;
  const { host } = makeHost({ [early]: { content: "x", mtime: 1 }, [late]: { content: "x", mtime: 2 } }, {
    [EXPORTS]: [early, ...filler.slice(1), late],
    [LEGACY]: [],
    [PLUGIN_DIR]: [],
  });
  const result = await discoverRecoveryCopies(host, input);
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), [early], "entries past the per-folder bound are not examined");
  assert.equal(result.truncated, true);
});

test("loading checks the declared size before reading and classifies bad files as not restorable", async () => {
  const good = `${PLUGIN_DIR}/data.json.bak-kept-${stamp(1)}`;
  const bad = `${PLUGIN_DIR}/data.json.bak-kept-${stamp(2)}`;
  const huge = `${PLUGIN_DIR}/data.json.bak-kept-${stamp(3)}`;
  const files: Record<string, FileInfo> = {
    [good]: { content: JSON.stringify(makeStore()), mtime: 1 },
    [bad]: { content: "{\"kind\": ", mtime: 2 },
    [huge]: { content: "x", mtime: 3, size: RECOVERY_COPY_LIMITS.maxBytes + 1 },
  };
  const { host, reads } = makeHost(files, {});
  const ok = await loadRecoveryCopy(host, good, { currentVaultId: VAULT });
  assert.equal(ok.status === "parsed" && ok.result.ok, true);
  const malformed = await loadRecoveryCopy(host, bad, { currentVaultId: VAULT });
  assert.equal(malformed.status === "parsed" && !malformed.result.ok && malformed.result.reason, "malformed-json");
  reads.length = 0;
  const oversized = await loadRecoveryCopy(host, huge, { currentVaultId: VAULT });
  assert.equal(oversized.status === "parsed" && !oversized.result.ok && oversized.result.reason, "too-large");
  assert.deepEqual(reads, [], "no read for an oversized declared size");
  assert.equal((await loadRecoveryCopy(host, `${PLUGIN_DIR}/missing`, { currentVaultId: VAULT })).status, "unreadable");
  const failing = await loadRecoveryCopy({ ...host, read: async () => { throw new Error("denied"); } }, good, { currentVaultId: VAULT });
  assert.equal(failing.status, "unreadable");
});

test("apply-time reread compares bytes exactly and treats changed or missing sources as stale", async () => {
  const path = `${PLUGIN_DIR}/data.json.bak-kept-${stamp(1)}`;
  const text = JSON.stringify(makeStore());
  const files: Record<string, FileInfo> = { [path]: { content: text, mtime: 1 } };
  const { host } = makeHost(files, {});
  const loaded = await loadRecoveryCopy(host, path, { currentVaultId: VAULT });
  assert.ok(loaded.status === "parsed" && loaded.result.ok);
  if (!(loaded.status === "parsed" && loaded.result.ok)) return;
  const made = createRecoveryRestoreIntent({
    parsed: loaded.result, selectedBaseId: loaded.result.store.bases[0].id, existingNames: [], existingBaseIds: [],
    generateIdentity: () => ({ baseId: "base-new", semanticHead: "0123456789abcdef" }),
  });
  assert.ok(made.ok);
  if (!made.ok) return;
  assert.equal(await recoverySourceUnchanged(host, path, made.intent), true);
  files[path] = { content: text.replace("Synthetic Base", "Synthetic Basf"), mtime: 2 };
  assert.equal(await recoverySourceUnchanged(host, path, made.intent), false);
  // An invalid or oversized stat fails closed before any read, even when the bytes are unchanged.
  for (const size of [Number.NaN, -1, Number.POSITIVE_INFINITY, RECOVERY_COPY_LIMITS.maxBytes + 1]) {
    files[path] = { content: text, mtime: 3, size };
    const guarded = makeHost(files, {});
    assert.equal(await recoverySourceUnchanged(guarded.host, path, made.intent), false, String(size));
    assert.deepEqual(guarded.reads, [], `no read for stat size ${String(size)}`);
  }
  files[path] = { content: text, mtime: 4 };
  assert.equal(await recoverySourceUnchanged(host, path, made.intent), true, "valid control");
  files[path] = { content: text.replace("Synthetic Base", "Synthetic Basf"), mtime: 2 };
  delete files[path];
  assert.equal(await recoverySourceUnchanged(host, path, made.intent), false);
});

// ---------------------------------------------------------------- modal

interface Harness {
  modal: RecoveryCopyModal;
  content: FakeElement;
  document: ReturnType<typeof createFakeDom>["document"];
  applied: RecoveryRestoreIntent[];
  destinations: RecoveryDestination[];
  opened: string[];
  loads: RecoveryCandidate[];
  closed(): boolean;
}

interface HarnessOptions {
  files?: Record<string, FileInfo>;
  readOnly?: boolean;
  existingNames?: string[];
  applyResult?: RecoveryApplyResult | "throw";
  vaultId?: string | null;
  unreadable?: boolean;
  loadGate?: Promise<void>;
  discoverGate?: Promise<void>;
  applyGate?: Promise<void>;
  destinationEpoch?: { value: number };
}

function candidatesFor(files: Record<string, FileInfo>): RecoveryCandidate[] {
  return Object.keys(files).map((path, index) => ({
    id: `copy-${index + 1}`, path, displayName: path.slice(path.lastIndexOf("/") + 1),
    origin: "kept-backup" as const, size: files[path].content.length, mtime: files[path].mtime,
  }));
}

async function openModal(options: HarnessOptions = {}): Promise<Harness> {
  const files = options.files ?? {
    [`${PLUGIN_DIR}/data.json.bak-kept-${stamp(1)}`]: { content: rescueText(makeStore()), mtime: NOW - 5000 },
  };
  const { host } = makeHost(files, {});
  const candidates = candidatesFor(files);
  const applied: RecoveryRestoreIntent[] = [];
  const destinations: RecoveryDestination[] = [];
  const destinationEpoch = options.destinationEpoch ?? { value: 1 };
  const opened: string[] = [];
  const loads: RecoveryCandidate[] = [];
  let identityCount = 0;
  const callbacks: RecoveryCopyModalCallbacks = {
    isReadOnly: () => options.readOnly ?? false,
    getCurrentVaultId: () => options.vaultId === undefined ? VAULT : options.vaultId,
    getExistingNames: () => options.existingNames ?? ["Synthetic Base"],
    getExistingBaseIds: () => ["base-existing"],
    generateIdentity: () => { identityCount += 1; return { baseId: `base-restored-${identityCount}`, semanticHead: "0123456789abcdef" }; },
    discover: async (): Promise<RecoveryDiscoveryResult> => (await options.discoverGate, {
      candidates, inspectedFolders: 2, unreadableFolders: 0, truncated: false,
      summary: `Found ${candidates.length} candidate files in the 2 folders checked. Other folders and older locations are not searched.`,
    }),
    load: async (candidate) => {
      loads.push(candidate);
      await options.loadGate;
      if (options.unreadable) return { status: "unreadable" };
      return loadRecoveryCopy(host, candidate.path, { currentVaultId: options.vaultId === undefined ? VAULT : options.vaultId });
    },
    getDestination: () => ({ epoch: destinationEpoch.value, vaultId: VAULT, activeBaseId: "base-default" }),
    onApply: async (intent, destination) => {
      applied.push(intent);
      destinations.push(destination);
      await options.applyGate;
      if (options.applyResult === "throw") throw new Error("write exploded at /private/path");
      return options.applyResult ?? { status: "applied", baseId: intent.newBaseId };
    },
    onOpenRestored: (baseId) => { opened.push(baseId); },
  };
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const title = root.createDiv();
  const content = root.createDiv();
  const modal = new RecoveryCopyModal({} as never, callbacks);
  let closed = false;
  Object.assign(modal, { modalEl: asHtmlElement(root), titleEl: asHtmlElement(title), contentEl: asHtmlElement(content) });
  modal.close = () => { closed = true; modal.onClose(); };
  modal.onOpen();
  await settle();
  return { modal, content, document: dom.document, applied, destinations, opened, loads, closed: () => closed };
}

async function settle(): Promise<void> {
  // All host callbacks are promise chains, so microtask turns are enough.
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

function buttons(content: FakeElement): FakeElement[] {
  return content.querySelectorAll("button");
}

function button(content: FakeElement, text: string): FakeElement {
  const match = buttons(content).find((candidate) => candidate.textContent === text || candidate.getAttribute("aria-label") === text);
  assert.ok(match, `missing button: ${text}; have ${buttons(content).map((item) => item.textContent).join(" | ")}`);
  return match;
}

function hasButton(content: FakeElement, text: string): boolean {
  return buttons(content).some((candidate) => candidate.textContent === text);
}

function liveText(content: FakeElement): string {
  return [".ent-cc-sync-recovery-recheck-status", ".ent-cc-form-error"]
    .map((selector) => content.querySelector(selector)?.textContent ?? "").join(" | ");
}

async function toPreview(harness: Harness): Promise<void> {
  button(harness.content, "Review").click();
  await settle();
}

async function toName(harness: Harness): Promise<void> {
  await toPreview(harness);
  button(harness.content, "Restore this base").click();
}

async function toConfirm(harness: Harness): Promise<void> {
  await toName(harness);
  button(harness.content, "Continue").click();
}

function nameInput(content: FakeElement): FakeElement & { value: string; disabled?: boolean } {
  const input = content.querySelector("input[type=\"text\"]");
  assert.ok(input, "name input");
  return input;
}

test("the list page shows the discovery wording and file names but no path", async () => {
  const harness = await openModal();
  assert.match(harness.content.textContent, /Found 1 candidate files in the 2 folders checked/);
  assert.match(harness.content.textContent, /data\.json\.bak-kept-/);
  assert.doesNotMatch(harness.content.textContent, /obsidian|synthetic-plugin|Private Exports/i);
  assert.match(liveText(harness.content), /Found 1 candidate/);
});

test("the preview renders every design field and the private-content disclosure", async () => {
  const harness = await openModal();
  await toPreview(harness);
  const text = harness.content.textContent;
  assert.match(text, /Source.*Sync conflict rescue/);
  assert.match(text, /Date.*\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  assert.match(text, /Format.*Supported/);
  assert.match(text, /Vault.*This vault/);
  assert.match(text, /Synthetic Base/);
  assert.match(text, /Generic/);
  assert.match(text, /1 pinned/);
  assert.match(text, /1 Undo and 0 Redo steps \(not restored\)/);
  assert.match(text, /exact vault-relative paths/);
  assert.match(text, /Clear device-local data does not remove these copies/);
  assert.equal(harness.loads.length, 1);
});

test("a malformed kept file is shown as preserved, not restorable, with no restore action", async () => {
  const harness = await openModal({ files: { [`${PLUGIN_DIR}/data.json.bak-kept-${stamp(1)}`]: { content: "{\"kind\": ", mtime: 1 } } });
  await toPreview(harness);
  assert.match(harness.content.textContent, /Preserved, not restorable/);
  assert.match(harness.content.textContent, /not valid JSON/);
  assert.equal(hasButton(harness.content, "Restore this base"), false);
  assert.match(liveText(harness.content), /Preserved, not restorable/);
});

test("an unreadable file is preserved and uncounted, and a foreign vault offers portable guidance only", async () => {
  const unreadable = await openModal({ unreadable: true });
  await toPreview(unreadable);
  assert.match(unreadable.content.textContent, /Preserved, not restorable/);
  assert.match(unreadable.content.textContent, /could not be read/);
  assert.equal(hasButton(unreadable.content, "Restore this base"), false);
  const foreign = await openModal({ files: { [`${PLUGIN_DIR}/data.json.bak-kept-${stamp(1)}`]: { content: JSON.stringify(makeStore("vault-other-xyz")), mtime: 1 } } });
  await toPreview(foreign);
  assert.match(foreign.content.textContent, /A different vault/);
  assert.match(foreign.content.textContent, /portable/i);
  assert.equal(hasButton(foreign.content, "Restore this base"), false);
});

test("the restored name is suggested uniquely, editable and validated", async () => {
  const harness = await openModal({ existingNames: ["Synthetic Base", "Synthetic Base (restored)"] });
  await toName(harness);
  const input = nameInput(harness.content);
  assert.equal(input.value, "Synthetic Base (restored 2)");
  const next = button(harness.content, "Continue") as FakeElement & { disabled: boolean };
  assert.equal(next.disabled, false);
  input.value = "synthetic base";
  input.dispatch("input");
  assert.equal(next.disabled, true);
  assert.match(harness.content.textContent, /already exists/);
  input.value = "";
  input.dispatch("input");
  assert.equal(next.disabled, true);
  input.value = "My recovered base";
  input.dispatch("input");
  assert.equal(next.disabled, false);
  next.click();
  assert.match(harness.content.textContent, /New base name.*My recovered base/);
  assert.match(harness.content.textContent, /Undo and Redo history/);
});

test("Apply fires onApply once with the intent, then offers Open restored base which fires only on click", async () => {
  const harness = await openModal();
  await toConfirm(harness);
  assert.equal(hasButton(harness.content, "Open restored base"), false);
  button(harness.content, "Restore as new base").click();
  await settle();
  assert.equal(harness.applied.length, 1);
  const intent = harness.applied[0];
  assert.equal(intent.newBaseId, "base-restored-1");
  assert.equal(intent.name, "Synthetic Base (restored)");
  assert.equal(intent.preset, "generic");
  assert.deepEqual(intent.entry.data.undoStack, []);
  assert.equal(harness.opened.length, 0, "applying alone never opens the base");
  assert.match(liveText(harness.content), /Restored as “Synthetic Base \(restored\)”/);
  button(harness.content, "Open restored base").click();
  await settle();
  assert.deepEqual(harness.opened, ["base-restored-1"]);
});

test("a failed apply shows a persistent error and never offers Open restored base", async () => {
  const harness = await openModal({ applyResult: { status: "failed", message: "The base could not be saved." } });
  await toConfirm(harness);
  button(harness.content, "Restore as new base").click();
  await settle();
  assert.equal(harness.applied.length, 1);
  assert.match(liveText(harness.content), /The base could not be saved\. Nothing was changed\./);
  assert.equal(hasButton(harness.content, "Open restored base"), false);
  // The error survives a re-render caused by another action.
  assert.equal(harness.content.querySelector(".ent-cc-form-error")?.getAttribute("role"), "alert");
  assert.equal(hasButton(harness.content, "Restore as new base"), true);
});

test("an uncertain or throwing apply blocks a second attempt and offers no Open action", async () => {
  for (const applyResult of [{ status: "uncertain" as const, message: "The save may not have finished." }, "throw" as const]) {
    const harness = await openModal({ applyResult });
    await toConfirm(harness);
    button(harness.content, "Restore as new base").click();
    await settle();
    assert.match(liveText(harness.content), /Check Manage knowledge bases/);
    assert.doesNotMatch(liveText(harness.content), /private|exploded/);
    assert.equal(hasButton(harness.content, "Open restored base"), false);
    button(harness.content, "Restore as new base").click();
    await settle();
    assert.equal(harness.applied.length, 1, "no duplicate restore after an uncertain write");
  }
});

test("read-only mode lets the copy be reviewed but disables Apply", async () => {
  const harness = await openModal({ readOnly: true });
  await toConfirm(harness);
  assert.match(harness.content.textContent, /Read-only: restoring is unavailable/);
  const apply = button(harness.content, "Restore as new base") as FakeElement & { disabled: boolean };
  assert.equal(apply.disabled, true);
  apply.click();
  await settle();
  assert.equal(harness.applied.length, 0);
});

test("cancelling at every step fires no apply or open callback", async () => {
  const steps: Array<[string, (harness: Harness) => Promise<void>, string]> = [
    ["list", async () => undefined, "Close"],
    ["preview", toPreview, "Close"],
    ["name", toName, "Cancel"],
    ["confirm", toConfirm, "Cancel"],
  ];
  for (const [, reach, label] of steps) {
    const harness = await openModal();
    await reach(harness);
    button(harness.content, label).click();
    await settle();
    assert.equal(harness.closed(), true, label);
    assert.equal(harness.applied.length, 0);
    assert.equal(harness.opened.length, 0);
  }
  const back = await openModal();
  await toConfirm(back);
  button(back.content, "Back").click();
  button(back.content, "Back").click();
  button(back.content, "Back").click();
  assert.match(back.content.textContent, /Kept copies/);
  assert.equal(back.applied.length, 0);
});

test("keyboard focus moves to the new step's heading or field", async () => {
  const harness = await openModal();
  const active = () => harness.document.activeElement;
  assert.equal(active()?.textContent, "Kept copies");
  assert.equal(active()?.getAttribute("tabindex"), "-1");
  await toPreview(harness);
  assert.equal(active()?.textContent, "Review this copy");
  button(harness.content, "Restore this base").click();
  assert.equal(active()?.tagName.toLowerCase(), "input");
  button(harness.content, "Continue").click();
  assert.equal(active()?.textContent, "Restore as a new base");
  button(harness.content, "Restore as new base").click();
  await settle();
  assert.equal(active()?.textContent, "Base restored");
});

test("no status or error text contains a private path at any step", async () => {
  const harness = await openModal({ applyResult: { status: "failed", message: "The base could not be saved." } });
  const seen: string[] = [liveText(harness.content)];
  await toPreview(harness);
  seen.push(liveText(harness.content), harness.content.textContent);
  button(harness.content, "Restore this base").click();
  seen.push(liveText(harness.content));
  button(harness.content, "Continue").click();
  button(harness.content, "Restore as new base").click();
  await settle();
  seen.push(liveText(harness.content), harness.content.textContent);
  for (const text of seen) {
    assert.doesNotMatch(text, /\.obsidian|synthetic-plugin|Private Exports|Legacy Exports|\/Users|[A-Za-z]:\\/);
  }
});

test("Close works while a copy is loading: it cancels safely and a late result renders nothing", async () => {
  let release: () => void = () => undefined;
  const loadGate = new Promise<void>((resolve) => { release = resolve; });
  const harness = await openModal({ loadGate });
  button(harness.content, "Review").click();
  await settle();
  assert.equal(harness.loads.length, 1);
  const close = button(harness.content, "Close") as FakeElement & { disabled?: boolean };
  assert.notEqual(close.disabled, true, "Close stays enabled while loading");
  close.click();
  assert.equal(harness.closed(), true);
  release();
  await settle();
  assert.equal(harness.content.textContent, "", "no late render after Close");
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.opened.length, 0);
  // A second Review while one is loading is still ignored.
  const other = await openModal({ loadGate: new Promise<void>(() => undefined) });
  button(other.content, "Review").click();
  button(other.content, "Review").click();
  await settle();
  assert.equal(other.loads.length, 1);
});

test("Close works while discovery is pending and the late result writes nothing", async () => {
  let release: () => void = () => undefined;
  const discoverGate = new Promise<void>((resolve) => { release = resolve; });
  const harness = await openModal({ discoverGate });
  assert.match(harness.content.textContent, /Looking for kept copies/);
  const close = button(harness.content, "Close") as FakeElement & { disabled?: boolean };
  assert.notEqual(close.disabled, true);
  close.click();
  assert.equal(harness.closed(), true);
  release();
  await settle();
  assert.equal(harness.content.textContent, "", "no DOM writes after Close");
  assert.equal(harness.loads.length, 0);
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.opened.length, 0);
});

test("the in-flight restore status never suggests that closing cancels it", async () => {
  let release: () => void = () => undefined;
  const applyGate = new Promise<void>((resolve) => { release = resolve; });
  const harness = await openModal({ applyGate });
  await toConfirm(harness);
  button(harness.content, "Restore as new base").click();
  await settle();
  const status = liveText(harness.content);
  assert.match(status, /does not stop a restore that has started/);
  assert.doesNotMatch(status, /cancel|roll back|undo/i);
  release();
  await settle();
});

test("Close and Cancel are disabled honestly while a restore is in flight, and Apply cannot repeat", async () => {
  let release: () => void = () => undefined;
  const applyGate = new Promise<void>((resolve) => { release = resolve; });
  const harness = await openModal({ applyGate });
  await toConfirm(harness);
  button(harness.content, "Restore as new base").click();
  button(harness.content, "Restore as new base").click();
  await settle();
  assert.equal(harness.applied.length, 1);
  for (const label of ["Cancel", "Back"]) {
    const control = button(harness.content, label) as FakeElement & { disabled?: boolean };
    control.click();
    assert.equal(harness.closed(), false, `${label} does nothing while saving`);
  }
  assert.equal((button(harness.content, "Cancel") as FakeElement & { disabled?: boolean }).disabled, true);
  release();
  await settle();
  assert.equal(hasButton(harness.content, "Open restored base"), true);
});

test("facts use the existing definition-list structure and base rows the title/text wrappers", async () => {
  const longName = "A very long recovered knowledge base name ".repeat(2).trim();
  const store = makeStore(VAULT, longName);
  const harness = await openModal({ files: { [`${PLUGIN_DIR}/data.json.bak-kept-${stamp(1)}`]: { content: JSON.stringify(store), mtime: 1 } }, existingNames: [] });
  // List row.
  const listRow = harness.content.querySelector(".ent-cc-base-manager-row");
  assert.ok(listRow?.querySelector(".ent-cc-base-manager-text .ent-cc-base-manager-title span"));
  assert.ok(listRow?.querySelector(".ent-cc-base-manager-text .ent-cc-picker-meta"));
  assert.ok(listRow?.querySelector(".ent-cc-base-manager-actions button"));
  await toPreview(harness);
  const facts = harness.content.querySelector("dl.ent-cc-sync-recovery-facts");
  assert.ok(facts, "preview facts are a dl");
  const rows = facts.querySelectorAll(".ent-cc-sync-recovery-fact");
  assert.ok(rows.length >= 4);
  for (const row of rows) {
    assert.equal(row.querySelectorAll("dt").length, 1);
    assert.equal(row.querySelectorAll("dd").length, 1);
    assert.equal(row.querySelectorAll("span").length, 0, "no bare spans that run labels into values");
  }
  assert.equal(facts.querySelector("dt")?.textContent, "Source");
  const baseRow = harness.content.querySelector(".ent-cc-base-manager-list .ent-cc-base-manager-row");
  const name = baseRow?.querySelector(".ent-cc-base-manager-text .ent-cc-base-manager-title span");
  assert.equal(name?.textContent, longName);
  assert.ok(baseRow?.querySelector(".ent-cc-base-manager-text .ent-cc-picker-meta"));
  assert.ok(baseRow?.querySelector(".ent-cc-base-manager-actions button"));
  button(harness.content, "Restore this base").click();
  button(harness.content, "Continue").click();
  assert.ok(harness.content.querySelector("dl.ent-cc-sync-recovery-facts dt"), "confirm facts are a dl too");
  assert.equal(harness.content.querySelectorAll(".ent-cc-sync-recovery-fact span").length, 0);
});

test("Apply passes the destination captured at preview time, not the one at Apply", async () => {
  const destinationEpoch = { value: 7 };
  const harness = await openModal({ destinationEpoch });
  await toConfirm(harness);
  destinationEpoch.value = 8; // the data changed after the preview
  button(harness.content, "Restore as new base").click();
  await settle();
  assert.equal(harness.destinations.length, 1);
  assert.equal(harness.destinations[0].epoch, 7);
});

test("opening the list reads nothing: no candidate is loaded until Review", async () => {
  const harness = await openModal();
  assert.equal(harness.loads.length, 0);
});
