import assert from "node:assert/strict";
import test from "node:test";
import { Modal, TFile, TFolder } from "./support/obsidian-stub.ts";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { createDefaultStore, migrateData, type PluginSettings } from "../src/model.ts";
import { SetupReviewOutdatedError, WorkspaceSetupModal, type WorkspaceSetupValue } from "../src/modals.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";
import { recordSettings, type RecordedRow } from "./support/setting-recorder.ts";

/**
 * WF-01 setup Inbox-change review (UI; main hook pending).
 * The review step, the Cancel/Back contract and the Sync hint are the real
 * production modal. The count is the real countOrphanedByProposalFolderChange.
 * The guarded required-Undo settings transaction in main.ts is NOT wired yet;
 * tests that need it are named accordingly and use an explicit stub commit.
 */

const HINT = "Already using this knowledge base on another device? Let Sync finish before setting it up here.";

interface ModalInternals {
  value: WorkspaceSetupValue;
  submit(): Promise<void>;
}

/** Support-Plugin fields the Obsidian stub adds to the production class. */
interface PluginSeam {
  loadedData: unknown;
  savedData: unknown[];
}

/** Shapes the review source the modal asks for; tests use the real plugin or a counted stub. */
interface ReviewSourceShape {
  currentInboxFolder(): string;
  countInboxOnlyAffected(nextFolder: string): number;
}

function openSetupModal(
  settings: PluginSettings,
  onSubmit: (value: WorkspaceSetupValue, reviewed: unknown) => void | Promise<void>,
  review?: ReviewSourceShape,
) {
  const dom = createFakeDom();
  const recorder = recordSettings();
  const root = dom.document.body.createDiv();
  const content = root.createDiv();
  const title = root.createEl("h2");
  const ModalCtor = WorkspaceSetupModal as unknown as new (app: unknown, settings: PluginSettings, onSubmit: unknown, review?: ReviewSourceShape) => WorkspaceSetupModal;
  const modal = new ModalCtor({ vault: { getAbstractFileByPath: () => null } }, settings, onSubmit, review);
  // The production close() override is exercised for real; only the host
  // Modal.close (the actual dismissal) is counted.
  let closes = 0;
  const originalClose = Object.getOwnPropertyDescriptor(Modal.prototype, "close");
  Modal.prototype.close = function (): void { closes += 1; };
  Object.assign(modal, {
    modalEl: asHtmlElement(root),
    contentEl: asHtmlElement(content),
    titleEl: asHtmlElement(title),
  });
  modal.onOpen();
  const internals = modal as unknown as ModalInternals;
  const row = (name: string): RecordedRow => {
    const found = [...recorder.rows].reverse().find((candidate) => candidate.name === name);
    assert.ok(found, `row ${name}`);
    return found;
  };
  return {
    modal,
    internals,
    content,
    title,
    closes: () => closes,
    text: () => content.textContent,
    impact: () => content.querySelector("[data-role=inbox-impact]")?.textContent ?? "",
    row,
    restore: () => {
      recorder.restore();
      if (originalClose) Object.defineProperty(Modal.prototype, "close", originalClose);
    },
    /** Buttons are re-created on every render, so look up the newest one each time. */
    button: (label: string): (() => void | Promise<void>) => {
      const found = [...recorder.rows].reverse().find((candidate) => candidate.buttons.has(label));
      const handler = found?.buttons.get(label);
      assert.ok(handler, `button ${label}`);
      return handler;
    },
    hasButton: (label: string): boolean => recorder.rows.some((candidate) => candidate.buttons.has(label)),
  };
}

function namedSettings(inbox: string): PluginSettings {
  const settings = migrateData(null).settings;
  settings.workspaceName = "Research";
  settings.proposalFolder = inbox;
  return settings;
}

