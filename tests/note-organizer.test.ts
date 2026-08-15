import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  MAX_TRANSFER_LIST_ITEMS,
  semanticEntryFingerprint,
  type KnowledgeBaseEntry,
  type LayoutHeading,
  type PluginData,
  type PluginStore,
  type RecordKind,
} from "../src/model.ts";
import {
  applyNoteOrganizerPlan,
  createNoteOrganizerPlan,
  type NoteOrganizerDirective,
  type NoteOrganizerFileFact,
  type NoteOrganizerPlan,
} from "../src/note-organizer.ts";

function data(name: string, mode: "generic" | "ent-clinical" = "generic"): PluginData {
  const value = structuredClone(DEFAULT_DATA);
  value.settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    setupComplete: true,
    workspaceName: name,
    workspaceMode: mode,
    primaryFolder: mode === "ent-clinical" ? "03 Clinical Topics" : `${name} Notes`,
  };
  return value;
}

function entry(id: string, name: string, mode: "generic" | "ent-clinical" = "generic"): KnowledgeBaseEntry {
  return createKnowledgeBaseEntry(data(name, mode), id, 100);
}

function seal(value: KnowledgeBaseEntry): KnowledgeBaseEntry {
  value.semanticHash = semanticEntryFingerprint(value);
  value.semanticHead = value.semanticHash;
  value.semanticLineage = [];
  return value;
}

function storeWith(entries: KnowledgeBaseEntry[], activeBaseId = entries[0]?.id ?? "base-default"): PluginStore {
  const store = createDefaultStore(structuredClone(entries[0]?.data ?? data("Fallback")), 1, "vault-organizer");
  store.bases = entries.map((value) => structuredClone(seal(value)));
  store.activeBaseId = activeBaseId;
  return store;
}

function fact(
  baseId: string,
  path: string,
  overrides: Partial<NoteOrganizerFileFact> = {},
): NoteOrganizerFileFact {
  const title = path.split("/").pop()?.replace(/\.md$/iu, "") ?? "Note";
  return {
    path,
    baseId,
    title,
    mtime: 1000,
    size: 250,
    exists: true,
    markdown: true,
    eligible: true,
    sourceKind: "note",
    sourceRole: "vault-note",
    configuredId: "",
    indexEligible: false,
    suggestedIndexGroup: "Ungrouped",
    ...overrides,
  };
}

function addLibrary(
  value: PluginData,
  id: string,
  name: string,
  sourceKind: RecordKind | null = null,
  archivedAt: number | null = null,
): LayoutHeading {
  value.portableIndex.libraries.push({
    id,
    name,
    singularName: name.replace(/s$/u, "") || name,
    icon: "library",
    order: value.portableIndex.libraries.length,
    sourceKind: sourceKind === "procedure" || sourceKind === "medication" || sourceKind === "syndrome"
      ? sourceKind
      : null,
    archivedAt,
  });
  const heading: LayoutHeading = {
    id: `${id}-heading`,
    title: `${name} heading`,
    collapsed: true,
    subjects: [],
    subheadings: [{
      id: `${id}-subheading`,
      title: `${name} section`,
      collapsed: true,
      subjects: [],
    }],
  };
  value.portableIndex.libraryLayouts[id] = [heading];
  return heading;
}

function addCollection(value: PluginData, id: string, title: string): LayoutHeading {
  const heading: LayoutHeading = {
    id,
    title,
    collapsed: true,
    subjects: [],
    subheadings: [{
      id: `${id}-subheading`,
      title: `${title} section`,
      collapsed: true,
      subjects: [],
    }],
  };
  value.collections.push(heading);
  return heading;
}

function addSubject(
  value: PluginData,
  path: string,
  options: {
    id: string;
    kind?: RecordKind;
    indexed: boolean;
    libraryId?: string | null;
    groupTitle?: string;
    heading?: LayoutHeading;
  },
): void {
  const groupId = `group-${options.id}`;
  value.portableIndex.groups.push({
    id: groupId,
    title: options.groupTitle ?? "Existing group",
    order: value.portableIndex.groups.length,
  });
  value.portableIndex.subjects.push({
    id: options.id,
    title: path.split("/").pop()?.replace(/\.md$/iu, "") ?? "Note",
    groupId,
    parentId: null,
    order: value.portableIndex.subjects.length,
    indexed: options.indexed,
    configuredId: "",
    recordKind: options.kind ?? "note",
    libraryId: options.libraryId ?? null,
  });
  value.portableIndex.resolvedPathBySubjectId[options.id] = path;
  if (options.indexed) {
    value.directIndexPaths.push(path);
    value.indexGroupByPath[path] = options.groupTitle ?? "Existing group";
  } else if (options.heading) {
    options.heading.subjects.push(options.id);
  }
}

function clonePlan(plan: Readonly<NoteOrganizerPlan>): NoteOrganizerPlan {
  return structuredClone(plan);
}

