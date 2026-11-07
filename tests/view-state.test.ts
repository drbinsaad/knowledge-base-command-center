import assert from "node:assert/strict";
import test from "node:test";
import { captureViewFocus, restoreViewFocus, readableStatus, relativeUpdatedTime, recordAvailabilitySummary } from "../src/view-state.ts";
import { asHtmlElement, createFakeDom, type FakeElement, type FakeWindow } from "./support/fake-dom.ts";
import { Notice, Platform, TFile } from "obsidian";
import { migrateData, type PluginData, type VaultRecord } from "../src/model.ts";
import { ATTACHMENT_PAGE_SIZE, ATTACHMENT_PATH_ATTRIBUTE, MISSING_REFERENCE_TEXT } from "../src/note-attachments.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";

test("focus follows a stable identity through DOM replacement, including punctuation in vault names", () => {
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const key = 'folder:Research/"Quotes" [中文]';
  const first = root.createEl("button", { attr: { "data-kbcc-focus": key }, text: "Collapse topic" });
  first.focus();
  const captured = captureViewFocus(asHtmlElement(root));
  root.empty();
  const replacement = root.createEl("button", { attr: { "data-kbcc-focus": key }, text: "Expand topic" });
  assert.equal(restoreViewFocus(asHtmlElement(root), captured), true);
  assert.equal(dom.document.activeElement, replacement);
  root.empty();
  assert.equal(restoreViewFocus(asHtmlElement(root), captured), false);
  assert.equal(captureViewFocus(undefined), null);
});

test("focus restoration supports stable input IDs and accessible control names without claiming unfocused controls", () => {
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  for (const attr of [{ id: "search" }, { "aria-label": "Manage workspace" }]) {
    const old = root.createEl("input", { attr });
    old.focus();
    const captured = captureViewFocus(asHtmlElement(root));
    root.empty();
    const replacement = root.createEl("input", { attr });
    assert.equal(restoreViewFocus(asHtmlElement(root), captured), true);
    assert.equal(dom.document.activeElement, replacement);
  }
  dom.document.body.createEl("button").focus();
  assert.equal(captureViewFocus(asHtmlElement(root)), null);
  assert.equal(restoreViewFocus(asHtmlElement(root), null), false);
});

test("status and update labels are readable without inventing missing metadata", () => {
  assert.equal(readableStatus("source_traced"), "Source traced");
  assert.equal(readableStatus("human-reviewed"), "Human reviewed");
  assert.equal(readableStatus(""), "Not recorded");
  const now = Date.UTC(2026, 8, 9);
  assert.equal(relativeUpdatedTime(0, now), "Update time unavailable");
  assert.equal(relativeUpdatedTime(now, now), "Updated just now");
  assert.equal(relativeUpdatedTime(now - 60_000, now), "Updated 1 minute ago");
  assert.equal(relativeUpdatedTime(now - 120_000, now), "Updated 2 minutes ago");
  assert.equal(relativeUpdatedTime(now - 3_600_000, now), "Updated 1 hour ago");
  assert.equal(relativeUpdatedTime(now - 7_200_000, now), "Updated 2 hours ago");
  assert.equal(relativeUpdatedTime(now - 86_400_000, now), "Updated 1 day ago");
  assert.equal(relativeUpdatedTime(now - 172_800_000, now), "Updated 2 days ago");
});

test("availability counts never present unresolved outline entries as Markdown notes", () => {
  assert.equal(recordAvailabilitySummary([{}, { isPlaceholder: true }]), "2 entries · 1 linked note · 1 placeholder");
  assert.equal(recordAvailabilitySummary([{ isPlaceholder: true }]), "1 entry · 0 linked notes · 1 placeholder");
  assert.equal(recordAvailabilitySummary([]), "0 entries · 0 linked notes · 0 placeholders");
});

// ---- WF-07: inspector state, honest modality and durable view feedback (synthetic fixtures) ----

const WF07_ALPHA = "Notes/Alpha.md";
const WF07_BETA = "Notes/Beta.md";
const WF07_PLACEHOLDER = "Placeholders/Gamma.md";
const wf07Path = (index: number): string => `Files/f${String(index).padStart(2, "0")}.pdf`;
const wf07Range = (count: number): string[] => Array.from({ length: count }, (_, index) => wf07Path(index + 1));