/** Real plugin whose Old Inbox holds: two source-only notes, one Direct member, one Collection member. */
async function realPluginWithInbox() {
  const files = ["a-source-only", "b-source-only", "c-direct", "d-collection"].map((name) => new TFile(`Old Inbox/${name}.md`));
  const folder = new TFolder("Old Inbox");
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? (path === "Old Inbox" ? folder : null),
      getMarkdownFiles: () => files,
      modify: () => { throw new Error("setup must not modify notes"); },
      process: () => { throw new Error("setup must not modify notes"); },
      create: () => { throw new Error("setup must not create notes"); },
      createFolder: () => { throw new Error("setup must not create folders"); },
      rename: () => { throw new Error("setup must not move notes"); },
      delete: () => { throw new Error("setup must not delete notes"); },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: { renameFile: () => { throw new Error("setup must not move notes"); }, processFrontMatter: () => { throw new Error("setup must not edit notes"); } },
    loadLocalStorage: () => null,
    saveLocalStorage: () => undefined,
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.workspaceName = "Research";
  data.settings.proposalFolder = "Old Inbox";
  data.directIndexPaths = ["Old Inbox/c-direct.md"];
  data.collections = [{ id: "c1", title: "Reading", collapsed: false, subjects: ["Old Inbox/d-collection.md"], subheadings: [] }];
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & PluginSeam;
  plugin.loadedData = createDefaultStore(data, 1, "vault-setup-workflow");
  await plugin.loadPluginData(false);
  const source: ReviewSourceShape = {
    currentInboxFolder: () => plugin.data.settings.proposalFolder,
    countInboxOnlyAffected: (next) => plugin.countOrphanedByProposalFolderChange(next),
  };
  return { plugin, source, app, files };
}

test("S1 review previews old and new Inbox and only the Inbox-only notes; Cancel writes nothing (UI; main hook pending)", async () => {
  const { plugin, source } = await realPluginWithInbox();
  assert.equal(plugin.countOrphanedByProposalFolderChange("New Inbox"), 2, "fixture: two source-only notes, Direct and Collection excluded");
  const submissions: unknown[] = [];
  const before = JSON.stringify(plugin.data);
  const ui = openSetupModal(plugin.data.settings, (value, reviewed) => { submissions.push([value, reviewed]); }, source);
  try {
    ui.internals.value.proposalFolder = " /New Inbox/ ";
    await ui.internals.submit();
    assert.equal(submissions.length, 0, "a changed Inbox is reviewed before anything is applied");
    assert.equal(ui.closes(), 0);
    const review = ui.text();
    assert.match(review, /Old Inbox/);
    assert.match(review, /New Inbox/);
    assert.match(ui.impact(), /^2 Inbox-only notes/u);
    assert.doesNotMatch(review, /4 notes|\b4\b/u, "Direct and Collection notes are not counted as leaving");
    await ui.button("Cancel")();
    assert.equal(ui.closes(), 0, "Cancel in the review returns to the editable form instead of closing");
    assert.ok(ui.text().includes(HINT), "the editable form is showing again");
    assert.equal(ui.internals.value.proposalFolder, "New Inbox", "the draft is retained (cleaned as submit cleans it)");
    assert.equal(submissions.length, 0, "Cancel never reaches the commit");
    assert.equal(JSON.stringify(plugin.data), before, "serialized settings and history are unchanged");
  } finally {
    ui.restore();
  }
});

