import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { NullValue, TFile } from "obsidian";
import type {
  BasesEntry,
  BasesEntryGroup,
  BasesPropertyId,
  BasesQueryResult,
  BasesViewConfig,
  QueryController,
  Value,
} from "obsidian";
import {
  DEFAULT_HIERARCHY_BASES_PAGE_SIZE,
  ENT_HIERARCHY_BASES_VIEW_TYPE,
  EntHierarchyBasesView,
  HIERARCHY_BASES_BUILD_SLICE,
  MAX_HIERARCHY_BASES_PAGE_SIZE,
  hierarchyBasesViewOptions,
  resolveHierarchyBasesViewOptions,
} from "../src/bases-view.ts";
import {
  FakeDocument,
  FakeElement,
  FakeWindow,
  asHtmlElement,
} from "./support/fake-dom.ts";

class QueuedFakeWindow extends FakeWindow {
  private readonly callbacks = new Map<number, TimerHandler>();
  private nextQueuedTimerId = 1;
  clearTimeoutCalls: number[] = [];
  maxPending = 0;
  scheduledCount = 0;

  override clearTimeout(id: number): void {
    this.clearTimeoutCalls.push(id);
    this.callbacks.delete(id);
  }

  override setTimeout(callback: TimerHandler, _delay?: number): number {
    const id = this.nextQueuedTimerId;
    this.nextQueuedTimerId += 1;
    this.scheduledCount += 1;
    this.callbacks.set(id, callback);
    this.maxPending = Math.max(this.maxPending, this.callbacks.size);
    return id;
  }

  pendingTimeouts(): number {
    return this.callbacks.size;
  }

  firstPendingCallback(): TimerHandler | undefined {
    return this.callbacks.values().next().value;
  }

  flushOneTimeout(): boolean {
    const next = this.callbacks.entries().next().value;
    if (!next) return false;
    const [id, callback] = next;
    this.callbacks.delete(id);
    if (typeof callback === "function") callback();
    return true;
  }

  flushTimeouts(limit = 10_000): number {
    let flushed = 0;
    while (this.flushOneTimeout()) {
      flushed += 1;
      if (flushed > limit) throw new Error("Fake timeout queue did not settle.");
    }
    return flushed;
  }
}

interface EntryFixture {
  entry: BasesEntry;
  getValueCalls: BasesPropertyId[];
}

interface ViewHarness {
  container: FakeElement;
  document: FakeDocument;
  opened: TFile[];
  view: EntHierarchyBasesView;
  window: QueuedFakeWindow;
}

function wrappedValue(text: string): Value {
  return { toString: () => text } as Value;
}

function entryFixture(
  path: string,
  values: Partial<Record<BasesPropertyId, string | Value>> = {},
  folderName?: string,
): EntryFixture {
  const file = new TFile(path) as TFile & { parent?: { name: string } };
  const inferredFolder = path.includes("/") ? path.split("/").at(-2) ?? "" : "";
  file.parent = { name: folderName ?? inferredFolder };
  const getValueCalls: BasesPropertyId[] = [];
  return {
    entry: {
      file,
      getValue(property: BasesPropertyId): Value | null {
        getValueCalls.push(property);
        const value = values[property];
        return value === undefined ? null : typeof value === "string" ? wrappedValue(value) : value;
      },
    },
    getValueCalls,
  };
}

function group(entries: BasesEntry[], key?: string): BasesEntryGroup {
  return {
    entries,
    hasKey: () => key !== undefined,
    key: key === undefined ? undefined : wrappedValue(key),
  };
}

function config(values: Record<string, unknown> = {}): BasesViewConfig {
  return {
    get: (key: string) => values[key],
    getAsPropertyId: (key: string) => {
      const value = values[key];
      return typeof value === "string" && /^(?:note|file|formula)\..+/.test(value)
        ? value as BasesPropertyId
        : null;
    },
  } as BasesViewConfig;
}

function result(
  entries: BasesEntry[],
  groups: BasesEntryGroup[],
  onGroupedDataRead?: () => void,
): BasesQueryResult {
  return {
    data: entries,
    get groupedData() {
      onGroupedDataRead?.();
      return groups;
    },
  } as BasesQueryResult;
}