test("one exact plan organizes many notes across many bases without touching source or active-base state", () => {
  const first = entry("base-a", "Alpha");
  const second = entry("base-b", "Beta");
  const firstLibrary = addLibrary(first.data, "references-a", "References");
  const secondLibrary = addLibrary(second.data, "references-b", "Evidence");
  const firstCollection = addCollection(first.data, "collection-a", "Cases");
  const secondCollection = addCollection(second.data, "collection-b", "Reading");
  const path = "Vault/Laryngomalacia.md";
  addSubject(first.data, path, {
    id: "subject-a",
    indexed: false,
    libraryId: "references-a",
    heading: firstLibrary,
  });
  addSubject(second.data, path, {
    id: "subject-b",
    indexed: true,
    groupTitle: "Inbox",
  });
  first.data.pinnedPaths.push(path);
  first.data.nextStudyPaths.push(path);
  second.data.pinnedPaths.push(path);
  second.data.nextStudyPaths.push(path);
  const store = storeWith([first, second], "base-a");
  const before = structuredClone(store);
  const facts = [
    fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Airway" }),
    fact("base-b", path, { indexEligible: true, suggestedIndexGroup: "Airway" }),
  ];
  const directives: NoteOrganizerDirective[] = [
    {
      baseId: "base-a",
      path,
      primary: { mode: "index", groupTitle: "Pediatric airway" },
      collections: { mode: "add", targets: [{ headingId: firstCollection.id }] },
    },
    {
      baseId: "base-b",
      path,
      primary: {
        mode: "library",
        libraryId: "references-b",
        headingId: secondLibrary.id,
        subheadingId: secondLibrary.subheadings[0]?.id,
      },
      collections: { mode: "add", targets: [{ headingId: secondCollection.id }] },
    },
  ];

  const plan = createNoteOrganizerPlan(store, facts, directives, {
    now: 500,
    expectedExternalGeneration: 9,
    label: "Organize selected notes",
  });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.operations), true);
  assert.equal(plan.summary.selectedNoteCount, 1);
  assert.equal(plan.summary.requestedBaseCount, 2);
  assert.equal(plan.summary.changedBaseCount, 2);
  assert.equal(plan.summary.changedNoteBaseCount, 2);
  assert.match(plan.diffs[0]?.primaryChange ?? "", /Library .*References.* → Index — Pediatric airway/u);
  assert.match(plan.diffs[1]?.primaryChange ?? "", /Index — Inbox → Library .*Evidence/u);
  assert.equal(plan.operations.every((operation) => operation.undoSnapshotAt === 500), true);
  assert.equal(plan.operations.every((operation) => (
    operation.afterEntry.data.undoStack.at(-1)?.label === "Organize selected notes"
      && operation.afterEntry.data.undoStack.at(-1)?.at === 500
  )), true);
  const frozenPlanJson = JSON.stringify(plan);

  const applied = applyNoteOrganizerPlan(store, plan, facts, 9);
  assert.deepEqual(store, before, "planning and applying leave the supplied store immutable");
  assert.notEqual(applied, store);
  assert.equal(applied.activeBaseId, "base-a");
  const afterFirst = applied.bases.find((value) => value.id === "base-a")?.data;
  const afterSecond = applied.bases.find((value) => value.id === "base-b")?.data;
  assert.ok(afterFirst);
  assert.ok(afterSecond);
  assert.equal(afterFirst.directIndexPaths.includes(path), true);
  assert.equal(afterFirst.indexGroupByPath[path], "Pediatric airway");
  assert.equal(afterFirst.collections[0]?.subjects.includes(path), true);
  assert.equal(afterFirst.pinnedPaths.includes(path), true);
  assert.equal(afterFirst.nextStudyPaths.includes(path), true);
  assert.equal(afterFirst.indexFolderSources.length, 0, "exact paths never create folder authority");
  assert.equal(afterSecond.directIndexPaths.includes(path), false);
  assert.equal(afterSecond.portableIndex.subjects.find((subject) => subject.id === "subject-b")?.libraryId, "references-b");
  assert.equal(afterSecond.portableIndex.libraryLayouts["references-b"]?.[0]?.subheadings[0]?.subjects.includes("subject-b"), true);
  assert.equal(afterSecond.collections[0]?.subjects.includes(path), true);
  afterFirst.directIndexPaths.push("Vault/Post-apply caller mutation.md");
  assert.equal(JSON.stringify(plan), frozenPlanJson, "the applied store never aliases back into the frozen review plan");
  assert.equal(plan.operations[0]?.afterEntry.data.directIndexPaths.includes("Vault/Post-apply caller mutation.md"), false);
});

test("Collection Add preserves all membership while Replace clears only that path, and defaults keep primary placement", () => {
  const base = entry("base-a", "Alpha");
  const first = addCollection(base.data, "collection-one", "One");
  const second = addCollection(base.data, "collection-two", "Two");
  const third = addCollection(base.data, "collection-three", "Three");
  const addPath = "Vault/Add.md";
  const replacePath = "Vault/Replace.md";
  first.subjects.push(addPath, replacePath, "Vault/Other.md");
  second.subheadings[0]?.subjects.push(addPath, replacePath);
  base.data.directIndexPaths.push(addPath, replacePath);
  base.data.indexGroupByPath[addPath] = "Topics";
  base.data.indexGroupByPath[replacePath] = "Topics";
  base.data.pinnedPaths.push(addPath, replacePath);
  base.data.nextStudyPaths.push(addPath, replacePath);
  const store = storeWith([base]);
  const facts = [fact("base-a", addPath), fact("base-a", replacePath)];
  const plan = createNoteOrganizerPlan(store, facts, [
    {
      baseId: "base-a",
      path: addPath,
      collections: { mode: "add", targets: [{ headingId: third.id }] },
    },
    {
      baseId: "base-a",
      path: replacePath,
      collections: {
        mode: "replace",
        targets: [{ headingId: third.id, subheadingId: third.subheadings[0]?.id }],
      },
    },
  ], { now: 600 });
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  const after = applied.bases[0]?.data;
  assert.ok(after);
  assert.equal(after.collections[0]?.subjects.includes(addPath), true);
  assert.equal(after.collections[1]?.subheadings[0]?.subjects.includes(addPath), true);
  assert.equal(after.collections[2]?.subjects.includes(addPath), true);
  assert.equal(after.collections[0]?.subjects.includes(replacePath), false);
  assert.equal(after.collections[1]?.subheadings[0]?.subjects.includes(replacePath), false);
  assert.equal(after.collections[2]?.subheadings[0]?.subjects.includes(replacePath), true);
  assert.equal(after.collections[0]?.subjects.includes("Vault/Other.md"), true);
  assert.deepEqual(after.directIndexPaths, [addPath, replacePath]);
  assert.deepEqual(after.pinnedPaths, [addPath, replacePath]);
  assert.deepEqual(after.nextStudyPaths, [addPath, replacePath]);
  assert.equal(plan.summary.collectionAdds, 2);
  assert.equal(plan.summary.collectionRemoves, 2);
  assert.equal(plan.summary.primaryChanges, 0);
});