function wf07Record(path: string, title: string): VaultRecord {
  return {
    path, title, kind: "topic", role: "supporting", curriculumId: "", domain: "Research", topicKind: "Note", priority: "",
    reviewStatus: "unverified", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false, sourceCount: 0, aliases: [],
    relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "", sourceCoverage: "", folderOrder: "Research", mtime: 0, aiLock: false,
  };
}

function wf07InstallWindow(window: FakeWindow): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: window, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

async function wf07Settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
}

interface Wf07 {
  dom: ReturnType<typeof createFakeDom>;
  content: FakeElement;
  view: EntVaultCommandCenterView;
  harness: { selectRecord(path: string): void; saveWorkspaceLayoutPreference(): void; mobileInspectorOpen: boolean };
  state: { baseId: string; readOnly: boolean; links: Record<string, string[]>; present: Set<string>; opened: string[]; openFailure: Error | null; openGate: Promise<void> | null; storageOk: boolean; organizerOpened: number };
  plugin: { data: PluginData; reconcileRecords: () => Promise<boolean> };
  rows(): FakeElement[];
  rowPaths(): string[];
  inspector(): FakeElement | null;
  feedback(): FakeElement | null;
  more(): FakeElement | null;
  revealAll(): void;
  close(): Promise<void>;
}

async function wf07Open(options: { mobile?: boolean; width?: number; count?: number; readOnly?: boolean; tabletSplit?: boolean } = {}): Promise<Wf07> {
  const platform = Platform as unknown as { isMobile: boolean };
  const previousMobile = platform.isMobile;
  platform.isMobile = options.mobile ?? false;
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.enableHoverPreview = false;
  data.settings.workspaceName = "WF07 base";
  data.settings.setupComplete = true;
  const records = [wf07Record(WF07_ALPHA, "Alpha"), wf07Record(WF07_BETA, "Beta"), { ...wf07Record(WF07_PLACEHOLDER, "Gamma"), isPlaceholder: true }];
  const count = options.count ?? 45;
  const state: Wf07["state"] = {
    baseId: "base-wf07", readOnly: Boolean(options.readOnly), links: { [WF07_ALPHA]: wf07Range(count), [WF07_BETA]: wf07Range(count) },
    present: new Set(wf07Range(count)), opened: [], openFailure: null, openGate: null, storageOk: true, organizerOpened: 0,
  };
  const fileObjects = new Map<string, TFile>();
  const fileFor = (path: string): TFile => {
    let file = fileObjects.get(path);
    if (!file) { file = new TFile(path); fileObjects.set(path, file); }
    return file;
  };
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => state.baseId,
    getDataEpoch: () => 0,
    getSearchGeneration: () => 0,
    getRecords: () => records,
    reconcileRecords: async () => false,
    isDataReadOnly: () => state.readOnly,
    savePluginData: async () => undefined,
    saveViewState: async () => undefined,
    getIndexRecords: () => records,
    getIndexCandidateFiles: () => [],
    searchKnowledgeBases: async () => ({ results: [], total: 0, truncated: false }),
    isClinicalMode: () => false,
    canVisuallyMoveAcrossGroups: () => false,
    countMemberships: () => 0,
    getBacklinkPaths: () => [],
    resolveLink: () => null,
    getLibraries: () => [],
    getLibrary: () => null,
    openFile: async (file: TFile) => { if (state.openGate) await state.openGate; if (state.openFailure) throw state.openFailure; state.opened.push(file.path); },
    openNoteOrganizer: () => { state.organizerOpened += 1; },
    mutate: async (_label: string, change: () => void) => { change(); await view.reload(); },
  };
  const app = {
    saveLocalStorage: () => { if (!state.storageOk) throw new Error("synthetic storage failure"); },
    loadLocalStorage: () => null,
    vault: { getAbstractFileByPath: (path: string) => records.some((item) => item.path === path) || state.present.has(path) ? fileFor(path) : null },
    metadataCache: {
      getFileCache: (file: TFile) => ({ links: (state.links[file.path] ?? []).map((link) => ({ link, original: `[[${link}]]` })) }),
      getFirstLinkpathDest: (link: string) => state.present.has(link) ? fileFor(link) : null,
    },
  };
  const ViewConstructor = EntVaultCommandCenterView as unknown as new (leaf: { app: typeof app }, plugin: unknown) => EntVaultCommandCenterView;
  const restoreWindow = wf07InstallWindow(dom.window);
  let view: EntVaultCommandCenterView;
  try { view = new ViewConstructor({ app }, plugin); } finally { restoreWindow(); }
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.setBoundingClientRect({ width: options.width ?? 1366, height: 900 });
  view.contentEl = asHtmlElement(content);
  if (options.tabletSplit) (view as unknown as { workspaceLayoutPreference: unknown }).workspaceLayoutPreference = { inspectorWidth: 360, tabletSplit: true };
  await view.reload();
  const harness = view as unknown as Wf07["harness"];
  const rows = (): FakeElement[] => content.querySelectorAll(".ent-cc-attachment-row");
  const more = (): FakeElement | null => content.querySelector(".ent-cc-attachments-more");
  return {
    dom, content, view, harness, state, plugin, rows,
    rowPaths: () => rows().map((row) => row.getAttribute(ATTACHMENT_PATH_ATTRIBUTE) ?? ""),
    inspector: () => content.querySelector(".ent-cc-inspector"),
    feedback: () => content.querySelector(".ent-cc-view-feedback"),
    more,
    revealAll: () => { while (more() && !more()?.hidden) more()?.dispatch("click"); },
    close: async () => { await view.onClose(); platform.isMobile = previousMobile; },
  };
}

