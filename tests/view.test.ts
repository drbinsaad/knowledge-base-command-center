import assert from "node:assert/strict";
import test from "node:test";
import { calculateModalViewportLayout } from "../src/modals.ts";
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

test("mobile note sheets follow the visual viewport when the keyboard opens", () => {
  assert.deepEqual(calculateModalViewportLayout(844, 844), {
    height: 844,
    keyboardOpen: false,
    shift: 0,
  });
  assert.deepEqual(calculateModalViewportLayout(844, 430, 20), {
    height: 430,
    keyboardOpen: true,
    shift: -187,
  });
});

test("mobile note-sheet viewport values are clamped to the layout viewport", () => {
  assert.deepEqual(calculateModalViewportLayout(600, 900), {
    height: 600,
    keyboardOpen: false,
    shift: 0,
  });
});

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

test("closing the compact record inspector hides it and restores row focus", () => {
  let focusCount = 0;
  let renderCount = 0;
  const selected = { focus: (_options?: FocusOptions) => { focusCount += 1; } };
  const workspace = { scrollTop: 0 };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    mobileInspectorNeedsFocus: boolean;
    mobileTreeScrollTop: number;
    workspaceEl: typeof workspace;
    treeEl: { querySelector(): typeof selected; focus(options?: FocusOptions): void };
    timerWindow: { setTimeout(callback: () => void): number };
    render(): void;
    closeMobileInspector(): void;
  };
  view.mobileInspectorOpen = true;
  view.mobileInspectorNeedsFocus = true;
  view.mobileTreeScrollTop = 73;
  view.workspaceEl = workspace;
  view.treeEl = { querySelector: () => selected, focus: () => { focusCount += 1; } };
  view.render = () => { renderCount += 1; };
  view.timerWindow = { setTimeout: (callback) => { callback(); return 1; } };

  view.closeMobileInspector();

  assert.equal(view.mobileInspectorOpen, false);
  assert.equal(view.mobileInspectorNeedsFocus, false);
  assert.equal(renderCount, 1);
  assert.equal(workspace.scrollTop, 73);
  assert.equal(focusCount, 1);
});

test("compact record inspector traps forward focus at its last control", () => {
  let firstFocusCount = 0;
  let prevented = false;
  const first = { offsetParent: {}, focus: () => { firstFocusCount += 1; } };
  const last = { offsetParent: {}, focus: () => {} };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    inspectorEl: {
      ownerDocument: { activeElement: typeof last };
      querySelectorAll(): Array<typeof first | typeof last>;
      contains(): boolean;
    };
    contentEl: { ownerDocument: { defaultView: { matchMedia(): { matches: boolean } } } };
    handleMobileInspectorKeydown(event: { key: string; shiftKey: boolean; preventDefault(): void }): void;
  };
  view.mobileInspectorOpen = true;
  view.contentEl = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  view.inspectorEl = {
    ownerDocument: { activeElement: last },
    querySelectorAll: () => [first, last],
    contains: () => true,
  };

  view.handleMobileInspectorKeydown({
    key: "Tab",
    shiftKey: false,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(firstFocusCount, 1);
});

test("compact record inspector traps backward focus at its first control", () => {
  let lastFocusCount = 0;
  let prevented = false;
  const first = { offsetParent: {}, focus: () => {} };
  const last = { offsetParent: {}, focus: () => { lastFocusCount += 1; } };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    mobileInspectorOpen: boolean;
    inspectorEl: {
      ownerDocument: { activeElement: typeof first };
      querySelectorAll(): Array<typeof first | typeof last>;
      contains(): boolean;
    };
    contentEl: { ownerDocument: { defaultView: { matchMedia(): { matches: boolean } } } };
    handleMobileInspectorKeydown(event: { key: string; shiftKey: boolean; preventDefault(): void }): void;
  };
  view.mobileInspectorOpen = true;
  view.contentEl = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  view.inspectorEl = {
    ownerDocument: { activeElement: first },
    querySelectorAll: () => [first, last],
    contains: () => true,
  };

  view.handleMobileInspectorKeydown({
    key: "Tab",
    shiftKey: true,
    preventDefault: () => { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(lastFocusCount, 1);
});