test("exact Replace and same-Library placement remain no-ops inside a base that has another real change", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "library-a", "Library A");
  const currentCollection = addCollection(base.data, "current", "Current");
  const newCollection = addCollection(base.data, "new", "New");
  const exactPath = "Vault/Already organized.md";
  const changedPath = "Vault/Needs collection.md";
  addSubject(base.data, exactPath, {
    id: "subject-exact",
    indexed: false,
    libraryId: "library-a",
    groupTitle: library.title,
    heading: library,
  });
  currentCollection.subjects.push(exactPath, "Vault/Other.md");
  const store = storeWith([base]);
  const facts = [fact("base-a", exactPath), fact("base-a", changedPath)];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path: exactPath,
    primary: { mode: "library", libraryId: "library-a", headingId: library.id },
    collections: { mode: "replace", targets: [{ headingId: currentCollection.id }] },
  }, {
    baseId: "base-a",
    path: changedPath,
    collections: { mode: "add", targets: [{ headingId: newCollection.id }] },
  }], { now: 650 });

  assert.equal(plan.summary.changedNoteBaseCount, 1);
  assert.equal(plan.summary.noOpDirectiveCount, 1);
  assert.equal(plan.summary.primaryChanges, 0);
  assert.equal(plan.diffs[0]?.path, changedPath);
  assert.deepEqual(plan.reviews.map((review) => ({ path: review.path, changed: review.changed })), [
    { path: exactPath, changed: false },
    { path: changedPath, changed: true },
  ]);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied.bases[0].data.collections[0]?.subjects, [exactPath, "Vault/Other.md"]);
  const subjectOccurrences = applied.bases[0].data.portableIndex.libraryLayouts["library-a"]
    ?.flatMap((heading) => heading.subjects)
    .filter((subjectId) => subjectId === "subject-exact").length;
  assert.equal(subjectOccurrences, 1);
});

test("an exact same-node Library placement preserves duplicate legacy subject occurrences", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "library-a", "Library A");
  const path = "Vault/Duplicate Library member.md";
  addSubject(base.data, path, {
    id: "subject-duplicate-library-member",
    indexed: false,
    libraryId: "library-a",
    groupTitle: library.title,
    heading: library,
  });
  library.subjects.push("subject-duplicate-library-member");
  const store = storeWith([base]);
  const facts = [fact("base-a", path)];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "library", libraryId: "library-a", headingId: library.id },
  }], { now: 6501 });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.reviews[0]?.changed, false);
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.deepEqual(
    applied.bases[0]?.data.portableIndex.libraryLayouts["library-a"]?.[0]?.subjects,
    ["subject-duplicate-library-member", "subject-duplicate-library-member"],
  );
});

test("an exact same-Library request preserves all migrated hidden authority fields", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "procedures", "Procedures", "procedure");
  const path = "Vault/Migrated exact Library member.md";
  addSubject(base.data, path, {
    id: "subject-migrated-library-member",
    kind: "note",
    indexed: false,
    libraryId: "procedures",
    groupTitle: "Legacy imported group",
    heading: library,
  });
  base.data.directIndexPaths.push(path);
  base.data.manualIndexPaths.push(path);
  base.data.excludedIndexPaths.push(path);
  base.data.indexGroupByPath[path] = "Legacy Index group";
  const store = storeWith([base]);
  const facts = [fact("base-a", path)];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "library", libraryId: "procedures", headingId: library.id },
  }], { now: 6502 });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.reviews[0]?.changed, false);
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  const subject = applied.bases[0]?.data.portableIndex.subjects
    .find((candidate) => candidate.id === "subject-migrated-library-member");
  assert.equal(subject?.recordKind, "note");
  assert.equal(
    applied.bases[0]?.data.portableIndex.groups.find((group) => group.id === subject?.groupId)?.title,
    "Legacy imported group",
  );
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, [path]);
  assert.deepEqual(applied.bases[0]?.data.manualIndexPaths, [path]);
  assert.deepEqual(applied.bases[0]?.data.excludedIndexPaths, [path]);
  assert.equal(applied.bases[0]?.data.indexGroupByPath[path], "Legacy Index group");
});

test("an exact Index request preserves an archived Library identity and its layout placement", () => {
  const base = entry("base-a", "Alpha");
  const archived = addLibrary(base.data, "archived", "Archived", null, 10);
  const path = "Vault/Archived Library member projected into Index.md";
  addSubject(base.data, path, {
    id: "subject-archived-projected-index",
    indexed: false,
    libraryId: "archived",
    groupTitle: "Archived legacy group",
    heading: archived,
  });
  base.data.directIndexPaths.push(path);
  base.data.indexGroupByPath[path] = "Projected Index";
  const store = storeWith([base]);
  const facts = [fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Projected Index" })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "Projected Index" },
  }], { now: 6503 });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.reviews[0]?.changed, false);
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.equal(
    applied.bases[0]?.data.portableIndex.subjects.find((subject) => subject.id === "subject-archived-projected-index")?.libraryId,
    "archived",
  );
  assert.deepEqual(
    applied.bases[0]?.data.portableIndex.libraryLayouts.archived?.[0]?.subjects,
    ["subject-archived-projected-index"],
  );
});

test("an exact Index request preserves conflicting direct and excluded authority", () => {
  const base = entry("base-a", "Alpha");
  const path = "Vault/Direct and excluded Index member.md";
  addSubject(base.data, path, {
    id: "subject-direct-excluded-index",
    indexed: true,
    groupTitle: "Topics",
  });
  base.data.excludedIndexPaths.push(path);
  const store = storeWith([base]);
  const facts = [fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Topics" })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "Topics" },
  }], { now: 6504 });

  assert.equal(plan.operations.length, 0);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, [path]);
  assert.deepEqual(applied.bases[0]?.data.excludedIndexPaths, [path]);
});