function wf07ActivePath(dom: Wf07["dom"]): string | null {
  return dom.document.activeElement?.getAttribute(ATTACHMENT_PATH_ATTRIBUTE) ?? null;
}

test("WF07 I1 a harmless refresh keeps 40 of 45 attachments revealed and the same item 35 focused", async () => {
  const s = await wf07Open();
  try {
    s.harness.selectRecord(WF07_ALPHA);
    assert.equal(s.rows().length, ATTACHMENT_PAGE_SIZE);
    s.more()?.dispatch("click");
    assert.equal(s.rows().length, 40);
    const target = s.rows()[34];
    target.focus();
    assert.equal(wf07ActivePath(s.dom), wf07Path(35));
    await s.view.reload();
    assert.equal(s.rows().length, 40, "the revealed count survives the refresh");
    assert.equal(wf07ActivePath(s.dom), wf07Path(35), "the same path is focused again");
    assert.equal(s.more()?.hidden, false);
    s.revealAll();
    assert.equal(s.rows().length, 45, "20-item increments continue to the end");
  } finally { await s.close(); }
});

test("WF07 I2 focus that moved outside before the refresh finished is not stolen back", async () => {
  const s = await wf07Open();
  try {
    s.harness.selectRecord(WF07_ALPHA);
    s.rows()[5].focus();
    const outside = s.dom.document.body.createEl("input", { attr: { id: "wf07-outside" } });
    s.plugin.reconcileRecords = async () => { outside.focus(); return false; };
    await s.view.reload();
    assert.ok(s.dom.document.activeElement === outside, "focus stays on the outside element");
    assert.equal(s.rows().length, ATTACHMENT_PAGE_SIZE);
  } finally { await s.close(); }
});

test("WF07 I3 a different note or base resets to 20; shrinking or removing the focused item never leaves a stale target", async () => {
  const s = await wf07Open();
  try {
    s.harness.selectRecord(WF07_ALPHA);
    s.more()?.dispatch("click");
    assert.equal(s.rows().length, 40);
    s.harness.selectRecord(WF07_BETA);
    assert.equal(s.rows().length, ATTACHMENT_PAGE_SIZE, "another selected note starts at 20");
    s.harness.selectRecord(WF07_ALPHA);
    assert.equal(s.rows().length, ATTACHMENT_PAGE_SIZE, "returning does not resurrect the old count");
    s.more()?.dispatch("click");
    s.state.baseId = "base-other";
    await s.view.reload();
    assert.equal(s.rows().length, ATTACHMENT_PAGE_SIZE, "another base starts at 20");
    s.state.baseId = "base-wf07";
    await s.view.reload();

    s.harness.selectRecord(WF07_ALPHA);
    s.revealAll();
    s.rows()[34].focus();
    s.state.links[WF07_ALPHA] = wf07Range(30);
    await s.view.reload();
    assert.equal(s.rows().length, 30, "the clamped list never renders more than exists");
    const active = s.dom.document.activeElement;
    assert.ok(active && s.inspector()?.contains(active), "focus stays in the inspector on a live nearby item");
    assert.equal(active.getAttribute(ATTACHMENT_PATH_ATTRIBUTE), wf07Path(30));

    s.state.links[WF07_ALPHA] = [];
    await s.view.reload();
    const container = s.dom.document.activeElement;
    assert.ok(container && s.inspector()?.contains(container), "an empty list falls back to a live container");
    assert.equal(container.getAttribute(ATTACHMENT_PATH_ATTRIBUTE), null);
  } finally { await s.close(); }
});