test("S1c dismissing the review by Cancel, Close or Escape keeps the draft; the form's own Cancel and a finished commit still close", async () => {
  // Obsidian routes the close button and Escape through Modal.close(), the same
  // call the review's Cancel makes, so one entry point covers all three.
  for (const dismissal of ["Cancel", "Close", "Escape"] as const) {
    const submissions: unknown[] = [];
    const ui = openSetupModal(namedSettings("Old Inbox"), (value, reviewed) => { submissions.push([value, reviewed]); }, {
      currentInboxFolder: () => "Old Inbox",
      countInboxOnlyAffected: () => 3,
    });
    try {
      ui.internals.value.workspaceName = "Unsaved draft";
      ui.internals.value.proposalFolder = "New Inbox";
      await ui.internals.submit();
      assert.match(ui.impact(), /^3 Inbox-only notes/u);
      if (dismissal === "Cancel") await ui.button("Cancel")();
      else ui.modal.close();
      assert.equal(ui.closes(), 0, `${dismissal}: the wizard stays open`);
      assert.equal(ui.internals.value.workspaceName, "Unsaved draft", `${dismissal}: draft retained`);
      assert.equal(ui.internals.value.proposalFolder, "New Inbox", `${dismissal}: draft retained`);
      assert.ok(ui.text().includes(HINT), `${dismissal}: back on the editable form`);
      assert.equal(submissions.length, 0, `${dismissal}: no write`);
      // The form itself still closes with no write.
      ui.modal.close();
      assert.equal(ui.closes(), 1, `${dismissal}: form-level close really closes`);
      assert.equal(submissions.length, 0);
    } finally {
      ui.restore();
    }
  }
  const form = openSetupModal(namedSettings("Old Inbox"), () => undefined);
  try {
    await form.button("Cancel")();
    assert.equal(form.closes(), 1, "form-level Cancel closes");
  } finally {
    form.restore();
  }
});

test("S1b Back from the review keeps the whole draft and re-reviews the same effects (UI; main hook pending)", async () => {
  const { plugin, source } = await realPluginWithInbox();
  const submissions: unknown[] = [];
  const ui = openSetupModal(plugin.data.settings, (value, reviewed) => { submissions.push([value, reviewed]); }, source);
  try {
    ui.internals.value.workspaceName = "Renamed draft";
    ui.internals.value.proposalFolder = "New Inbox";
    await ui.internals.submit();
    assert.equal(ui.hasButton("Back to edit"), true, "the review offers Back");
    await ui.button("Back to edit")();
    assert.equal(ui.closes(), 0, "Back does not close the wizard");
    assert.equal(ui.internals.value.workspaceName, "Renamed draft");
    assert.equal(ui.internals.value.proposalFolder, "New Inbox");
    assert.equal(submissions.length, 0);
  } finally {
    ui.restore();
  }
});

test("S2 unchanged Inbox skips the review and a changed Inbox with zero affected notes says zero (UI; main hook pending)", async () => {
  const unchanged = await realPluginWithInbox();
  const submitted: Array<[WorkspaceSetupValue, unknown]> = [];
  const keep = openSetupModal(unchanged.plugin.data.settings, (value, reviewed) => { submitted.push([value, reviewed]); }, unchanged.source);
  try {
    await keep.internals.submit();
    assert.equal(submitted.length, 1, "an unchanged Inbox needs no review");
    assert.equal(submitted[0]?.[1], null);
    assert.equal(keep.closes(), 1);
  } finally {
    keep.restore();
  }

  const zero = openSetupModal(namedSettings("Empty Inbox"), (value, reviewed) => { submitted.push([value, reviewed]); }, {
    currentInboxFolder: () => "Empty Inbox",
    countInboxOnlyAffected: () => 0,
  });
  try {
    zero.internals.value.proposalFolder = "Other Inbox";
    await zero.internals.submit();
    assert.equal(submitted.length, 1, "even a zero-effect change is shown before it is applied");
    assert.match(zero.text(), /Empty Inbox/);
    assert.match(zero.text(), /Other Inbox/);
    assert.match(zero.impact(), /^0 Inbox-only notes are affected/u);
    await zero.button("Apply Inbox change and finish setup")();
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1]?.[1], { previousFolder: "Empty Inbox", nextFolder: "Other Inbox", affectedCount: 0 });
  } finally {
    zero.restore();
  }
});