test("an exact Index request preserves an indexed portable identity without direct or map authority", () => {
  const base = entry("base-a", "Alpha");
  const path = "Vault/Portable-only Index member.md";
  addSubject(base.data, path, {
    id: "subject-portable-only-index",
    indexed: true,
    groupTitle: "Portable group",
  });
  base.data.directIndexPaths = [];
  delete base.data.indexGroupByPath[path];
  const store = storeWith([base]);
  const facts = [fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Portable group" })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "Portable group" },
  }], { now: 6505 });

  assert.equal(plan.operations.length, 0);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, []);
  assert.equal(Object.prototype.hasOwnProperty.call(applied.bases[0]?.data.indexGroupByPath ?? {}, path), false);
});

test("an automatic-folder-only Index request still discloses a real durable strengthening diff", () => {
  const base = entry("base-a", "Alpha");
  const path = "Linked/Automatic only.md";
  base.data.indexFolderSources = [{ id: "linked-source", path: "Linked", origin: "user" }];
  base.data.indexGroupByPath[path] = "General";
  const store = storeWith([base]);
  const facts = [fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "General" })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "General" },
  }], { now: 6506 });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.reviews[0]?.changed, true);
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  assert.equal(plan.diffs[0]?.primaryChange, null);
  assert.equal(plan.diffs[0]?.portableIdentity, "created");
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, [path]);
  assert.equal(
    Object.values(applied.bases[0]?.data.portableIndex.resolvedPathBySubjectId ?? {}).includes(path),
    true,
  );
});

test("Collection Replace preserves duplicate legacy occurrences in a retained target instead of hiding a repair", () => {
  const base = entry("base-a", "Alpha");
  const collection = addCollection(base.data, "collection-one", "One");
  const path = "Vault/Duplicate collection member.md";
  collection.subjects.push(path, "Vault/Sibling.md", path);
  const store = storeWith([base]);
  const facts = [fact("base-a", path)];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    collections: { mode: "replace", targets: [{ headingId: collection.id }] },
  }], { now: 651 });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.reviews[0]?.changed, false);
  assert.deepEqual(
    applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration),
    store,
  );
  assert.deepEqual(store.bases[0]?.data.collections[0]?.subjects, [path, "Vault/Sibling.md", path]);
});

test("a duplicate active placement in one Library fails before an exact-looking move can hide a removal", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "library-a", "Library A");
  const path = "Vault/Duplicate placement.md";
  addSubject(base.data, path, {
    id: "subject-duplicate-placement",
    indexed: false,
    libraryId: "library-a",
    groupTitle: library.title,
    heading: library,
  });
  library.subheadings[0]?.subjects.push("subject-duplicate-placement");
  const store = storeWith([base]);
  const before = structuredClone(store);
  const facts = [fact("base-a", path)];
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "library", libraryId: "library-a", headingId: library.id },
  }], { now: 675 }), /more than one active layout placement.*Library .*Library A.*Repair the duplicate Library placement/iu);
  assert.deepEqual(store, before);
});

test("a stale cross-Library layout reference fails before an exact request can silently remove it", () => {
  const base = entry("base-a", "Alpha");
  const currentLibrary = addLibrary(base.data, "library-a", "Library A");
  const foreignLibrary = addLibrary(base.data, "library-b", "Library B");
  const path = "Vault/Stale cross-Library placement.md";
  addSubject(base.data, path, {
    id: "subject-cross-library-placement",
    indexed: false,
    libraryId: "library-a",
    groupTitle: currentLibrary.title,
    heading: currentLibrary,
  });
  foreignLibrary.subjects.push("subject-cross-library-placement");
  const store = storeWith([base]);
  const before = structuredClone(store);
  const facts = [fact("base-a", path)];

  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "library", libraryId: "library-a", headingId: currentLibrary.id },
  }], { now: 676 }), /stale layout reference.*Library .*Library B.*stored placement.*Library A.*Repair the stale Library placement/iu);
  assert.deepEqual(store, before);
});

test("an indexed subject with a stale Library layout reference also fails closed", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "library-a", "Library A");
  const path = "Vault/Indexed with stale Library placement.md";
  addSubject(base.data, path, {
    id: "subject-indexed-stale-library-placement",
    indexed: true,
    groupTitle: "Topics",
  });
  library.subjects.push("subject-indexed-stale-library-placement");
  const store = storeWith([base]);
  const before = structuredClone(store);
  const facts = [fact("base-a", path)];

  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "Topics" },
  }], { now: 677 }), /stale layout reference.*Library .*Library A.*stored placement in the Index.*Repair the stale Library placement/iu);
  assert.deepEqual(store, before);
});

test("none removes only explicit primary placement and reveals protected clinical source fallback", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  addLibrary(base.data, "procedure", "Procedures", "procedure");
  const custom = addLibrary(base.data, "custom", "My review");
  const collection = addCollection(base.data, "collection", "Cases");
  const path = "04 Procedures/Procedure - Airway.md";
  addSubject(base.data, path, {
    id: "subject-procedure",
    kind: "procedure",
    indexed: false,
    libraryId: "custom",
    heading: custom,
  });
  collection.subjects.push(path);
  base.data.pinnedPaths.push(path);
  base.data.nextStudyPaths.push(path);
  const store = storeWith([base]);
  const facts = [fact("base-clinical", path, {
    sourceKind: "procedure",
    sourceRole: "library",
    indexEligible: false,
    suggestedIndexGroup: "Procedures",
  })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-clinical",
    path,
    primary: { mode: "none" },
  }], { now: 700 });
  assert.match(plan.diffs[0]?.primaryChange ?? "", /My review.* → Library .*Procedures.*protected source/u);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  const after = applied.bases[0]?.data;
  assert.ok(after);
  const subject = after.portableIndex.subjects.find((value) => value.id === "subject-procedure");
  assert.equal(subject?.indexed, false);
  assert.equal(subject?.libraryId, null);
  assert.equal(custom.subjects.includes("subject-procedure"), true, "the original fixture remains immutable");
  assert.equal(after.portableIndex.libraryLayouts.custom?.[0]?.subjects.includes("subject-procedure"), false);
  assert.equal(after.collections[0]?.subjects.includes(path), true);
  assert.equal(after.pinnedPaths.includes(path), true);
  assert.equal(after.nextStudyPaths.includes(path), true);
});