function wf07Focusables(inspector: FakeElement): FakeElement[] {
  return inspector.querySelectorAll("button").filter((element) => !element.disabled);
}

test("WF07 I4 narrow desktop is a non-modal region with ordinary Tab; mobile compact keeps its dialog trap; wide mobile is unchanged", async () => {
  const desktop = await wf07Open({ mobile: false, width: 600 });
  try {
    desktop.harness.selectRecord(WF07_ALPHA);
    const inspector = desktop.inspector();
    assert.ok(inspector);
    assert.equal(inspector.getAttribute("role"), "complementary");
    assert.equal(inspector.getAttribute("aria-modal"), null);
    const last = wf07Focusables(inspector).at(-1);
    assert.ok(last);
    last.focus();
    const tab = inspector.dispatch("keydown", { key: "Tab" });
    assert.equal(tab.defaultPrevented, false, "Tab leaves the inspector");
    assert.ok(desktop.dom.document.activeElement === last, "focus is not wrapped");
  } finally { await desktop.close(); }

  const phone = await wf07Open({ mobile: true, width: 600 });
  try {
    phone.harness.selectRecord(WF07_ALPHA);
    const inspector = phone.inspector();
    assert.ok(inspector);
    assert.equal(inspector.getAttribute("role"), "dialog");
    assert.equal(inspector.getAttribute("aria-modal"), "true");
    const focusables = wf07Focusables(inspector);
    // The shared fake DOM handles simple selectors only; supply the real document-order focus candidates.
    const query = inspector.querySelectorAll.bind(inspector);
    inspector.querySelectorAll = (selector: string) => selector.includes(",") ? wf07Focusables(inspector) : query(selector);
    focusables.at(-1)?.focus();
    const tab = inspector.dispatch("keydown", { key: "Tab" });
    assert.equal(tab.defaultPrevented, true);
    assert.ok(phone.dom.document.activeElement === focusables[0], "the dialog trap wraps to the first control");
    const escape = inspector.dispatch("keydown", { key: "Escape" });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(phone.harness.mobileInspectorOpen, false, "Escape/Back still leaves the compact dialog");
  } finally { await phone.close(); }

  const tablet = await wf07Open({ mobile: true, width: 1366 });
  try {
    tablet.harness.selectRecord(WF07_ALPHA);
    assert.equal(tablet.inspector()?.getAttribute("role"), "dialog", "a tablet without the split preference keeps the compact dialog route");
    assert.equal(tablet.inspector()?.getAttribute("aria-modal"), "true");
  } finally { await tablet.close(); }

  const split = await wf07Open({ mobile: true, width: 1366, tabletSplit: true });
  try {
    split.harness.selectRecord(WF07_ALPHA);
    assert.equal(split.inspector()?.getAttribute("role"), "complementary", "the wide mobile split is the unchanged in-pane region");
    assert.equal(split.inspector()?.getAttribute("aria-modal"), null);
  } finally { await split.close(); }
});

