import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as scheduleTask, clearTimeout as cancelTask } from "node:timers";
import { TFile } from "obsidian";
import Plugin from "../src/main.ts";
import { createDefaultStore, createKnowledgeBaseEntry, migrateData, type VaultRecord, cleanSearchViewFilters } from "../src/model.ts";
import { createPortableExport, parsePortableExport, EMPTY_PORTABLE_SELECTION } from "../src/portability.ts";
import { parseKbccReturnRoute } from "../src/kbcc-return-navigation.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { createSearchCheckpoint, sortSearchInventory } from "../src/search-inventory.ts";

function record(path: string, placeholder = false, libraryId?: string): VaultRecord {
  return {
    path, title: "Airway", kind: "topic", role: libraryId ? "library" : "supporting",
    curriculumId: "", domain: "Research", topicKind: "Note", priority: "",
    reviewStatus: "unverified", synthesisStatus: "", autoresearchStatus: "",
    safetyCritical: false, sourceCount: 0, aliases: [], relatedTopics: [],
    parentTopic: "", imageStatus: "", doseStatus: "", sourceCoverage: "",
    folderOrder: "", mtime: 1, aiLock: false,
    ...(placeholder ? { isPlaceholder: true } : {}), ...(libraryId ? { libraryId } : {}),
  };
}

function searchPlugin() {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.setupComplete = true;
  data.indexFolderSources = [{ id: "root", path: "Notes", origin: "explicit" }];
  const store = createDefaultStore(data, 1, "search-scope-test");
  store.bases.push(createKnowledgeBaseEntry(structuredClone(data), "second", 2));
  const first = store.bases[0];
  const firstRecords = [record("kbcc-placeholder:first", true), record("Notes/Linked.md"), record("Notes/Library.md", false, "reference")];
  const secondRecords = [record("Other/Airway.md"), record("kbcc-placeholder:second", true)];
  const plugin = new Plugin({
    vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  } as never, {} as never);
  Object.assign(plugin, {
    store, data: first.data,
    recordsCacheByBase: new Map([[first.id, firstRecords], ["second", secondRecords]]),
  });
  return { plugin, firstId: first.id };
}

test("base, Library, and note-availability scopes filter before exact counts and top-K selection", async () => {
  const { plugin, firstId } = searchPlugin();
  const all = await plugin.searchKnowledgeBases("airway");
  assert.equal(all?.total, 5);
  const current = await plugin.searchKnowledgeBases("airway", { baseIds: [firstId] });
  assert.equal(current?.total, 3);
  assert.equal(current?.counts.length, 1);
  const library = await plugin.searchKnowledgeBases("airway", { baseIds: [firstId], libraryId: "reference" });
  assert.equal(library?.total, 1);
  assert.equal(library?.groups[0]?.records[0]?.path, "Notes/Library.md");
  assert.equal((await plugin.searchKnowledgeBases("", { availability: "linked" }))?.total, 3);
  assert.equal((await plugin.searchKnowledgeBases("", { availability: "placeholders" }))?.total, 2);
  assert.equal((await plugin.searchKnowledgeBases("airway", { baseIds: ["missing"] }))?.total, 0);
  assert.equal((await plugin.searchKnowledgeBases("airway"))?.total, 5, "a filtered search does not contaminate cached projections");
});

test("linked-first ranking reserves the bounded page for linked notes before placeholders", async () => {
  const { plugin } = searchPlugin();
  const result = await plugin.searchKnowledgeBases("airway", { linkedFirst: true, limit: 3 });
  assert.equal(result?.total, 5);
  assert.equal(result?.rendered, 3);
  assert.equal(result?.groups.flatMap((group) => group.records).some((item) => item.isPlaceholder), false);
});

test("cold search can cancel at its first preparation checkpoint without sorting the complete inventory", async () => {
  const { plugin } = searchPlugin();
  let pathReads = 0;
  let metadataReads = 0;
  const files = Array.from({ length: 20_000 }, (_, index) => {
    const file = new TFile(`Notes/Topic ${20_000 - index}.md`);
    const path = file.path;
    Object.defineProperty(file, "path", { get: () => { pathReads += 1; return path; } });
    return file;
  });
  Object.assign(plugin, {
    recordsCacheByBase: new Map(),
    app: {
      vault: { getMarkdownFiles: () => files },
      metadataCache: { getFileCache: () => { metadataReads += 1; return { frontmatter: {} }; } },
    },
  });
  let checks = 0;
  const pending = plugin.searchKnowledgeBases("topic", { isCancelled: () => ++checks > 1 });
  assert.ok(pathReads < 10_000, `only a bounded initial sort run may execute before the first await; read ${pathReads} paths`);
  assert.equal(await pending, null);
  assert.equal(metadataReads, 0, "cancelled preparation must not start the metadata scan");
});

