import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNoteOrganizerContextMenuDescriptor,
  createNoteOrganizerIndicatorController,
  normalizeNoteOrganizerSelection,
  normalizeNoteOrganizerVaultPath,
  parseNoteOrganizerDrop,
  summarizeNoteOrganizerMembership,
  type NoteOrganizerBaseProjection,
  type NoteOrganizerDataTransferLike,
  type NoteOrganizerIndicatorModel,
} from "../src/note-organizer-surfaces";
import {
  DEFAULT_DATA,
  cloneJsonValue,
  replacePathPrefix,
  type PluginData,
  type VaultRecord,
} from "../src/model";

function projectedRecord(path: string, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path,
    title: path.split("/").pop()?.replace(/\.md$/u, "") ?? path,
    kind: "topic",
    role: "canonical",
    curriculumId: "",
    domain: "General",
    topicKind: "condition",
    priority: "",
    reviewStatus: "",
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
    folderOrder: "",
    mtime: 0,
    aiLock: false,
    ...overrides,
  };
}

function base(baseId: string, name: string, configure?: (data: PluginData) => void): NoteOrganizerBaseProjection {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.settings.workspaceName = name;
  data.settings.workspaceMode = "generic";
  data.indexFolderSources = [];
  configure?.(data);
  return { baseId, name, data };
}

test("membership summary separates current placement, other bases, collections, and provenance", () => {
  const path = "Notes/Laryngomalacia.md";
  const current = base("current", "ENT", (data) => {
    data.directIndexPaths = [path];
    data.indexFolderSources = [{ id: "notes", path: "Notes", origin: "user" }];
    data.collections = [{
      id: "airway", title: "Airway", collapsed: false, subjects: [],
      subheadings: [{ id: "congenital", title: "Congenital", collapsed: false, subjects: [path] }],
    }];
  });
  current.record = projectedRecord(path);
  const other = base("other", "Reading", (data) => {
    data.collections = [{ id: "later", title: "Read later", collapsed: false, subjects: [path], subheadings: [] }];
  });
  const summary = summarizeNoteOrganizerMembership(path, [other, current], "current");
  assert.equal(summary.currentBase?.primary.kind, "index");
  assert.deepEqual(summary.currentBase?.collectionTitles, ["Airway"]);
  assert.deepEqual(summary.currentBase?.provenance, ["direct", "linked-folder"]);
  assert.equal(summary.currentBaseCollectionOnly, false);
  assert.equal(summary.currentBaseHasPrimary, true);
  assert.equal(summary.otherBaseCount, 1);
  assert.equal(summary.totalBaseCount, 2);
  assert.equal(summary.collectionOnlyBaseCount, 1);
  assert.equal(summary.indicator.state, "organized-current");
  assert.equal(summary.indicator.color, "success");
  assert.match(summary.indicator.ariaLabel, /Activate to review or change memberships/u);
});

test("collection-only membership is explicit and still counts as organized", () => {
  const path = "Notes/Collection only.md";
  const current = base("current", "ENT", (data) => {
    data.collections = [{ id: "queue", title: "Review", collapsed: false, subjects: [path], subheadings: [] }];
  });
  const summary = summarizeNoteOrganizerMembership(path, [current], "current");
  assert.equal(summary.currentBase?.primary.kind, "none");
  assert.equal(summary.currentBaseCollectionOnly, true);
  assert.equal(summary.currentBaseOrganized, true);
  assert.equal(summary.indicator.state, "collection-only-current");
  assert.equal(summary.indicator.icon, "folder-check");
});

test("organization in another base is accent state while ordinary absence stays neutral", () => {
  const path = "Notes/Elsewhere.md";
  const current = base("current", "Current");
  const other = base("other", "Other", (data) => { data.directIndexPaths = [path]; });
  const elsewhere = summarizeNoteOrganizerMembership(path, [current, other], "current");
  assert.equal(elsewhere.currentBaseOrganized, false);
  assert.equal(elsewhere.otherBaseCount, 1);
  assert.equal(elsewhere.indicator.state, "organized-other");
  assert.equal(elsewhere.indicator.color, "accent");

  const absent = summarizeNoteOrganizerMembership("Notes/New.md", [current, other], "current");
  assert.equal(absent.totalBaseCount, 0);
  assert.equal(absent.brokenBaseCount, 0);
  assert.equal(absent.indicator.state, "not-organized");
  assert.equal(absent.indicator.color, "muted");
  assert.match(absent.indicator.tooltip, /folder location alone does not add it/iu);
});