test("S3 confirming hands the reviewed effects to the commit once, even when clicked twice (UI; main hook pending)", async () => {
  const { plugin, source } = await realPluginWithInbox();
  const gate: { release: () => void } = { release: () => undefined };
  const waiting = new Promise<void>((resolve) => { gate.release = resolve; });
  const commits: unknown[] = [];
  const ui = openSetupModal(plugin.data.settings, async (value, reviewed) => { commits.push(reviewed); await waiting; void value; }, source);
  try {
    ui.internals.value.proposalFolder = "New Inbox";
    await ui.internals.submit();
    const confirm = ui.button("Apply Inbox change and finish setup");
    const first = confirm();
    const second = confirm();
    gate.release();
    await Promise.all([first, second]);
    assert.deepEqual(commits, [{ previousFolder: "Old Inbox", nextFolder: "New Inbox", affectedCount: 2 }], "one commit with the reviewed effects");
    assert.equal(ui.closes(), 1);
  } finally {
    ui.restore();
  }
});

test("S5 outdated reviewed effects refresh the review and require another confirmation (UI; main hook pending)", async () => {
  const { plugin, source } = await realPluginWithInbox();
  let attempts = 0;
  const ui = openSetupModal(plugin.data.settings, () => {
    attempts += 1;
    plugin.data.directIndexPaths = ["Old Inbox/c-direct.md", "Old Inbox/a-source-only.md"];
    plugin.invalidateRecordCache();
    throw new SetupReviewOutdatedError("Notes changed while you were reviewing.");
  }, source);
  try {
    ui.internals.value.proposalFolder = "New Inbox";
    await ui.internals.submit();
    assert.match(ui.impact(), /^2 Inbox-only notes/u);
    await ui.button("Apply Inbox change and finish setup")();
    assert.equal(attempts, 1);
    assert.equal(ui.closes(), 0, "an outdated review never closes the wizard");
    assert.match(ui.text(), /Notes changed while you were reviewing\./u);
    assert.match(ui.impact(), /^1 Inbox-only note /u, "the refreshed review shows the new count in the singular");
    assert.equal(ui.hasButton("Apply Inbox change and finish setup"), true, "a refreshed review needs a new confirmation");
  } finally {
    ui.restore();
  }
});

test("S7 the conditional Sync hint is present without claiming any Sync status", async () => {
  const ui = openSetupModal(namedSettings("Inbox"), () => undefined);
  try {
    assert.ok(ui.text().includes(HINT), "exact conditional hint");
    assert.doesNotMatch(ui.text(), /(detected|incomplete|still syncing|not finished syncing|is syncing)/iu, "no invented Sync-status assertion");
  } finally {
    ui.restore();
  }
});

/** The real view route: wizard opened by openSetupWizard with the real plugin. */
async function openWizardThroughView() {
  const fixture = await realPluginWithInbox();
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView;
  Object.assign(view, {
    plugin: fixture.plugin, app: fixture.app,
    loadedBaseId: fixture.plugin.getActiveKnowledgeBaseId(), loadedDataEpoch: fixture.plugin.getDataEpoch(),
  });
  const originalOpen = Object.getOwnPropertyDescriptor(WorkspaceSetupModal.prototype, "open");
  const opened: WorkspaceSetupModal[] = [];
  WorkspaceSetupModal.prototype.open = function (): void { opened.push(this); };
  try {
    view.openSetupWizard();
  } finally {
    if (originalOpen) Object.defineProperty(WorkspaceSetupModal.prototype, "open", originalOpen);
    else Reflect.deleteProperty(WorkspaceSetupModal.prototype, "open");
  }
  assert.equal(opened.length, 1);
  const modal = opened[0];
  assert.ok(modal);
  const recorder = recordSettings();
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const content = root.createDiv();
  let closes = 0;
  Object.assign(modal, {
    modalEl: asHtmlElement(root), contentEl: asHtmlElement(content), titleEl: asHtmlElement(root.createEl("h2")),
    close: () => { closes += 1; },
  });
  modal.onOpen();
  return { ...fixture, modal, internals: modal as unknown as ModalInternals, content, closes: () => closes, recorder };
}