function createViewHarness(
  entries: BasesEntry[],
  groups: BasesEntryGroup[],
  configValues: Record<string, unknown> = {},
): ViewHarness {
  const window = new QueuedFakeWindow();
  const document = new FakeDocument(window);
  const container = document.body.createDiv();
  const opened: TFile[] = [];
  const view = new EntHierarchyBasesView({} as QueryController, asHtmlElement(container));
  Object.assign(view, {
    app: {
      metadataCache: new Proxy({}, { get: () => { throw new Error("metadataCache must not be read"); } }),
      workspace: {
        getLeaf: () => ({
          openFile: async (file: TFile) => { opened.push(file); },
        }),
      },
    },
    config: config(configValues),
    data: result(entries, groups),
  });
  return { container, document, opened, view, window };
}

function setViewData(view: EntHierarchyBasesView, entries: BasesEntry[], groups: BasesEntryGroup[]): void {
  (view as unknown as { data: BasesQueryResult }).data = result(entries, groups);
}

function adoptIntoDocument(element: FakeElement, document: FakeDocument): void {
  (element as unknown as { ownerDocument: FakeDocument }).ownerDocument = document;
  for (const child of element.children) adoptIntoDocument(child, document);
}

test("Bases view registration keeps its stable type and safe configurable defaults", () => {
  assert.equal(ENT_HIERARCHY_BASES_VIEW_TYPE, "ent-hierarchy");
  const optionGroups = hierarchyBasesViewOptions();
  const options = optionGroups.flatMap((option) => "items" in option ? option.items : [option]);
  assert.deepEqual(options.map((option) => option.key), [
    "titleProperty",
    "idProperty",
    "groupProperty",
    "statusProperty",
    "priorityProperty",
    "pageSize",
    "showCounts",
  ]);
  assert.deepEqual(resolveHierarchyBasesViewOptions(config()), {
    groupProperty: "note.domain",
    idProperty: "note.curriculum_id",
    pageSize: DEFAULT_HIERARCHY_BASES_PAGE_SIZE,
    priorityProperty: "note.priority",
    showCounts: true,
    statusProperty: "note.review_status",
    titleProperty: "note.title",
  });
  assert.equal(resolveHierarchyBasesViewOptions(config({ pageSize: "200junk" })).pageSize, DEFAULT_HIERARCHY_BASES_PAGE_SIZE);
  assert.equal(resolveHierarchyBasesViewOptions(config({ pageSize: 1 })).pageSize, 25);
  assert.equal(resolveHierarchyBasesViewOptions(config({ pageSize: 10_000 })).pageSize, MAX_HIERARCHY_BASES_PAGE_SIZE);
});

