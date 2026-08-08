import assert from "node:assert/strict";
import test from "node:test";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { parseQuery, type VaultRecord } from "../src/model.ts";

function record(path: string, title: string): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "supporting",
    curriculumId: "",
    domain: "Research",
    topicKind: "Note",
    priority: "",
    reviewStatus: "unverified",
    synthesisStatus: "",
    autoresearchStatus: "",
    safetyCritical: false,
    sourceCount: 0,
    aliases: [],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "",
    folderOrder: "Research",
    mtime: 0,
    aiLock: false,
  };
}

test("bulk collection actions use current search text during the render debounce", () => {
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    query: string;
    parsedQuery: ReturnType<typeof parseQuery>;
    records: VaultRecord[];
    plugin: { data: { activeTab: string } };
    matchingRecordsForCurrentView(): VaultRecord[];
  };
  view.query = "beta";
  view.parsedQuery = parseQuery("alpha");
  view.records = [record("KB/alpha.md", "Alpha"), record("KB/beta.md", "Beta")];
  view.plugin = { data: { activeTab: "curriculum" } };

  assert.deepEqual(view.matchingRecordsForCurrentView().map((item) => item.title), ["Beta"]);
});

test("closing the view waits for a pending selection save", async () => {
  let finishSave: (() => void) | null = null;
  let saveFinished = false;
  const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
  const cleared: number[] = [];
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: { savePluginData(): Promise<void> };
    onClose(): Promise<void>;
  };
  view.setupTimer = 1;
  view.searchDebounce = 2;
  view.selectionSaveTimer = 3;
  view.timerWindow = { clearTimeout: (timer) => { cleared.push(timer); } };
  view.plugin = {
    savePluginData: async () => {
      await saveGate;
      saveFinished = true;
    },
  };

  const closing = view.onClose();
  await Promise.resolve();
  assert.equal(saveFinished, false);
  finishSave?.();
  await closing;

  assert.equal(saveFinished, true);
  assert.deepEqual(cleared, [1, 2, 3]);
  assert.equal(view.selectionSaveTimer, null);
});

test("closing the view also waits for a selection save already in flight", async () => {
  let finishSave: (() => void) | null = null;
  let closeFinished = false;
  const inFlight = new Promise<void>((resolve) => { finishSave = resolve; });
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    setupTimer: number | null;
    searchDebounce: number | null;
    selectionSaveTimer: number | null;
    selectionSavePromise: Promise<void> | null;
    timerWindow: { clearTimeout(timer: number): void };
    plugin: { savePluginData(): Promise<void> };
    onClose(): Promise<void>;
  };
  view.setupTimer = null;
  view.searchDebounce = null;
  view.selectionSaveTimer = null;
  view.selectionSavePromise = inFlight;
  view.timerWindow = { clearTimeout: () => {} };
  view.plugin = { savePluginData: () => Promise.resolve() };

  const closing = view.onClose().then(() => { closeFinished = true; });
  await Promise.resolve();
  assert.equal(closeFinished, false);
  finishSave?.();
  await closing;
  assert.equal(closeFinished, true);
});