test("membership summaries project ordered pending vault renames across every membership source", () => {
  const oldFolder = "Notes";
  const intermediateFolder = "Staging";
  const currentFolder = "Archive";
  const oldPath = "Notes/Before.md";
  const currentPath = "Archive/Before.md";
  const current = base("current", "Current", (data) => {
    data.directIndexPaths = [oldPath];
    data.indexFolderSources = [{ id: "notes", path: "Notes", origin: "user" }];
    data.collections = [{
      id: "rename-review",
      title: "Rename review",
      collapsed: false,
      subjects: [oldPath],
      subheadings: [],
    }];
  });
  current.record = projectedRecord(currentPath);
  const portable = base("portable", "Portable", (data) => {
    data.portableIndex.libraries = [{
      id: "reading",
      name: "Reading",
      singularName: "Reading note",
      icon: "book-open",
      order: 0,
      sourceKind: null,
      archivedAt: null,
    }];
    data.portableIndex.subjects = [{
      id: "subject-before",
      title: "Before",
      groupId: "",
      parentId: null,
      order: 0,
      indexed: false,
      configuredId: "",
      recordKind: "topic",
      libraryId: "reading",
    }];
    data.portableIndex.resolvedPathBySubjectId = { "subject-before": oldPath };
  });
  const hidden = base("hidden", "Hidden", (data) => {
    data.excludedIndexPaths = [oldPath];
  });
  const renames = [
    { oldPath: oldFolder, newPath: intermediateFolder },
    { oldPath: intermediateFolder, newPath: currentFolder },
  ];
  const projectPath = (storedPath: string): string => renames.reduce(
    (projected, rename) => replacePathPrefix(projected, rename.oldPath, rename.newPath),
    storedPath,
  );

  const summary = summarizeNoteOrganizerMembership(currentPath, [hidden, portable, current], "current", { projectPath });

  assert.equal(summary.currentBase?.primary.kind, "index");
  assert.deepEqual(summary.currentBase?.collectionTitles, ["Rename review"]);
  assert.deepEqual(summary.currentBase?.provenance, ["direct", "linked-folder"]);
  assert.deepEqual(summary.currentBase?.linkedSourcePaths, [currentFolder]);
  const portableMembership = summary.bases.find((membership) => membership.baseId === "portable");
  assert.equal(portableMembership?.primary.kind, "library");
  assert.deepEqual(portableMembership?.portableSubjectIds, ["subject-before"]);
  assert.deepEqual(portableMembership?.provenance, ["portable"]);
  assert.equal(summary.bases.find((membership) => membership.baseId === "hidden")?.hidden, true);
  assert.equal(summary.currentBaseOrganized, true);
  assert.equal(summary.otherBaseCount, 1);
  assert.equal(summary.totalBaseCount, 2);
  assert.equal(summary.brokenBaseCount, 0);
  assert.equal(summary.indicator.state, "organized-current");
});

test("broken portable ownership and conflicting primary placement reserve the danger state", () => {
  const path = "Notes/Conflict.md";
  const current = base("current", "Current", (data) => {
    data.directIndexPaths = [path];
    data.excludedIndexPaths = [path];
    data.portableIndex.libraries = [{
      id: "reading", name: "Reading", singularName: "Reading item", icon: "book-open", order: 0,
      sourceKind: null, archivedAt: null,
    }];
    data.portableIndex.subjects = [{
      id: "one", title: "One", groupId: "", parentId: null, order: 0, indexed: false,
      configuredId: "", recordKind: "topic", libraryId: "reading",
    }];
    data.portableIndex.resolvedPathBySubjectId = { one: path, missing: path };
  });
  current.record = projectedRecord(path, { portableId: "one", libraryId: "reading", portableIndexed: false });
  const summary = summarizeNoteOrganizerMembership(path, [current], "current");
  assert.equal(summary.currentBase?.primary.kind, "conflict");
  assert.deepEqual(summary.currentBase?.issues.map((issue) => issue.kind), [
    "duplicate-portable-owner",
    "missing-portable-subject",
    "direct-and-hidden",
    "conflicting-primary-placement",
  ]);
  assert.equal(summary.brokenBaseCount, 1);
  assert.equal(summary.indicator.state, "broken");
  assert.equal(summary.indicator.color, "danger");
});