test("Bases styles stay scoped, overflow-safe, and touch-sized in portrait and landscape", () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const basesStylesStart = styles.indexOf(".ent-cc-bases-view {");
  const basesStylesEnd = styles.indexOf("@media (max-width: 900px)", basesStylesStart);
  assert.ok(basesStylesStart >= 0 && basesStylesEnd > basesStylesStart);
  const basesStyles = styles.slice(basesStylesStart, basesStylesEnd);
  assert.match(
    basesStyles,
    /\.ent-cc-bases-view\s*\{[^}]*container-name:\s*ent-cc-bases;[^}]*container-type:\s*inline-size;[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-x:\s*hidden;/s,
  );
  for (const selectorLine of basesStyles.split("\n").filter((line) => /\.ent-cc-base-(?!s-view)/.test(line))) {
    assert.match(selectorLine.trim(), /^\.ent-cc-bases-view \.ent-cc-base-/, `unscoped Bases selector: ${selectorLine.trim()}`);
  }
  assert.match(basesStyles, /\.ent-cc-bases-view \.ent-cc-base-heading\s*\{[^}]*grid-template-columns:\s*14px minmax\(0, 1fr\) max-content;[^}]*margin:\s*0;/s);
  assert.match(basesStyles, /\.ent-cc-bases-view \.ent-cc-base-heading-label\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(basesStyles, /\.ent-cc-bases-view \.ent-cc-base-record:focus-visible,\s*\.ent-cc-bases-view \.ent-cc-base-pagination \.ent-cc-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--interactive-accent\);/s);
  assert.match(
    basesStyles,
    /\.ent-cc-bases-view \.ent-cc-base-record-title,\s*\.ent-cc-bases-view \.ent-cc-base-record-id,\s*\.ent-cc-bases-view \.ent-cc-base-record-meta\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
  );
  assert.match(basesStyles, /\.ent-cc-bases-view \.ent-cc-base-status,\s*\.ent-cc-bases-view \.ent-cc-base-groups,[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/s);

  const compactStart = styles.indexOf("@container ent-cc-bases (max-width: 520px)");
  const compactEnd = basesStylesEnd;
  assert.ok(compactStart >= 0 && compactEnd > compactStart);
  const compactStyles = styles.slice(compactStart, compactEnd);
  assert.match(compactStyles, /\.ent-cc-bases-view \.ent-cc-base-record\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 96px\);[^}]*min-height:\s*44px;[^}]*padding-inline:\s*12px;/s);
  assert.match(compactStyles, /\.ent-cc-bases-view \.ent-cc-base-record-meta\s*\{[^}]*grid-area:\s*meta;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*start;[^}]*white-space:\s*normal;/s);
  assert.match(compactStyles, /\.ent-cc-bases-view \.ent-cc-base-pagination\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*width:\s*100%;/s);
  assert.match(compactStyles, /\.ent-cc-bases-view \.ent-cc-base-pagination \.ent-cc-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*44px;/s);

  const coarsePointerStart = styles.indexOf("@media (pointer: coarse)", compactStart);
  assert.ok(coarsePointerStart >= 0 && coarsePointerStart < compactEnd);
  const coarsePointerStyles = styles.slice(coarsePointerStart, compactEnd);
  assert.match(
    coarsePointerStyles,
    /\.ent-cc-bases-view \.ent-cc-base-record,\s*\.ent-cc-bases-view \.ent-cc-base-pagination \.ent-cc-button\s*\{[^}]*min-height:\s*44px;/s,
    "an approximately 844px iPhone landscape leaf must not fall back to 34px/32px touch targets",
  );

  for (const containerWidth of [320, 390]) {
    const rowContentWidth = containerWidth - 12 - 12;
    const minimumTitleWidth = rowContentWidth - 10 - 96;
    assert.ok(minimumTitleWidth >= 44, `${String(containerWidth)}px must retain a usable title track`);
    const pagerContentWidth = containerWidth - 12 - 12;
    const pagerButtonWidth = (pagerContentWidth - 8) / 2;
    assert.ok(pagerButtonWidth >= 44, `${String(containerWidth)}px must retain two 44px pager targets`);
  }
});

test("default Bases rendering uses entry values, fallback groups, and user result order", async () => {
  const second = entryFixture("01 Airway/Second.md", {
    "note.curriculum_id": "1.2",
    "note.domain": "Airway",
    "note.priority": "P2",
    "note.title": "Second in user sort",
  });
  const first = entryFixture("01 Airway/First.md", {
    "note.curriculum_id": "1.1",
    "note.domain": "Airway",
    "note.priority": "P1",
    "note.title": "First by identifier",
  });
  const folderFallback = entryFixture("02 Otology/Folder fallback.md", {
    "note.curriculum_id": NullValue.value,
    "note.domain": NullValue.value,
    "note.priority": NullValue.value,
    "note.review_status": NullValue.value,
    "note.title": NullValue.value,
  }, "02 Otology");
  const entries = [second.entry, first.entry, folderFallback.entry];
  const harness = createViewHarness(entries, [group(entries)]);

  harness.view.onDataUpdated();
  assert.equal(second.getValueCalls.length, 0, "onDataUpdated must not synchronously scan entries");
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, 0);
  assert.equal(harness.container.querySelector(".ent-cc-bases-view")?.getAttribute("aria-busy"), "true");
  harness.window.flushTimeouts();

  const headings = harness.container.querySelectorAll("h2.ent-cc-base-heading");
  assert.deepEqual(headings.map((heading) => heading.textContent), ["Airway2", "Otology1"]);
  const rows = harness.container.querySelectorAll("button.ent-cc-base-record");
  assert.deepEqual(rows.map((row) => row.querySelector(".ent-cc-base-record-title")?.textContent), [
    "Second in user sort",
    "First by identifier",
    "Folder fallback",
  ]);
  assert.equal(rows[0]?.getAttribute("aria-label"), "Open Second in user sort, ID 1.2, Priority P2");
  assert.ok(second.getValueCalls.includes("note.title"));
  assert.ok(second.getValueCalls.includes("note.domain"));

  rows[0]?.click();
  await Promise.resolve();
  assert.equal(harness.opened[0]?.path, "01 Airway/Second.md");
});