test("WF07 I5 Expand, density and Next-list controls use one coherent label-changing contract with no aria-pressed", async () => {
  const s = await wf07Open();
  try {
    s.harness.selectRecord(WF07_ALPHA);
    const expand = (): FakeElement | null => s.content.querySelector(".ent-cc-inspector-expand");
    assert.equal(expand()?.getAttribute("aria-label"), "Expand note details");
    assert.equal(expand()?.getAttribute("aria-pressed"), null);
    expand()?.dispatch("click");
    assert.equal(expand()?.getAttribute("aria-label"), "Back to split view");
    assert.equal(expand()?.getAttribute("aria-pressed"), null);
    expand()?.dispatch("click");
    assert.equal(expand()?.getAttribute("aria-label"), "Expand note details");

    const density = (): FakeElement | null => s.content.querySelector(".ent-cc-density-toggle");
    assert.equal(density()?.getAttribute("aria-label"), "Use compact view density");
    assert.equal(density()?.getAttribute("aria-pressed"), null);
    density()?.focus();
    density()?.dispatch("click");
    assert.equal(density()?.getAttribute("aria-label"), "Use comfortable view density");
    assert.equal(density()?.getAttribute("aria-pressed"), null);
    assert.ok(s.dom.document.activeElement === density(), "the stable focus key survives the label change");

    const next = (): FakeElement | null => s.content.querySelector(".ent-cc-study-action");
    assert.equal(next()?.textContent, "Add to Next list");
    assert.equal(next()?.getAttribute("aria-pressed"), null);
    next()?.focus();
    next()?.dispatch("click");
    await wf07Settle();
    assert.equal(next()?.textContent, "Remove from Next list");
    assert.equal(next()?.getAttribute("aria-pressed"), null);
    assert.ok(s.dom.document.activeElement === next(), "the Next control keeps focus after its name changes");
  } finally { await s.close(); }
});

test("WF07 I6 a missing attachment gives persistent live feedback that survives refresh, is replaced by the corrected action and can be dismissed", async () => {
  const s = await wf07Open({ count: 3 });
  try {
    Notice.messages.length = 0;
    s.harness.selectRecord(WF07_ALPHA);
    const first = s.rows()[0];
    s.state.present.delete(wf07Path(1));
    first.dispatch("click");
    await wf07Settle();
    let region = s.feedback();
    assert.ok(region && region.textContent.includes(MISSING_REFERENCE_TEXT), region?.textContent);
    assert.ok(region.querySelector('[role="alert"]') && region.querySelector('[role="status"]'), "both live regions exist before any message");
    assert.doesNotMatch(region.textContent, /syncing|this device/u);
    assert.deepEqual(Notice.messages, [], "the view-owned surface replaces the transient Notice");
    await s.view.reload();
    region = s.feedback();
    assert.ok(region && region.textContent.includes(MISSING_REFERENCE_TEXT), "survives a normal rerender");
    s.rows()[1].dispatch("click");
    await wf07Settle();
    assert.deepEqual(s.state.opened, [wf07Path(2)]);
    assert.ok(s.feedback()?.textContent.includes("f02.pdf"), "the corrected action replaces the message");
    assert.ok(!s.feedback()?.textContent.includes(MISSING_REFERENCE_TEXT));
    s.rows()[1].focus();
    const dismiss = s.feedback()?.querySelector("button");
    assert.ok(dismiss);
    dismiss.focus();
    dismiss.dispatch("click");
    assert.equal(s.feedback()?.hidden, true);
    assert.equal(s.feedback()?.textContent.replace(/Dismiss/u, "").trim(), "");
    const active = s.dom.document.activeElement;
    assert.ok(active && s.content.contains(active) && active !== dismiss, "dismissal never strands focus");
    s.state.openFailure = new Error("Synthetic open failure");
    s.rows()[1].dispatch("click");
    await wf07Settle();
    assert.match(s.feedback()?.textContent ?? "", /Synthetic open failure/u);
  } finally { await s.close(); }
});