test("S5 view route: a stale reviewed count refreshes the review with no write, then the refreshed review commits", async () => {
  const h = await openWizardThroughView();
  try {
    h.plugin.savedData.length = 0;
    h.internals.value.workspaceName = "Research";
    h.internals.value.proposalFolder = "New Inbox";
    await h.internals.submit();
    assert.equal(h.plugin.savedData.length, 0, "nothing is saved while the review is open");
    assert.equal(h.plugin.data.settings.proposalFolder, "Old Inbox");
    const impact = (): string => h.content.querySelector("[data-role=inbox-impact]")?.textContent ?? "";
    assert.match(impact(), /^2 Inbox-only notes/u);
    // A note gains Index membership while the review is open (S5).
    h.plugin.data.directIndexPaths = ["Old Inbox/c-direct.md", "Old Inbox/a-source-only.md"];
    h.plugin.invalidateRecordCache();
    const confirm = [...h.recorder.rows].reverse().find((row) => row.buttons.has("Apply Inbox change and finish setup"));
    assert.ok(confirm);
    await confirm.buttons.get("Apply Inbox change and finish setup")?.();
    assert.equal(h.plugin.savedData.length, 0, "outdated effects are never applied");
    assert.equal(h.plugin.data.settings.proposalFolder, "Old Inbox");
    assert.equal(h.closes(), 0);
    assert.match(impact(), /^1 Inbox-only note /u);
    const again = [...h.recorder.rows].reverse().find((row) => row.buttons.has("Apply Inbox change and finish setup"));
    await again?.buttons.get("Apply Inbox change and finish setup")?.();
    assert.equal(h.plugin.data.settings.proposalFolder, "New Inbox", "the refreshed review applies once confirmed");
    assert.equal(h.plugin.data.settings.setupComplete, true);
    assert.equal(h.plugin.savedData.length, 1);
    assert.equal(h.closes(), 1);
  } finally {
    h.recorder.restore();
  }
});

test("S6 a settled no-op Sync reload during the review keeps the draft and applies it to the current settings through the real transaction", async () => {
  const h = await openWizardThroughView();
  try {
    h.internals.value.workspaceName = "After setup";
    h.internals.value.proposalFolder = "New Inbox";
    await h.internals.submit();
    const previousSettings = h.plugin.data.settings;
    h.plugin.loadedData = structuredClone((h.plugin as unknown as { store: unknown }).store);
    await h.plugin.onExternalSettingsChange();
    assert.notEqual(h.plugin.data.settings, previousSettings, "the reload replaces the settings object");
    h.plugin.savedData.length = 0;
    const confirm = [...h.recorder.rows].reverse().find((row) => row.buttons.has("Apply Inbox change and finish setup"));
    await confirm?.buttons.get("Apply Inbox change and finish setup")?.();
    assert.equal(h.plugin.data.settings.workspaceName, "After setup");
    assert.equal(h.plugin.data.settings.proposalFolder, "New Inbox");
    assert.equal(previousSettings.proposalFolder, "Old Inbox", "the obsolete settings object is not mutated");
    assert.equal(h.plugin.savedData.length, 1);
    assert.equal(h.closes(), 1);
  } finally {
    h.recorder.restore();
  }
});

test("S4 view route: base change, read-only and ENT transitions during the review are rejected at commit with no write", async () => {
  const transitions: Array<[string, (h: Awaited<ReturnType<typeof openWizardThroughView>>) => void]> = [
    ["base switch", (h) => { (h.plugin as unknown as { store: { activeBaseId: string } }).store.activeBaseId = "another-base"; }],
    ["read-only", (h) => { h.plugin.dataCompatibilityWarning = "Protected read-only."; }],
    ["ENT", (h) => { h.plugin.data.settings.workspaceMode = "ent-clinical"; }],
  ];
  for (const [name, change] of transitions) {
    const h = await openWizardThroughView();
    try {
      h.internals.value.proposalFolder = "New Inbox";
      await h.internals.submit();
      h.plugin.savedData.length = 0;
      const undoDepth = h.plugin.data.undoStack.length;
      change(h);
      const confirm = [...h.recorder.rows].reverse().find((row) => row.buttons.has("Apply Inbox change and finish setup"));
      await confirm?.buttons.get("Apply Inbox change and finish setup")?.();
      assert.equal(h.plugin.savedData.length, 0, `${name}: nothing saved`);
      assert.equal(h.plugin.data.undoStack.length, undoDepth, `${name}: no history entry`);
      assert.equal(h.plugin.data.settings.proposalFolder, "Old Inbox", `${name}: Inbox unchanged`);
      assert.equal(h.closes(), 0, `${name}: the draft stays open`);
    } finally {
      h.recorder.restore();
    }
  }
});

