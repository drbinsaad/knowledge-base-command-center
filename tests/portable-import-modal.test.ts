import assert from "node:assert/strict";
import test from "node:test";
import { Notice, Setting } from "obsidian";
import {
  canonicalJsonString,
  cloneJsonValue,
  DEFAULT_DATA,
  ENT_CLINICAL_SETTINGS,
  type VaultRecord,
} from "../src/model";
import { LARGE_PLACEHOLDER_IMPORT_THRESHOLD } from "../src/portable-import-preview";
import { ExportImportCenterModal } from "../src/portability-modal";
import { createPortableExport, EMPTY_PORTABLE_SELECTION } from "../src/portability";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

interface CapturedButton {
  label: string;
  disabled: boolean;
  click: (() => void) | null;
}

function withSettingButtons<T>(run: (buttons: CapturedButton[]) => T): T {
  const prototype = Setting.prototype as unknown as Record<string, unknown>;
  const prior = Object.getOwnPropertyDescriptor(Setting.prototype, "addButton");
  const buttons: CapturedButton[] = [];
  prototype.addButton = function addButton(this: unknown, configure: (button: {
    setButtonText(value: string): unknown;
    setIcon(value: string): unknown;
    setDisabled(value: boolean): unknown;
    setCta(): unknown;
    onClick(value: () => void): unknown;
  }) => void): unknown {
    const captured: CapturedButton = { label: "", disabled: false, click: null };
    const component = {
      setButtonText(value: string): typeof component { captured.label = value; return component; },
      setIcon(): typeof component { return component; },
      setDisabled(value: boolean): typeof component { captured.disabled = value; return component; },
      setCta(): typeof component { return component; },
      onClick(value: () => void): typeof component { captured.click = value; return component; },
    };
    configure(component);
    buttons.push(captured);
    return this;
  };
  try {
    return run(buttons);
  } finally {
    if (prior) Object.defineProperty(Setting.prototype, "addButton", prior);
    else Reflect.deleteProperty(prototype, "addButton");
  }
}

test("post-import handoff reports the queue and refuses to undo a newer operation", async () => {
  const dom = createFakeDom();
  const content = asHtmlElement(dom.document.body.createDiv());
  const importedUndo = { label: "Merge Command Center portable export", directIndexPaths: ["Before.md"] };
  const newerUndo = { label: "Pin another note", pinnedPaths: ["Other.md"] };
  let undoCalls = 0;
  let pending: Promise<void> = Promise.resolve();
  const center = Object.create(ExportImportCenterModal.prototype) as unknown as {
    contentEl: HTMLElement;
    panelEl: HTMLElement | null;
    plugin: { data: { undoStack: unknown[] }; undo(): Promise<void>; openPlaceholderResolutionQueue(): void };
    busyAction: null;
    completedImportUndoToken: string;
    guardOpenedBase(): boolean;
    run(kind: string, action: () => Promise<void>): void;
    renderCompletedImport(value: {
      subjectCatalogImported: boolean;
      addedSubjects: number;
      matchedSubjects: number;
      unresolvedSubjects: number;
      totalPlaceholders: number;
      exactCandidatePlaceholders: number;
    }): void;
  };
  center.contentEl = content;
  center.panelEl = null;
  center.busyAction = null;
  center.completedImportUndoToken = canonicalJsonString(importedUndo);
  center.guardOpenedBase = () => true;
  center.run = (_kind, action) => { pending = action(); };
  center.plugin = {
    data: { undoStack: [newerUndo] },
    async undo(): Promise<void> { undoCalls += 1; },
    openPlaceholderResolutionQueue(): void {},
  };

  await withSettingButtons(async (buttons) => {
    center.renderCompletedImport({
      subjectCatalogImported: true,
      addedSubjects: 3,
      matchedSubjects: 2,
      unresolvedSubjects: 1,
      totalPlaceholders: 7,
      exactCandidatePlaceholders: 4,
    });
    assert.match(content.textContent, /3 new subjects/u);
    assert.match(content.textContent, /7 unresolved placeholders/u);
    assert.deepEqual(buttons.map((button) => button.label), ["Undo import", "Open placeholder queue", "Close"]);

    Notice.messages.length = 0;
    buttons[0]?.click?.();
    await pending;
    assert.equal(undoCalls, 0);
    assert.match(Notice.messages.at(-1) ?? "", /Undo history changed after this import/u);

    center.plugin.data.undoStack = [importedUndo];
    buttons[0]?.click?.();
    await pending;
    assert.equal(undoCalls, 1);
  });
});