test("a single native NullValue group stays authoritative and receives an Unassigned heading", () => {
  const fixture = entryFixture("Notes/Null group.md", {
    "note.custom_group": "Must not replace native group",
    "note.title": "Null group",
  });
  const nullGroup = {
    entries: [fixture.entry],
    hasKey: () => false,
    key: NullValue.value,
  };
  const harness = createViewHarness([fixture.entry], [nullGroup], { groupProperty: "note.custom_group" });
  harness.view.onDataUpdated();
  harness.window.flushTimeouts();

  assert.equal(harness.container.querySelector("h2.ent-cc-base-heading")?.textContent, "Unassigned1");
  assert.equal(fixture.getValueCalls.includes("note.custom_group"), false);
});

test("native groupedData is authoritative and configurable row properties remain accessible", () => {
  const entries = Array.from({ length: 30 }, (_, index) => entryFixture(`Research/Item ${String(index)}.md`, {
    "formula.heading": `Formula title ${String(index)}`,
    "note.custom_id": `ID-${String(index)}`,
    "note.custom_group": "Ignored fallback group",
    "note.custom_priority": index % 2 === 0 ? "High" : "Low",
    "note.custom_status": index % 2 === 0 ? "Draft" : "Ready",
  }));
  const firstNative = entries.slice(0, 18).map((fixture) => fixture.entry);
  const secondNative = entries.slice(18).map((fixture) => fixture.entry);
  const harness = createViewHarness(
    entries.map((fixture) => fixture.entry),
    [group(firstNative, "Native B"), group(secondNative, "Native A")],
    {
      groupProperty: "note.custom_group",
      idProperty: "note.custom_id",
      pageSize: "25",
      priorityProperty: "note.custom_priority",
      showCounts: false,
      statusProperty: "note.custom_status",
      titleProperty: "formula.heading",
    },
  );

  harness.view.onDataUpdated();
  harness.window.flushTimeouts();
  assert.deepEqual(
    harness.container.querySelectorAll("h2.ent-cc-base-heading").map((heading) => heading.textContent),
    ["Native B", "Native A"],
  );
  assert.equal(harness.container.querySelectorAll(".ent-cc-base-count").length, 0);
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, 25);
  assert.equal(entries.flatMap((fixture) => fixture.getValueCalls).includes("note.custom_group"), false);
  const firstRow = harness.container.querySelector("button.ent-cc-base-record");
  assert.equal(firstRow?.getAttribute("aria-label"), "Open Formula title 0, ID ID-0, Status Draft, Priority High");
  assert.match(firstRow?.textContent ?? "", /Draft · High/);
});

test("Bases groups, rows, status, and bounded paging expose semantic accessible controls", () => {
  const fixtures = Array.from({ length: 30 }, (_, index) => entryFixture(`Notes/Item ${String(index)}.md`, {
    "note.domain": "Notes",
    "note.title": `Item ${String(index)}`,
  }));
  const entries = fixtures.map((fixture) => fixture.entry);
  const harness = createViewHarness(entries, [group(entries)], { pageSize: 25 });
  harness.view.onDataUpdated();
  harness.window.flushTimeouts();

  const section = harness.container.querySelector("section.ent-cc-base-group");
  const heading = harness.container.querySelector("h2.ent-cc-base-heading");
  assert.ok(section && heading);
  assert.equal(section.getAttribute("aria-labelledby"), heading.getAttribute("id"));
  assert.equal(heading.tagName, "h2");
  assert.equal(heading.querySelector(".ent-cc-base-heading-label")?.getAttribute("dir"), "auto");
  assert.equal(harness.container.querySelector(".ent-cc-base-records")?.getAttribute("role"), "list");
  assert.equal(harness.container.querySelectorAll('[role="listitem"]').length, 25);
  const firstRow = harness.container.querySelector("button.ent-cc-base-record");
  assert.equal(firstRow?.getAttribute("type"), "button");
  assert.equal(firstRow?.querySelector(".ent-cc-base-record-title")?.getAttribute("dir"), "auto");
  const status = harness.container.querySelector('[role="status"]');
  assert.equal(status?.getAttribute("aria-live"), "polite");
  assert.equal(status?.textContent, "Showing 1–25 of 30 entries.");

  const navigation = harness.container.querySelector("nav.ent-cc-base-pagination");
  assert.equal(navigation?.getAttribute("aria-label"), "Knowledge hierarchy pages");
  const pageButtons = harness.container.querySelectorAll("button.ent-cc-button");
  const previous = pageButtons.find((button) => button.textContent === "Previous");
  const next = pageButtons.find((button) => button.textContent === "Next");
  assert.equal(previous?.disabled, true);
  assert.equal(next?.disabled, false);
  assert.equal(next?.getAttribute("aria-controls"), harness.container.querySelector(".ent-cc-base-groups")?.getAttribute("id"));
  next?.click();
  assert.equal(harness.document.activeElement, null);
  harness.window.flushTimeouts();
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, 5);
  assert.equal(harness.document.activeElement, harness.container.querySelectorAll("button.ent-cc-base-record")[0]);
  assert.equal(status?.textContent, "Showing 26–30 of 30 entries.");

  const previousOnSecondPage = harness.container.querySelectorAll("button.ent-cc-button")
    .find((button) => button.textContent === "Previous");
  previousOnSecondPage?.click();
  harness.window.flushTimeouts();
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, 25);
  assert.equal(status?.textContent, "Showing 1–25 of 30 entries.");
});