test("none preserves an unplaced protected Library identity when the exact review is unchanged", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  const procedures = addLibrary(base.data, "procedure", "Procedures", "procedure");
  const path = "04 Procedures/Procedure - Unplaced.md";
  addSubject(base.data, path, {
    id: "subject-unplaced-procedure",
    kind: "procedure",
    indexed: false,
    libraryId: "procedure",
    groupTitle: procedures.title,
  });
  const store = storeWith([base]);
  const facts = [fact("base-clinical", path, {
    sourceKind: "procedure",
    sourceRole: "library",
    indexEligible: false,
    suggestedIndexGroup: "Procedures",
  })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-clinical",
    path,
    primary: { mode: "none" },
  }], { now: 701 });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.reviews[0]?.changed, false);
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.equal(
    applied.bases[0]?.data.portableIndex.subjects.find((subject) => subject.id === "subject-unplaced-procedure")?.libraryId,
    "procedure",
  );
});

test("none preserves a clinically ineligible stale Index identity when it already projects as none", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  const path = "04 Procedures/Stale indexed source.md";
  addSubject(base.data, path, {
    id: "subject-clinically-ineligible-index",
    kind: "procedure",
    indexed: true,
    groupTitle: "Stale Index group",
  });
  const store = storeWith([base]);
  const facts = [fact("base-clinical", path, {
    sourceKind: "procedure",
    sourceRole: "vault-note",
    indexEligible: false,
    suggestedIndexGroup: "Procedures",
  })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-clinical",
    path,
    primary: { mode: "none" },
  }], { now: 702 });

  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.reviews[0]?.before.primary, { kind: "none" });
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.equal(
    applied.bases[0]?.data.portableIndex.subjects.find((subject) => subject.id === "subject-clinically-ineligible-index")?.indexed,
    true,
  );
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, [path]);
  assert.equal(applied.bases[0]?.data.indexGroupByPath[path], "Stale Index group");
});

test("none preserves an orphan Index group map behind an unchanged no-primary projection", () => {
  const base = entry("base-a", "Alpha");
  const path = "Vault/Orphan Index map.md";
  base.data.indexGroupByPath[path] = "Orphan group";
  const store = storeWith([base]);
  const facts = [fact("base-a", path)];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "none" },
  }], { now: 703 });

  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.reviews[0]?.before.primary, { kind: "none" });
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.equal(applied.bases[0]?.data.indexGroupByPath[path], "Orphan group");
});

test("none preserves direct and group-map metadata behind a subjectless protected fallback", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  addLibrary(base.data, "procedure", "Procedures", "procedure");
  const path = "04 Procedures/Subjectless protected fallback.md";
  base.data.directIndexPaths.push(path);
  base.data.indexGroupByPath[path] = "Imported group";
  const store = storeWith([base]);
  const facts = [fact("base-clinical", path, {
    sourceKind: "procedure",
    sourceRole: "library",
    indexEligible: false,
    suggestedIndexGroup: "Procedures",
  })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-clinical",
    path,
    primary: { mode: "none" },
  }], { now: 704 });

  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.reviews[0]?.before, plan.reviews[0]?.after);
  assert.equal(plan.reviews[0]?.before.primary.kind, "library");
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.equal(applied.bases[0]?.data.portableIndex.subjects.length, 0);
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, [path]);
  assert.equal(applied.bases[0]?.data.indexGroupByPath[path], "Imported group");
});

test("custom Libraries accept any eligible kind while protected Libraries and clinical Index enforce exact source facts", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  const custom = addLibrary(base.data, "custom", "Custom");
  const procedures = addLibrary(base.data, "procedure", "Procedures", "procedure");
  const syndromes = addLibrary(base.data, "syndrome", "Syndromes", "syndrome");
  const path = "04 Procedures/Procedure - Airway.md";
  const source = fact("base-clinical", path, {
    sourceKind: "procedure",
    sourceRole: "library",
    indexEligible: false,
  });
  const store = storeWith([base]);
  const customPlan = createNoteOrganizerPlan(store, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "library", libraryId: "custom", headingId: custom.id },
  }], { now: 800 });
  assert.equal(customPlan.summary.portableSubjectsCreated, 1);
  assert.doesNotThrow(() => applyNoteOrganizerPlan(store, customPlan, [source], customPlan.expectedExternalGeneration));
  const protectedPlan = createNoteOrganizerPlan(store, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "library", libraryId: "procedure", headingId: procedures.id },
  }], { now: 801 });
  assert.equal(protectedPlan.diffs[0]?.after.primary.kind, "library");
  assert.throws(() => createNoteOrganizerPlan(store, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "library", libraryId: "syndrome", headingId: syndromes.id },
  }], { now: 802 }), /accepts syndrome.*source-classified as procedure/iu);
  assert.throws(() => createNoteOrganizerPlan(store, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "index" },
  }], { now: 803 }), /cannot enter the protected/iu);
});

test("Generic built-in Libraries may reclassify an eligible note while ENT protected Libraries stay source-locked", () => {
  const base = entry("base-generic", "Generic");
  const procedures = addLibrary(base.data, "procedure", "Procedures", "procedure");
  const path = "Vault/Generic note.md";
  const store = storeWith([base]);
  const facts = [fact("base-generic", path, { sourceKind: "note", indexEligible: true })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-generic",
    path,
    primary: { mode: "library", libraryId: "procedure", headingId: procedures.id },
  }], { now: 825 });
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  const subject = applied.bases[0].data.portableIndex.subjects.find((candidate) => (
    applied.bases[0].data.portableIndex.resolvedPathBySubjectId[candidate.id] === path
  ));
  assert.equal(subject?.recordKind, "procedure");
  assert.equal(subject?.libraryId, "procedure");
});