test("WF07 I6 copy failure, layout-preference save failure and read-only organizer rejection use the same persistent surface", async () => {
  const s = await wf07Open({ readOnly: true, count: 3 });
  try {
    Notice.messages.length = 0;
    s.harness.selectRecord(WF07_ALPHA);
    const copy = s.content.querySelectorAll(".ent-cc-study-action").find((button) => button.textContent === "Copy path");
    assert.ok(copy);
    copy.dispatch("click");
    await wf07Settle();
    assert.match(s.feedback()?.textContent ?? "", /Clipboard access was unavailable/u);

    s.state.storageOk = false;
    s.harness.saveWorkspaceLayoutPreference();
    assert.match(s.feedback()?.textContent ?? "", /could not remember it/u);
    await s.view.reload();
    assert.match(s.feedback()?.textContent ?? "", /could not remember it/u, "survives a rerender");

    s.content.querySelector(".ent-cc-note-organizer-launch")?.dispatch("click");
    assert.match(s.feedback()?.textContent ?? "", /Organizing notes is unavailable while organization data is read-only/u);
    assert.equal(s.state.organizerOpened, 0);
    assert.deepEqual(Notice.messages, []);
    assert.equal(s.content.querySelector(".ent-cc-search-status")?.textContent ?? "", "", "search announcements are not overwritten");
  } finally { await s.close(); }
});

test("WF07 R3 selecting a placeholder resets the previous note's expansion, while an unchanged-note refresh keeps it", async () => {
  const s = await wf07Open();
  try {
    s.harness.selectRecord(WF07_ALPHA);
    s.more()?.dispatch("click");
    assert.equal(s.rows().length, 40);
    await s.view.reload();
    assert.equal(s.rows().length, 40, "control: the same note keeps its count");
    s.harness.selectRecord(WF07_PLACEHOLDER);
    assert.equal(s.rows().length, 0);
    s.harness.selectRecord(WF07_ALPHA);
    assert.equal(s.rows().length, ATTACHMENT_PAGE_SIZE, "returning from a placeholder starts at 20");
  } finally { await s.close(); }
});

test("WF07 R2 a delayed attachment open never writes feedback into a different base or a closed view; same-context completion still does", async () => {
  for (const outcome of ["success", "failure"] as const) {
    const s = await wf07Open({ count: 3 });
    try {
      s.harness.selectRecord(WF07_ALPHA);
      let release = (): void => undefined;
      s.state.openGate = new Promise<void>((resolve) => { release = resolve; });
      if (outcome === "failure") s.state.openFailure = new Error("Synthetic late failure");
      s.rows()[0].dispatch("click");
      s.state.baseId = "base-other";
      await s.view.reload();
      release();
      await wf07Settle();
      assert.equal(s.feedback()?.hidden, true, `${outcome}: the old base's completion is dropped`);
      assert.equal(s.feedback()?.textContent.replace(/Dismiss/u, "").trim(), "");
    } finally { await s.close(); }
  }
  const same = await wf07Open({ count: 3 });
  try {
    same.harness.selectRecord(WF07_ALPHA);
    let release = (): void => undefined;
    same.state.openGate = new Promise<void>((resolve) => { release = resolve; });
    same.rows()[0].dispatch("click");
    release();
    await wf07Settle();
    assert.match(same.feedback()?.textContent ?? "", /Opened f01\.pdf/u, "control: same-context completion updates the live region");
  } finally { await same.close(); }
  const closing = await wf07Open({ count: 3 });
  closing.harness.selectRecord(WF07_ALPHA);
  let releaseClosing = (): void => undefined;
  closing.state.openGate = new Promise<void>((resolve) => { releaseClosing = resolve; });
  closing.rows()[0].dispatch("click");
  await closing.close();
  releaseClosing();
  await wf07Settle();
  assert.equal((closing.view as unknown as { viewFeedback: unknown }).viewFeedback, null, "a closed view stays empty");
});

test("WF07 R1 focus moved to another inspector control during the awaited reload is kept; unchanged focus is still restored", async () => {
  const s = await wf07Open();
  try {
    s.harness.selectRecord(WF07_ALPHA);
    s.rows()[5].focus();
    const expand = s.content.querySelector(".ent-cc-inspector-expand");
    assert.ok(expand);
    s.plugin.reconcileRecords = async () => { expand.focus(); return false; };
    await s.view.reload();
    const active = s.dom.document.activeElement;
    assert.equal(active?.getAttribute("data-kbcc-focus"), "inspector-expand", "the latest in-view choice wins");
    s.plugin.reconcileRecords = async () => false;
    s.rows()[5].focus();
    await s.view.reload();
    assert.equal(wf07ActivePath(s.dom), wf07Path(6), "control: focus left on the attachment returns to it");
  } finally { await s.close(); }
});