test("queued fallback builds are generation-safe and cancel through the owner window", () => {
  const staleFixtures = Array.from({ length: 1_000 }, (_, index) => entryFixture(`Stale/Item ${String(index)}.md`, {
    "note.domain": "Stale",
    "note.title": `Stale ${String(index)}`,
  }));
  const fresh = entryFixture("Fresh/Only.md", { "note.domain": "Fresh", "note.title": "Fresh only" });
  const staleEntries = staleFixtures.map((fixture) => fixture.entry);
  const harness = createViewHarness(staleEntries, [group(staleEntries)]);

  harness.view.onDataUpdated();
  assert.equal(harness.window.pendingTimeouts(), 1);
  assert.equal(staleFixtures.flatMap((fixture) => fixture.getValueCalls).length, 0);
  setViewData(harness.view, [fresh.entry], [group([fresh.entry])]);
  harness.view.onDataUpdated();
  assert.ok(harness.window.clearTimeoutCalls.length >= 1);
  harness.window.flushTimeouts();
  assert.deepEqual(
    harness.container.querySelectorAll(".ent-cc-base-record-title").map((element) => element.textContent),
    ["Fresh only"],
  );
  assert.equal(staleFixtures.flatMap((fixture) => fixture.getValueCalls).length, 0);

  setViewData(harness.view, staleEntries, [group(staleEntries)]);
  harness.view.onDataUpdated();
  const pendingBeforeUnload = harness.window.pendingTimeouts();
  harness.view.onunload();
  assert.equal(pendingBeforeUnload, 1);
  assert.equal(harness.window.pendingTimeouts(), 0);
  assert.equal(harness.container.children.length, 0, "unload removes the child owned by this Bases view instance");
});

test("an in-flight build follows its Bases container into the destination window", () => {
  const firstWindow = new QueuedFakeWindow();
  const firstDocument = new FakeDocument(firstWindow);
  const secondWindow = new QueuedFakeWindow();
  const secondDocument = new FakeDocument(secondWindow);
  const parent = firstDocument.body.createDiv();
  let migrationListener: ((viewWindow: Window) => void) | null = null;
  let migrationCleanupCalled = false;
  (parent as unknown as {
    onWindowMigrated(listener: (viewWindow: Window) => void): () => void;
  }).onWindowMigrated = (listener) => {
    migrationListener = listener;
    return () => { migrationCleanupCalled = true; };
  };
  const fixtures = Array.from({ length: 1_000 }, (_, index) => entryFixture(`Notes/Item ${String(index)}.md`, {
    "note.domain": "Notes",
    "note.title": `Item ${String(index)}`,
  }));
  const entries = fixtures.map((fixture) => fixture.entry);
  const view = new EntHierarchyBasesView({} as QueryController, asHtmlElement(parent));
  Object.assign(view, {
    app: { workspace: { getLeaf: () => ({ openFile: async () => undefined }) } },
    config: config(),
    data: result(entries, [group(entries)]),
  });

  view.onDataUpdated();
  assert.equal(firstWindow.pendingTimeouts(), 1);
  const staleOldWindowCallback = firstWindow.firstPendingCallback();
  adoptIntoDocument(parent, secondDocument);
  if (!migrationListener) throw new Error("Expected a window migration listener.");
  migrationListener(secondWindow);
  assert.equal(firstWindow.pendingTimeouts(), 0);
  assert.equal(secondWindow.pendingTimeouts(), 1);
  if (typeof staleOldWindowCallback === "function") staleOldWindowCallback();
  assert.equal(secondWindow.pendingTimeouts(), 1, "a retained callback from the old window must be inert");
  secondWindow.flushTimeouts();
  assert.equal(parent.querySelectorAll("button.ent-cc-base-record").length, DEFAULT_HIERARCHY_BASES_PAGE_SIZE);

  view.onunload();
  assert.equal(migrationCleanupCalled, true);
});