test("S3 view route: one confirmed change is one history entry and Undo/Redo restore the exact settings", async () => {
  const h = await openWizardThroughView();
  try {
    const before = JSON.stringify(h.plugin.data.settings);
    const depth = h.plugin.data.undoStack.length;
    h.plugin.savedData.length = 0;
    h.internals.value.workspaceName = "After setup";
    h.internals.value.proposalFolder = "New Inbox";
    await h.internals.submit();
    assert.equal(h.plugin.savedData.length, 0);
    const confirm = [...h.recorder.rows].reverse().find((row) => row.buttons.has("Apply Inbox change and finish setup"));
    await confirm?.buttons.get("Apply Inbox change and finish setup")?.();
    assert.equal(h.plugin.data.undoStack.length, depth + 1, "exactly one history entry");
    assert.equal(h.plugin.data.settings.proposalFolder, "New Inbox");
    assert.equal(h.plugin.data.settings.setupComplete, true);
    const after = JSON.stringify(h.plugin.data.settings);
    await h.plugin.undo();
    assert.equal(JSON.stringify(h.plugin.data.settings), before, "Undo restores the exact prior settings");
    await h.plugin.redo();
    assert.equal(JSON.stringify(h.plugin.data.settings), after, "Redo restores the exact new settings");
    for (const file of h.files) assert.ok(file.path.startsWith("Old Inbox/"), "no note moved");
  } finally {
    h.recorder.restore();
  }
});

test("createKnowledgeBase derives the folders with the shared rules and creates nothing when they are invalid", async () => {
  const { plugin, app } = await realPluginWithInbox();
  const count = (): number => plugin.getKnowledgeBases(true).length;
  const start = count();
  const created = await plugin.createKnowledgeBase("Étude", "generic", " /Études/Ñandú 研究/ ");
  assert.equal(count(), start + 1);
  assert.equal(created.data.settings.primaryFolder, "Études/Ñandú 研究");
  assert.equal(created.data.settings.defaultNoteFolder, "Études/Ñandú 研究");
  assert.equal(created.data.settings.proposalFolder, "Études/Ñandú 研究/Inbox");
  const root = await plugin.createKnowledgeBase("Plain", "generic", "Research");
  assert.equal(root.data.settings.proposalFolder, "Research/Inbox");

  const before = count();
  await assert.rejects(plugin.createKnowledgeBase("Bad", "generic", "Notes/a?b"), /Folder names cannot contain/u);
  assert.equal(count(), before, "an invalid parent creates no base");
  app.vault.configDir = "Notes/Inbox";
  await assert.rejects(plugin.createKnowledgeBase("Derived", "generic", "Notes"), /Inbox folder derived from this folder/u);
  assert.equal(count(), before, "an invalid derived Inbox creates no base");
});

test("view setup route rejects a review confirmed after read-only protection starts (legacy single-transition case)", async () => {
  const h = await openWizardThroughView();
  try {
    h.plugin.savedData.length = 0;
    h.internals.value.proposalFolder = "New Inbox";
    await h.internals.submit();
    h.plugin.dataCompatibilityWarning = "Protected read-only.";
    const confirm = [...h.recorder.rows].reverse().find((row) => row.buttons.has("Apply Inbox change and finish setup"));
    await confirm?.buttons.get("Apply Inbox change and finish setup")?.();
    assert.equal(h.plugin.savedData.length, 0);
    assert.equal(h.plugin.data.settings.proposalFolder, "Old Inbox");
    assert.equal(h.closes(), 0, "the reviewed draft stays open");
  } finally {
    h.recorder.restore();
  }
});