test("only persisted references to an unavailable path are marked missing", () => {
  const path = "Deleted/Missing.md";
  const referenced = base("referenced", "Referenced", (data) => { data.directIndexPaths = [path]; });
  const empty = base("empty", "Empty");
  const summary = summarizeNoteOrganizerMembership(path, [referenced, empty], "empty", { pathExists: false });
  assert.equal(summary.bases.find((item) => item.baseId === "referenced")?.issues[0]?.kind, "missing-note");
  assert.equal(summary.bases.find((item) => item.baseId === "empty")?.broken, false);
});

test("selection normalization expands folders once and does not report included overlaps as skipped duplicates", () => {
  const snapshot = normalizeNoteOrganizerSelection(
    [
      { path: "Knowledge", kind: "folder" },
      { path: "Knowledge/A.md", kind: "file" },
      { path: "Loose.md", kind: "file" },
      { path: "image.png", kind: "file" },
    ],
    [
      { path: "Knowledge/B.md" },
      { path: "Knowledge/A.md" },
      { path: "Knowledge/Private.md" },
      { path: "Loose.md" },
      { path: "Knowledge/image.png" },
    ],
    { isRestrictedPath: (path) => path.endsWith("Private.md") },
  );
  assert.deepEqual(snapshot.paths, ["Knowledge/A.md", "Knowledge/B.md", "Loose.md"]);
  assert.equal(snapshot.kind, "mixed-snapshot");
  assert.equal(snapshot.folderSnapshot, true);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.skips.nonMarkdown, 1);
  assert.equal(snapshot.skips.restricted, 1);
  assert.equal(snapshot.skips.duplicate, 0);

  const laterVault = [
    { path: "Knowledge/A.md" }, { path: "Knowledge/B.md" }, { path: "Knowledge/New later.md" }, { path: "Loose.md" },
  ];
  assert.equal(laterVault.length, 4);
  assert.deepEqual(snapshot.paths, ["Knowledge/A.md", "Knowledge/B.md", "Loose.md"], "the prior snapshot does not become a live folder rule");

  const repeatedInput = normalizeNoteOrganizerSelection(
    [{ path: "Loose.md", kind: "file" }, { path: "Loose.md", kind: "file" }],
    [{ path: "Loose.md" }],
    { isRestrictedPath: () => false },
  );
  assert.deepEqual(repeatedInput.paths, ["Loose.md"]);
  assert.equal(repeatedInput.skips.duplicate, 1, "only an input that is actually discarded is counted as duplicate");
});

test("selection bounds fail closed and advanced selection may explicitly include restricted notes", () => {
  const inventory = [{ path: "A.md" }, { path: "B.md" }];
  const limited = normalizeNoteOrganizerSelection(
    [{ path: "", kind: "folder" }],
    inventory,
    { isRestrictedPath: () => false, maxPaths: 1 },
  );
  assert.deepEqual(limited.paths, []);
  assert.equal(limited.complete, false);
  assert.equal(limited.blockedReason, "selection-limit");

  const advanced = normalizeNoteOrganizerSelection(
    [{ path: "A.md", kind: "file" }],
    inventory,
    { isRestrictedPath: () => true, includeRestricted: true },
  );
  assert.deepEqual(advanced.paths, ["A.md"]);
  assert.equal(advanced.skips.restricted, 0);
});

test("vault path normalization rejects traversal and filesystem paths", () => {
  assert.equal(normalizeNoteOrganizerVaultPath("Folder\\Note.md"), "Folder/Note.md");
  assert.equal(normalizeNoteOrganizerVaultPath("Folder/../Note.md"), null);
  assert.equal(normalizeNoteOrganizerVaultPath("/Users/person/Note.md"), null);
  assert.equal(normalizeNoteOrganizerVaultPath("C:\\Users\\person\\Note.md"), null);
});

function transfer(payloads: Record<string, string>, files = 0): NoteOrganizerDataTransferLike {
  return {
    types: [...Object.keys(payloads), ...(files > 0 ? ["Files"] : [])],
    files: { length: files },
    getData: (type) => payloads[type] ?? "",
  };
}