test("protected ENT grouping cannot be bypassed by an Organizer Index directive", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  const path = "03 Clinical Topics/01 Pediatric/Airway.md";
  const source = fact("base-clinical", path, {
    sourceKind: "topic",
    sourceRole: "canonical",
    indexEligible: true,
    suggestedIndexGroup: "Pediatric",
  });
  const store = storeWith([base]);
  assert.throws(() => createNoteOrganizerPlan(store, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "index", groupTitle: "Otology" },
  }], { now: 850 }), /Protected clinical grouping.*Pediatric.*Otology/iu);

  const protectedPlan = createNoteOrganizerPlan(store, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "index", groupTitle: "pediatric" },
  }], { now: 851 });
  const protectedResult = applyNoteOrganizerPlan(store, protectedPlan, [source], protectedPlan.expectedExternalGeneration);
  assert.equal(protectedResult.bases[0].data.indexGroupByPath[path], "Pediatric");

  const movable = structuredClone(store);
  movable.bases[0].data.settings.allowClinicalVisualGroupMoves = true;
  movable.bases[0].semanticHash = semanticEntryFingerprint(movable.bases[0]);
  movable.bases[0].semanticHead = movable.bases[0].semanticHash;
  const movablePlan = createNoteOrganizerPlan(movable, [source], [{
    baseId: "base-clinical",
    path,
    primary: { mode: "index", groupTitle: "Otology" },
  }], { now: 852 });
  const movableResult = applyNoteOrganizerPlan(movable, movablePlan, [source], movablePlan.expectedExternalGeneration);
  assert.equal(movableResult.bases[0].data.indexGroupByPath[path], "Otology");
});

test("stale clinical portable Index state cannot make an ineligible source appear indexed in the preview", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  const custom = addLibrary(base.data, "custom", "Custom");
  const path = "03 Clinical Topics/Stale procedure.md";
  addSubject(base.data, path, {
    id: "stale-procedure",
    kind: "procedure",
    indexed: true,
    groupTitle: "Stale group",
  });
  const store = storeWith([base]);
  const facts = [fact("base-clinical", path, {
    sourceKind: "procedure",
    sourceRole: "vault-note",
    indexEligible: false,
    suggestedIndexGroup: "Protected source group",
  })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-clinical",
    path,
    primary: { mode: "library", libraryId: "custom", headingId: custom.id },
  }], { now: 875 });
  assert.deepEqual(plan.diffs[0]?.before.primary, { kind: "none" });
  assert.match(plan.diffs[0]?.primaryChange ?? "", /No primary placement → Library .*Custom/u);
});

test("moving an indexed parent fails before it can detach an unselected child hierarchy", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "library", "Library");
  const parentPath = "Vault/Parent.md";
  const childPath = "Vault/Child.md";
  addSubject(base.data, parentPath, {
    id: "parent-subject",
    indexed: true,
    groupTitle: "Topics",
  });
  addSubject(base.data, childPath, {
    id: "child-subject",
    indexed: true,
    groupTitle: "Topics",
  });
  const child = base.data.portableIndex.subjects.find((subject) => subject.id === "child-subject");
  assert.ok(child);
  child.parentId = "parent-subject";
  base.data.curriculumVisual.parentByPath[childPath] = parentPath;
  base.data.curriculumVisual.orderByContainer[`parent:${parentPath}`] = [childPath];
  const store = storeWith([base]);
  const before = structuredClone(store);
  const facts = [fact("base-a", parentPath, { indexEligible: true, suggestedIndexGroup: "Topics" })];
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path: parentPath,
    primary: { mode: "library", libraryId: "library", headingId: library.id },
  }], { now: 880 }), /Cannot reorganize .*Parent.*dependent child .*Child.*will not silently change related notes/iu);
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path: parentPath,
    primary: { mode: "index", groupTitle: "Other group" },
  }], { now: 881 }), /Cannot reorganize .*Parent.*dependent child .*Child.*will not silently change related notes/iu);
  assert.deepEqual(store, before);
});

test("locked ENT canonical grouping cannot split a protected parent from its children", () => {
  const base = entry("base-clinical", "ENT", "ent-clinical");
  const parentPath = "03 Clinical Topics/01 Pediatric/Parent.md";
  const childPath = "03 Clinical Topics/01 Pediatric/Child.md";
  addSubject(base.data, parentPath, {
    id: "ent-parent",
    indexed: true,
    groupTitle: "Otology",
  });
  addSubject(base.data, childPath, {
    id: "ent-child",
    indexed: true,
    groupTitle: "Otology",
  });
  const child = base.data.portableIndex.subjects.find((subject) => subject.id === "ent-child");
  assert.ok(child);
  child.parentId = "ent-parent";
  const store = storeWith([base]);
  const facts = [fact("base-clinical", parentPath, {
    sourceKind: "topic",
    sourceRole: "canonical",
    indexEligible: true,
    suggestedIndexGroup: "Pediatric",
  })];
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-clinical",
    path: parentPath,
    primary: { mode: "index", groupTitle: "Pediatric" },
  }], { now: 885 }), /Cannot reorganize .*Parent.*dependent child .*Child/iu);
});

test("an exact Index directive preserves selected-note visual metadata", () => {
  const base = entry("base-a", "Alpha");
  const path = "Vault/Nested.md";
  addSubject(base.data, path, { id: "nested", indexed: true, groupTitle: "Topics" });
  base.data.curriculumVisual.parentByPath[path] = null;
  base.data.curriculumVisual.orderByContainer["group:Topics"] = [path, "Vault/Sibling.md"];
  const store = storeWith([base]);
  const facts = [fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Topics" })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "Topics" },
  }], { now: 890 });

  assert.equal(plan.operations.length, 0);
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  assert.deepEqual(applied, store);
  assert.equal(applied.bases[0]?.data.curriculumVisual.parentByPath[path], null);
  assert.deepEqual(
    applied.bases[0]?.data.curriculumVisual.orderByContainer["group:Topics"],
    [path, "Vault/Sibling.md"],
  );
});