test("import refuses when the reviewed outcome changed before the transaction", async () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.portableIndex.groups = [{ id: "group", title: "Imported", order: 0 }];
  source.portableIndex.subjects = [{
    id: "subject", title: "Subject", groupId: "group", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  source.directIndexPaths = ["kbcc-placeholder:subject"];
  const selection = { ...EMPTY_PORTABLE_SELECTION, index: true };
  const value = createPortableExport(source, [], selection, "2026-08-14T00:00:00.000Z");
  const destination = cloneJsonValue(DEFAULT_DATA);
  let mutations = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as unknown as {
    app: unknown;
    plugin: unknown;
    importValue: typeof value;
    importSelection: typeof selection;
    importMode: "merge";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    largePlaceholderImportConfirmed: boolean;
    reviewedImportOutcomeToken: string;
    openedBaseId: string;
    importSelected(): Promise<void>;
  };
  center.app = {};
  center.plugin = {
    data: destination,
    isDataReadOnly: () => false,
    getRecords: (): VaultRecord[] => [],
    mutate: async (): Promise<void> => { mutations += 1; },
  };
  center.importValue = value;
  center.importSelection = selection;
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.largePlaceholderImportConfirmed = false;
  center.reviewedImportOutcomeToken = "stale-reviewed-outcome";
  center.openedBaseId = "";

  await assert.rejects(center.importSelected(), /destination changed after the predicted outcome was reviewed/i);
  assert.equal(mutations, 0);
});

test("combined Workspace and Index cannot bypass the 100-placeholder confirmation with stale records", async () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  source.portableIndex.groups = [{ id: "pediatric", title: "Pediatric", order: 0 }];
  source.portableIndex.subjects = Array.from({ length: LARGE_PLACEHOLDER_IMPORT_THRESHOLD }, (_, index) => ({
    id: `subject-${index}`,
    title: `Subject ${index}`,
    groupId: "pediatric",
    parentId: null,
    order: index,
    indexed: true,
    configuredId: `ENT-PED-${String(index).padStart(3, "0")}`,
    recordKind: "topic" as const,
    libraryId: null,
  }));
  source.directIndexPaths = source.portableIndex.subjects.map((subject) => `kbcc-placeholder:${subject.id}`);
  const selection = { ...EMPTY_PORTABLE_SELECTION, workspace: true, index: true };
  const value = createPortableExport(source, [], selection, "2026-08-14T00:00:00.000Z");

  const destination = cloneJsonValue(DEFAULT_DATA);
  destination.settings = cloneJsonValue(ENT_CLINICAL_SETTINGS);
  destination.settings.idProperty = "alternate_id";
  const staleMatchingRecords: VaultRecord[] = source.portableIndex.subjects.map((subject, index) => ({
    path: `03 Clinical Topics/01 Pediatric/Subject ${index}.md`,
    title: subject.title,
    kind: "topic",
    role: "canonical",
    curriculumId: subject.configuredId,
    domain: "Pediatric",
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
  }));
  let mutations = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as unknown as {
    app: unknown;
    plugin: unknown;
    importValue: typeof value;
    importSelection: typeof selection;
    importMode: "merge";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    largePlaceholderImportConfirmed: boolean;
    reviewedImportOutcomeToken: string;
    openedBaseId: string;
    importSelected(): Promise<void>;
  };
  center.app = {};
  center.plugin = {
    data: destination,
    isDataReadOnly: () => false,
    getRecords: () => staleMatchingRecords,
    mutate: async (): Promise<void> => { mutations += 1; },
  };
  center.importValue = value;
  center.importSelection = selection;
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.largePlaceholderImportConfirmed = false;
  center.reviewedImportOutcomeToken = "";
  center.openedBaseId = "";

  await assert.rejects(
    center.importSelected(),
    /Import Workspace settings by themselves first.*reopen.*import the Index/iu,
  );
  assert.equal(mutations, 0);
});

test("a committed Workspace-only import skips the unrelated placeholder queue scan", async () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.settings.indexLabel = "Imported Index Label";
  const selection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  const value = createPortableExport(source, [], selection, "2026-08-14T00:00:00.000Z");
  const destination = cloneJsonValue(DEFAULT_DATA);
  let recordScans = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as unknown as {
    app: unknown;
    plugin: unknown;
    importValue: typeof value;
    importSelection: typeof selection;
    importMode: "merge";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    largePlaceholderImportConfirmed: boolean;
    reviewedImportOutcomeToken: string;
    openedBaseId: string;
    completedImport: { subjectCatalogImported: boolean; placeholderSummaryAvailable: boolean } | null;
    importSelected(): Promise<void>;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = {
    data: destination,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-workspace-only",
    getActiveKnowledgeBaseId: () => "base-default",
    getRecords: () => {
      recordScans += 1;
      throw new Error("Workspace-only completion must not scan records");
    },
    invalidateRecordCache: () => {},
    assertClinicalIndexEligibility: () => {},
    mutate: async (_label: string, action: () => void): Promise<void> => { action(); },
  };
  center.importValue = value;
  center.importSelection = selection;
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.largePlaceholderImportConfirmed = false;
  center.reviewedImportOutcomeToken = "";
  center.openedBaseId = "";

  await center.importSelected();

  assert.equal(destination.settings.indexLabel, "Imported Index Label");
  assert.equal(recordScans, 0);
  assert.equal(center.completedImport?.subjectCatalogImported, false);
  assert.equal(center.completedImport?.placeholderSummaryAvailable, false);
});