test("drop parsing accepts only reviewable vault-path strings and Obsidian links", () => {
  const result = parseNoteOrganizerDrop(transfer({
    "text/plain": [
      "Notes/Plain.md",
      "[[Knowledge/Wiki note|Display]]",
      "obsidian://open?file=Inbox%2FCurrent%20vault%20URI",
      "obsidian://open?vault=My%20Vault&file=Inbox%2FURI%20note",
      "obsidian://advanced-uri?file=Inbox%2FPrivate-command",
      "file:///Users/person/Desktop/Outside.md",
      "https://example.com/Remote.md",
      "[[https://example.com/Wiki.md]]",
      "../Traversal.md",
    ].join("\n"),
    "text/html": "<a href='file:///Outside.md'>Outside</a>",
  }));
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.acceptedMimeTypes, ["text/plain"]);
  assert.deepEqual(result.rejectedReasons, ["unsafe-path"]);
  assert.equal(result.complete, false);
  assert.equal(result.blocked, true);

  const safe = parseNoteOrganizerDrop(transfer({
    "text/plain": [
      "Notes/Plain.md",
      "[[Knowledge/Wiki note|Display]]",
      "obsidian://open?file=Inbox%2FCurrent%20vault%20URI",
    ].join("\n"),
  }));
  assert.deepEqual(safe.paths, ["Inbox/Current vault URI.md", "Knowledge/Wiki note.md", "Notes/Plain.md"]);
  assert.deepEqual(safe.rejectedReasons, []);
  assert.equal(safe.blocked, false);
});

test("drop parsing blocks OS file objects, oversized payloads, and path overflow", () => {
  const files = parseNoteOrganizerDrop(transfer({ "text/plain": "Notes/A.md" }, 1));
  assert.equal(files.blocked, true);
  assert.deepEqual(files.paths, []);
  assert.deepEqual(files.rejectedReasons, ["filesystem-payload"]);

  const oversized = parseNoteOrganizerDrop(transfer({ "text/plain": "Notes/Too long.md" }), { maxTextLength: 4 });
  assert.equal(oversized.blocked, true);
  assert.deepEqual(oversized.rejectedReasons, ["oversized-payload"]);

  const overflow = parseNoteOrganizerDrop(transfer({ "text/plain": "A.md\nB.md" }), { maxPaths: 1 });
  assert.equal(overflow.blocked, true);
  assert.deepEqual(overflow.paths, []);
  assert.deepEqual(overflow.rejectedReasons, ["path-limit"]);
});

test("context menu labels distinguish a note, multiple notes, and folder snapshots", () => {
  const single = normalizeNoteOrganizerSelection(
    [{ path: "A.md", kind: "file" }], [{ path: "A.md" }], { isRestrictedPath: () => false },
  );
  const singleMenu = buildNoteOrganizerContextMenuDescriptor(single);
  assert.deepEqual(singleMenu.actions.map((action) => action.id), ["organize", "show-memberships"]);
  assert.equal(singleMenu.actions[0]?.title, "Organize in KBCC…");
  assert.match(singleMenu.actions[0]?.ariaLabel ?? "", /Markdown files will not move or change/u);

  const multiple = normalizeNoteOrganizerSelection(
    [{ path: "A.md", kind: "file" }, { path: "B.md", kind: "file" }],
    [{ path: "A.md" }, { path: "B.md" }],
    { isRestrictedPath: () => false },
  );
  assert.equal(buildNoteOrganizerContextMenuDescriptor(multiple).actions[0]?.title, "Organize 2 notes in KBCC…");

  const folder = normalizeNoteOrganizerSelection(
    [{ path: "Folder", kind: "folder" }],
    [{ path: "Folder/A.md" }, { path: "Folder/B.md" }],
    { isRestrictedPath: () => false },
  );
  assert.equal(buildNoteOrganizerContextMenuDescriptor(folder).actions[0]?.title, "Organize 2 current Markdown notes in KBCC…");
});

test("indicator controller keeps editor/status host ownership outside the projection", () => {
  const shown: NoteOrganizerIndicatorModel[] = [];
  let removals = 0;
  let activations = 0;
  let activate: (() => void) | null = null;
  const controller = createNoteOrganizerIndicatorController({
    show(model, onActivate): void {
      shown.push({ ...model, classNames: [...model.classNames] });
      activate = onActivate;
    },
    remove(): void { removals += 1; },
  }, () => { activations += 1; });
  const summary = summarizeNoteOrganizerMembership("A.md", [base("current", "Current")], "current");
  controller.update(summary);
  assert.equal(shown[0]?.state, "not-organized");
  if (activate) activate();
  assert.equal(activations, 1);
  controller.update(null);
  controller.destroy();
  controller.update(summary);
  assert.equal(removals, 2);
  assert.equal(shown.length, 1);
});