test("the plan is deterministic, deduplicates no-ops, and allocates or reuses base-local portable identities", () => {
  const first = entry("base-a", "Alpha");
  const second = entry("base-b", "Beta");
  const reuseLibrary = addLibrary(first.data, "library-a", "Library A");
  const firstCollection = addCollection(first.data, "collection-a", "Cases");
  const path = "Vault/Shared.md";
  firstCollection.subjects.push(path);
  const store = storeWith([first, second]);
  const noOpFacts = [fact("base-a", path)];
  const noOpDirective: NoteOrganizerDirective[] = [{
    baseId: "base-a",
    path,
    collections: { mode: "add", targets: [{ headingId: firstCollection.id }] },
  }];
  const noOp = createNoteOrganizerPlan(store, noOpFacts, noOpDirective, { now: 900 });
  assert.equal(noOp.operations.length, 0);
  assert.equal(noOp.summary.noOpDirectiveCount, 1);
  assert.deepEqual(
    applyNoteOrganizerPlan(store, noOp, noOpFacts, noOp.expectedExternalGeneration),
    store,
  );

  const facts = [
    fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Shared" }),
    fact("base-b", path, { indexEligible: true, suggestedIndexGroup: "Shared" }),
  ];
  const directives: NoteOrganizerDirective[] = facts.map((value) => ({
    baseId: value.baseId,
    path: value.path,
    primary: { mode: "index", groupTitle: "Shared" },
  }));
  const left = createNoteOrganizerPlan(store, facts, directives, { now: 901, label: "Organize shared" });
  const right = createNoteOrganizerPlan(store, [...facts].reverse(), [...directives].reverse(), { now: 901, label: "Organize shared" });
  assert.equal(canonical(left), canonical(right));
  const applied = applyNoteOrganizerPlan(store, left, facts, left.expectedExternalGeneration);
  const ownerIds = applied.bases.map((base) => Object.entries(base.data.portableIndex.resolvedPathBySubjectId)
    .find(([, resolvedPath]) => resolvedPath === path)?.[0]);
  assert.equal(ownerIds.every(Boolean), true);
  assert.notEqual(ownerIds[0], ownerIds[1], "portable identities remain safely base-local");
  assert.equal(left.summary.portableSubjectsCreated, 2);

  const reusedStore = structuredClone(applied);
  const reusePlan = createNoteOrganizerPlan(reusedStore, [facts[0]], [{
    baseId: "base-a",
    path,
    primary: { mode: "library", libraryId: "library-a", headingId: reuseLibrary.id },
  }], { now: 902 });
  assert.equal(reusePlan.diffs[0]?.portableIdentity, "reused");
  const reused = applyNoteOrganizerPlan(reusedStore, reusePlan, [facts[0]], reusePlan.expectedExternalGeneration);
  const owners = Object.values(reused.bases[0].data.portableIndex.resolvedPathBySubjectId)
    .filter((resolvedPath) => resolvedPath === path);
  assert.equal(owners.length, 1);
});

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

test("apply rejects exact-target, Sync, and file drift while preserving unrelated edits and the caller's active base", () => {
  const first = entry("base-a", "Alpha");
  const second = entry("base-b", "Beta");
  const collection = addCollection(first.data, "collection", "Cases");
  const path = "Vault/Exact.md";
  const store = storeWith([first, second], "base-a");
  const facts = [fact("base-a", path)];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    collections: { mode: "add", targets: [{ headingId: collection.id }] },
  }], { now: 1000, expectedExternalGeneration: 4 });

  const tampered = clonePlan(plan);
  tampered.summary.collectionAdds = 999;
  assert.throws(() => applyNoteOrganizerPlan(store, tampered, facts, 4), /plan changed after preview/iu);

  const stale = structuredClone(store);
  stale.bases[0].data.pinnedPaths.push("Vault/Concurrent.md");
  assert.throws(() => applyNoteOrganizerPlan(stale, plan, facts, 4), /Knowledge base .* changed/iu);

  const activeChanged = structuredClone(store);
  activeChanged.activeBaseId = "base-b";
  const switchedResult = applyNoteOrganizerPlan(activeChanged, plan, facts, 4);
  assert.equal(switchedResult.activeBaseId, "base-b");

  const unrelatedChanged = structuredClone(store);
  unrelatedChanged.bases[1].data.pinnedPaths.push("Vault/Unrelated.md");
  const unrelatedResult = applyNoteOrganizerPlan(unrelatedChanged, plan, facts, 4);
  assert.deepEqual(unrelatedResult.bases[1].data.pinnedPaths, ["Vault/Unrelated.md"]);
  assert.throws(() => applyNoteOrganizerPlan(store, plan, facts, 5), /Synced plugin data changed/iu);
  assert.throws(() => applyNoteOrganizerPlan(store, plan, [{ ...facts[0], mtime: 1001 }], 4), /selected Markdown notes changed/iu);
  assert.throws(() => applyNoteOrganizerPlan(store, plan, [{ ...facts[0], sourceKind: "procedure" }], 4), /selected Markdown notes changed/iu);

  const exact = applyNoteOrganizerPlan(store, plan, facts, 4);
  const exactBase = exact.bases.find((candidate) => candidate.id === "base-a");
  const plannedBase = plan.operations[0]?.afterEntry;
  assert.ok(exactBase);
  assert.ok(plannedBase);
  assert.equal(
    semanticEntryFingerprint(exactBase),
    semanticEntryFingerprint(plannedBase),
    "Apply must install the exact reviewed destination-base result",
  );
  assert.match(plan.expectedAfterStoreGuard, /^[0-9a-f]{16}$/u);
});

test("vault-relative paths use one NFC identity throughout preview and Apply", () => {
  const base = entry("base-a", "Alpha");
  const store = storeWith([base]);
  const decomposedPath = "Vault/Cafe\u0301.md";
  const normalizedPath = decomposedPath.normalize("NFC");
  const facts = [fact("base-a", decomposedPath, {
    indexEligible: true,
    suggestedIndexGroup: "General",
  })];
  const plan = createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path: decomposedPath,
    primary: { mode: "index", groupTitle: "General" },
  }], { now: 1_005, expectedExternalGeneration: 6 });

  assert.equal(plan.fileFacts[0]?.path, normalizedPath);
  assert.equal(plan.reviews[0]?.path, normalizedPath);
  const applied = applyNoteOrganizerPlan(store, plan, facts, 6);
  assert.deepEqual(applied.bases[0]?.data.directIndexPaths, [normalizedPath]);
});