test("chunked inventory sorting is exact, nonmutating, and cancellable during merge", async () => {
  const input = Array.from({ length: 1_301 }, (_, index) => ({ path: `Path ${1_301 - index}` }));
  const original = input.map((item) => item.path);
  const sorted = await sortSearchInventory(input, async () => true);
  assert.deepEqual(sorted?.map((item) => item.path), [...original].sort());
  assert.deepEqual(input.map((item) => item.path), original);
  let checkpoints = 0;
  assert.equal(await sortSearchInventory(input, async () => ++checkpoints < 5), null);
  assert.deepEqual(await sortSearchInventory([], async () => true), []);
  assert.deepEqual((await sortSearchInventory(input, () => true))?.map((item) => item.path), [...original].sort());
  assert.equal(await sortSearchInventory(input, () => false), null);
});

test("default checkpoints yield first, keep cheap steps synchronous, and cancel after a real task", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const tasks: Array<() => void> = [];
  let clock = 0;
  let cancelled = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    activeWindow: { setTimeout: (callback: () => void) => { tasks.push(callback); return tasks.length; } },
  } });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
  try {
    const checkpoint = createSearchCheckpoint(() => cancelled);
    const first = checkpoint();
    assert.ok(first instanceof Promise, "the first default checkpoint schedules a browser task");
    assert.equal(tasks.length, 1);
    tasks.shift()?.();
    assert.equal(await first, true);
    for (let index = 0; index < 10_000; index += 1) {
      assert.equal(checkpoint(), true, "cheap checks must neither await a microtask nor force an item-count timer");
    }
    assert.equal(tasks.length, 0);
    clock = 3.99;
    assert.equal(checkpoint(), true);
    clock = 4;
    const next = checkpoint();
    assert.ok(next instanceof Promise, "the 4 ms work budget still yields a real task");
    assert.equal(tasks.length, 1);
    cancelled = true;
    tasks.shift()?.();
    assert.equal(await next, false, "cancellation is rechecked after resuming the task");
    assert.equal(checkpoint(), false, "cancellation is checked on synchronous steps too");

    cancelled = false;
    const explicit = createSearchCheckpoint(() => cancelled, 3);
    assert.equal(explicit(), true);
    clock += 50;
    assert.equal(explicit(), true, "explicit yieldEvery remains count-driven");
    const third = explicit();
    assert.ok(third instanceof Promise);
    tasks.shift()?.();
    assert.equal(await third, true);
    assert.equal(explicit(), true);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousPerformance) Object.defineProperty(globalThis, "performance", previousPerformance);
    else Reflect.deleteProperty(globalThis, "performance");
  }
});

test("overflowing projection admission still counts every record and never caches a partial or filtered base", async () => {
  const { plugin, firstId } = searchPlugin();
  const state = plugin as unknown as {
    inactiveSearchCachedRecordCount: number;
    inactiveSearchRecordsCache: Map<string, VaultRecord[]>;
  };
  Object.assign(plugin, {
    recordsCacheByBase: new Map(),
    inactiveSearchCachedRecordCount: 49_998,
    iterateRecordScanForEntry: function* () {
      yield record("Notes/Linked A.md");
      yield record("Notes/Linked B.md");
      yield record("kbcc-placeholder:overflow", true);
    },
  });
  const overflow = await plugin.searchKnowledgeBases("airway", { availability: "linked" });
  assert.equal(overflow?.total, 4);
  assert.equal(state.inactiveSearchRecordsCache.has("second"), false, "an over-capacity base cannot publish its retained prefix");
  assert.equal(state.inactiveSearchCachedRecordCount, 49_998);
  assert.equal(state.inactiveSearchRecordsCache.has(firstId), false, "search must not retain its active-base projection");

  state.inactiveSearchCachedRecordCount = 49_997;
  assert.equal((await plugin.searchKnowledgeBases("airway", { availability: "linked" }))?.total, 4);
  assert.equal(state.inactiveSearchRecordsCache.get("second")?.length, 3, "admitted projections are complete and unfiltered");
  assert.equal(state.inactiveSearchCachedRecordCount, 50_000);
  assert.equal((await plugin.searchKnowledgeBases("airway", { availability: "placeholders" }))?.total, 2);
});