test("1,000-entry fallback grouping is sliced and initially renders only one bounded page", () => {
  const fixtures = Array.from({ length: 1_000 }, (_, index) => entryFixture(`Group ${String(index % 10)}/Item ${String(index)}.md`, {
    "note.domain": `Group ${String(index % 10)}`,
    "note.title": `Item ${String(index)}`,
  }));
  const entries = fixtures.map((fixture) => fixture.entry);
  const harness = createViewHarness(entries, [group(entries)]);
  let groupedDataReads = 0;
  (harness.view as unknown as { data: BasesQueryResult }).data = result(
    entries,
    [group(entries)],
    () => { groupedDataReads += 1; },
  );
  harness.view.onDataUpdated();

  assert.equal(groupedDataReads, 0, "onDataUpdated must defer Obsidian's lazy groupedData getter");
  assert.equal(fixtures.flatMap((fixture) => fixture.getValueCalls).length, 0);
  assert.equal(harness.window.flushOneTimeout(), true);
  assert.equal(groupedDataReads, 1);
  assert.equal(fixtures.flatMap((fixture) => fixture.getValueCalls).length, 0);
  assert.equal(harness.window.flushOneTimeout(), true);
  const groupReads = fixtures.reduce(
    (total, fixture) => total + fixture.getValueCalls.filter((property) => property === "note.domain").length,
    0,
  );
  assert.equal(groupReads, HIERARCHY_BASES_BUILD_SLICE);
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, 0);
  harness.window.flushTimeouts();
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, DEFAULT_HIERARCHY_BASES_PAGE_SIZE);
  assert.equal(harness.window.maxPending, 1);
});

test("10,000 native groups stay linear and keep the initial DOM bounded", () => {
  const fixtures = Array.from({ length: 10_000 }, (_, index) => entryFixture(`Notes/Item ${String(index)}.md`, {
    "note.title": `Item ${String(index)}`,
  }));
  const entries = fixtures.map((fixture) => fixture.entry);
  const groups = entries.map((entry, index) => group([entry], `Group ${String(index)}`));
  const harness = createViewHarness(entries, groups);
  const started = performance.now();
  harness.view.onDataUpdated();
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, 0);
  const flushed = harness.window.flushTimeouts();
  const elapsed = performance.now() - started;

  assert.equal(flushed, 1 + Math.ceil(groups.length / HIERARCHY_BASES_BUILD_SLICE));
  assert.equal(harness.container.querySelectorAll("button.ent-cc-base-record").length, DEFAULT_HIERARCHY_BASES_PAGE_SIZE);
  assert.equal(harness.container.querySelectorAll("section.ent-cc-base-group").length, DEFAULT_HIERARCHY_BASES_PAGE_SIZE);
  assert.equal(fixtures.flatMap((fixture) => fixture.getValueCalls).length, DEFAULT_HIERARCHY_BASES_PAGE_SIZE * 4);
  assert.ok(elapsed < 1_000, `10,000 grouped entries should settle within 1,000 ms; took ${elapsed.toFixed(1)} ms`);

  for (let page = 1; page < groups.length / DEFAULT_HIERARCHY_BASES_PAGE_SIZE; page += 1) {
    const next = harness.container.querySelectorAll("button.ent-cc-button")
      .find((button) => button.textContent === "Next");
    assert.ok(next && !next.disabled, `page ${String(page)} should expose an enabled Next button`);
    next.click();
    harness.window.flushTimeouts();
    assert.equal(
      harness.container.querySelectorAll("button.ent-cc-base-record").length,
      DEFAULT_HIERARCHY_BASES_PAGE_SIZE,
      "paging must replace the current DOM window instead of accumulating rows",
    );
  }
  assert.equal(
    harness.container.querySelector('[role="status"]')?.textContent,
    "Showing 9901–10000 of 10000 entries.",
  );
});