test("invalid files, archived or missing destinations, duplicate identities, and ambiguous layout nodes fail closed", () => {
  const base = entry("base-a", "Alpha");
  const library = addLibrary(base.data, "library-a", "Library A");
  addLibrary(base.data, "archived", "Archived", null, 99);
  const collection = addCollection(base.data, "collection", "Cases");
  const path = "Vault/Unsafe.md";
  const store = storeWith([base]);
  const valid = fact("base-a", path, { indexEligible: true });

  assert.throws(() => createNoteOrganizerPlan(store, [{ ...valid, exists: false }], [{ baseId: "base-a", path }]), /not an existing eligible/iu);
  assert.throws(() => createNoteOrganizerPlan(store, [{ ...valid, path: "Vault/Unsafe.txt" }], [{ baseId: "base-a", path: "Vault/Unsafe.txt" }]), /Markdown note/iu);
  assert.throws(() => createNoteOrganizerPlan(store, [{ ...valid, path: "05 Sources/_books/Unsafe.md" }], [{ baseId: "base-a", path: "05 Sources/_books/Unsafe.md" }]), /immutable source-book/iu);
  assert.throws(() => createNoteOrganizerPlan(store, [valid], [{
    baseId: "base-a", path, primary: { mode: "library", libraryId: "archived" },
  }]), /is archived/iu);
  assert.throws(() => createNoteOrganizerPlan(store, [valid], [{
    baseId: "base-a", path, primary: { mode: "library", libraryId: "library-a", headingId: "missing" },
  }]), /no longer available/iu);
  assert.throws(() => createNoteOrganizerPlan(store, [valid], [{
    baseId: "base-a", path, collections: { mode: "add", targets: [{ headingId: "missing" }] },
  }]), /no longer available/iu);

  const duplicateHeadingStore = structuredClone(store);
  duplicateHeadingStore.bases[0].data.collections.push({ ...structuredClone(collection), title: "Duplicate" });
  duplicateHeadingStore.bases[0].semanticHash = semanticEntryFingerprint(duplicateHeadingStore.bases[0]);
  duplicateHeadingStore.bases[0].semanticHead = duplicateHeadingStore.bases[0].semanticHash;
  assert.throws(() => createNoteOrganizerPlan(duplicateHeadingStore, [valid], [{
    baseId: "base-a", path, collections: { mode: "add", targets: [{ headingId: collection.id }] },
  }]), /ambiguous/iu);

  const duplicateOwnerStore = structuredClone(store);
  const duplicateData = duplicateOwnerStore.bases[0].data;
  addSubject(duplicateData, path, { id: "subject-one", indexed: false });
  addSubject(duplicateData, path, { id: "subject-two", indexed: false });
  duplicateOwnerStore.bases[0].semanticHash = semanticEntryFingerprint(duplicateOwnerStore.bases[0]);
  duplicateOwnerStore.bases[0].semanticHead = duplicateOwnerStore.bases[0].semanticHash;
  assert.throws(() => createNoteOrganizerPlan(duplicateOwnerStore, [valid], [{
    baseId: "base-a", path, primary: { mode: "index", groupTitle: "Topics" },
  }]), /more than one portable identity/iu);

  assert.equal(library.id, "library-a-heading");
});

test("a required portable Undo that cannot fit fails before producing any candidate", () => {
  const base = entry("base-a", "Alpha");
  const collection = addCollection(base.data, "collection", "Cases");
  // Every individual value stays below the persisted text limit; their valid
  // aggregate still cannot fit one required portable Undo snapshot.
  for (let index = 0; index < 1_400; index += 1) {
    base.data.displayNameByPath[`Vault/Large-${index}.md`] = "x".repeat(9_500);
  }
  const store = storeWith([base]);
  const path = "Vault/Small.md";
  const facts = [fact("base-a", path)];
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    collections: { mode: "add", targets: [{ headingId: collection.id }] },
  }], { now: 1100 }), /too large for required in-plugin Undo/iu);
});

test("an Organizer result cannot cross the persisted authoritative-list limit", () => {
  const base = entry("base-a", "Alpha");
  base.data.directIndexPaths = Array.from(
    { length: MAX_TRANSFER_LIST_ITEMS },
    (_value, index) => `Existing/Note-${index}.md`,
  );
  const store = storeWith([base]);
  const path = "Vault/One-too-many.md";
  const facts = [fact("base-a", path, { indexEligible: true, suggestedIndexGroup: "Topics" })];
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    primary: { mode: "index", groupTitle: "Topics" },
  }], { now: 1200 }), /too many direct Index paths/iu);
});

test("an Organizer result cannot cross the loader's store-wide reference envelope", () => {
  const first = entry("base-a", "Alpha");
  const second = entry("base-b", "Beta");
  const values = (prefix: string): string[] => Array.from(
    { length: MAX_TRANSFER_LIST_ITEMS },
    (_value, index) => `${prefix}/${index}.md`,
  );
  first.data.directIndexPaths = values("A/direct");
  first.data.pinnedPaths = values("A/pin");
  second.data.nextStudyPaths = values("B/next");
  second.data.excludedIndexPaths = values("B/hidden");
  second.data.collapsed.curriculumDomains = values("B/collapsed");
  const collection = addCollection(first.data, "collection", "Cases");
  const store = storeWith([first, second]);
  const path = "Vault/One-too-many-globally.md";
  const facts = [fact("base-a", path)];
  assert.throws(() => createNoteOrganizerPlan(store, facts, [{
    baseId: "base-a",
    path,
    collections: { mode: "add", targets: [{ headingId: collection.id }] },
  }], { now: 1250 }), /safely loadable.*250,000 references/iu);
});