test("a generation change at the first task cannot publish inventory, projections, or a result", async () => {
  const { plugin } = searchPlugin();
  const state = plugin as unknown as {
    searchGeneration: number;
    knowledgeBaseSearchVaultSnapshot: unknown;
    inactiveSearchRecordsCache: Map<string, VaultRecord[]>;
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.assign(plugin, {
    recordsCacheByBase: new Map(),
    app: {
      vault: { getMarkdownFiles: () => [new TFile("Notes/Airway.md")] },
      metadataCache: { getFileCache: () => { throw new Error("stale preparation reached metadata"); } },
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    activeWindow: { setTimeout: (callback: () => void) => scheduleTask(() => { state.searchGeneration += 1; callback(); }, 0) },
  } });
  try {
    assert.equal(await plugin.searchKnowledgeBases("airway"), null);
    assert.equal(state.knowledgeBaseSearchVaultSnapshot, null);
    assert.equal(state.inactiveSearchRecordsCache.size, 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("cold default search yields to a timer task before metadata preparation and observes cancellation", { timeout: 5_000 }, async () => {
  const { plugin } = searchPlugin();
  const files = Array.from({ length: 20_000 }, (_, index) => new TFile(`Notes/Topic ${20_000 - index}.md`));
  let metadataReads = 0;
  let taskYields = 0;
  let cancelled = false;
  let finished = false;
  let timerRanBeforeFinish = false;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  // Exercise the production browser branch using real Node timer tasks. A
  // Promise.resolve/queueMicrotask-only checkpoint cannot satisfy this check.
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { activeWindow: { setTimeout: (callback: () => void, delay: number) => {
      taskYields += 1;
      return scheduleTask(callback, delay);
    } } },
  });
  Object.assign(plugin, {
    recordsCacheByBase: new Map(),
    app: {
      vault: { getMarkdownFiles: () => files },
      metadataCache: { getFileCache: () => { metadataReads += 1; return { frontmatter: {} }; } },
    },
  });
  const cancellationTask = scheduleTask(() => {
    timerRanBeforeFinish = !finished;
    cancelled = true;
  }, 0);
  try {
    const result = await plugin.searchKnowledgeBases("topic", { isCancelled: () => cancelled });
    finished = true;
    assert.equal(result, null);
    assert.equal(timerRanBeforeFinish, true, "the event loop regains a task before search finishes");
    assert.ok(taskYields > 0, "default scheduling uses a timer, not only microtask checkpoints");
    assert.equal(metadataReads, 0, "cancellation at the first task yield precedes metadata preparation");
  } finally {
    cancelTask(cancellationTask);
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("saved search filters survive migration, portable export/import, and note-return routes", () => {
  const legacy = { id: "legacy", name: "Old search", tab: "curriculum", query: "airway" };
  const scoped = { id: "scoped", name: "Linked here", tab: "curriculum", query: "airway", scope: "current", availability: "linked", linkedFirst: true };
  const data = migrateData({ ...migrateData(null), savedViews: [legacy, scoped] });
  assert.deepEqual(data.savedViews, [legacy, scoped]);
  const portable = parsePortableExport(createPortableExport(data, [], { ...EMPTY_PORTABLE_SELECTION, savedViews: true }, "2026-09-09T00:00:00.000Z"));
  assert.deepEqual(portable.components.savedViews?.views, [legacy, scoped]);
  const route = parseKbccReturnRoute({
    notePath: "Notes/Airway.md", baseId: "base-a", capturedAt: 1,
    view: { activeTab: "curriculum", selectedPath: "Notes/Airway.md", query: "", scope: "current", availability: "linked", linkedFirst: true,
      detailVisible: false, browseRowLimit: 300, browseStructureLimit: 300, listScrollTop: 32, detailScrollTop: 0 },
  });
  assert.equal(route.view.scope, "current");
  assert.equal(route.view.availability, "linked");
  assert.equal(route.view.linkedFirst, true);
  assert.deepEqual(cleanSearchViewFilters({ scope: "bad", availability: 1, linkedFirst: "true" }), {});
});

test("restoring an old saved search resets every filter and Library scope falls back when its tab is missing", () => {
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    searchScope: string; searchAvailability: string; searchLinkedFirst: boolean;
    restoreSearchFilters(filters: object, tab: string): void;
  };
  view.searchScope = "library";
  view.searchAvailability = "placeholders";
  view.searchLinkedFirst = true;
  view.restoreSearchFilters({}, "curriculum");
  assert.equal(view.searchScope, "all");
  assert.equal(view.searchAvailability, "all");
  assert.equal(view.searchLinkedFirst, false);
  view.restoreSearchFilters({ scope: "library", availability: "linked", linkedFirst: true }, "curriculum");
  assert.equal(view.searchScope, "current");
  view.restoreSearchFilters({ scope: "library" }, "library:references");
  assert.equal(view.searchScope, "library");
});