test("post-commit placeholder projection failure cannot turn a saved catalog import into failure", async () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.portableIndex.groups = [{ id: "group", title: "Imported", order: 0 }];
  source.portableIndex.subjects = [{
    id: "subject", title: "Subject", groupId: "group", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  source.directIndexPaths = ["kbcc-placeholder:subject"];
  const selection = { ...EMPTY_PORTABLE_SELECTION, index: true };
  const value = createPortableExport(source, [], selection, "2026-08-14T00:00:00.000Z");
  const destination = cloneJsonValue(DEFAULT_DATA);
  let recordScans = 0;
  const center = Object.create(ExportImportCenterModal.prototype) as unknown as {
    app: unknown;
    plugin: unknown;
    importValue: typeof value;
    importSelection: typeof selection;
    importMode: "merge";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    largePlaceholderImportConfirmed: boolean;
    reviewedImportOutcomeToken: string;
    openedBaseId: string;
    completedImport: { subjectCatalogImported: boolean; placeholderSummaryAvailable: boolean } | null;
    importSelected(): Promise<void>;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = {
    data: destination,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-catalog-completion",
    getActiveKnowledgeBaseId: () => "base-default",
    getRecords: (): VaultRecord[] => {
      recordScans += 1;
      if (recordScans >= 3) throw new Error("simulated post-commit projection failure");
      return [];
    },
    invalidateRecordCache: () => {},
    assertClinicalIndexEligibility: () => {},
    mutate: async (_label: string, action: () => void): Promise<void> => { action(); },
  };
  center.importValue = value;
  center.importSelection = selection;
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.largePlaceholderImportConfirmed = false;
  center.reviewedImportOutcomeToken = "";
  center.openedBaseId = "";
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]): void => { logged.push(values); };
  try {
    await center.importSelected();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(recordScans, 3);
  assert.ok(destination.portableIndex.subjects.some((subject) => subject.id === "subject"));
  assert.equal(center.completedImport?.subjectCatalogImported, true);
  assert.equal(center.completedImport?.placeholderSummaryAvailable, false);
  assert.ok(logged.some((values) => String(values[0]).includes("saved the portable import")));
});

test("post-commit Undo-token failure leaves the saved import successful", async () => {
  const source = cloneJsonValue(DEFAULT_DATA);
  source.settings.indexLabel = "Imported despite token failure";
  const selection = { ...EMPTY_PORTABLE_SELECTION, workspace: true };
  const value = createPortableExport(source, [], selection, "2026-08-14T00:00:00.000Z");
  const destination = cloneJsonValue(DEFAULT_DATA);
  const circularUndo = { label: "Imported Workspace", self: null as unknown };
  circularUndo.self = circularUndo;
  const center = Object.create(ExportImportCenterModal.prototype) as unknown as {
    app: unknown;
    plugin: unknown;
    importValue: typeof value;
    importSelection: typeof selection;
    importMode: "merge";
    recoveryConfirmed: boolean;
    crossBaseRecoveryConfirmed: boolean;
    largePlaceholderImportConfirmed: boolean;
    reviewedImportOutcomeToken: string;
    openedBaseId: string;
    completedImportUndoToken: string | null;
    importSelected(): Promise<void>;
  };
  center.app = { vault: { configDir: ".obsidian", getAbstractFileByPath: () => null } };
  center.plugin = {
    data: destination,
    isDataReadOnly: () => false,
    getVaultId: () => "vault-token-completion",
    getActiveKnowledgeBaseId: () => "base-default",
    getRecords: () => { throw new Error("Workspace-only completion must not scan records"); },
    invalidateRecordCache: () => {},
    assertClinicalIndexEligibility: () => {},
    mutate: async (_label: string, action: () => void): Promise<void> => {
      action();
      destination.undoStack = [circularUndo as never];
    },
  };
  center.importValue = value;
  center.importSelection = selection;
  center.importMode = "merge";
  center.recoveryConfirmed = false;
  center.crossBaseRecoveryConfirmed = false;
  center.largePlaceholderImportConfirmed = false;
  center.reviewedImportOutcomeToken = "";
  center.openedBaseId = "";
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await center.importSelected();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(destination.settings.indexLabel, "Imported despite token failure");
  assert.equal(center.completedImportUndoToken, null);
});
