import assert from "node:assert/strict";
import test from "node:test";
import { Modal, TAbstractFile, TFile, TFolder } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { QuickAppendModal } from "../src/follow-up-modal.ts";
import { createDefaultStore, migrateData } from "../src/model.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

async function harness() {
  const entries = new Map<string, TAbstractFile>();
  const template = new TFile("Templates/Example.md");
  const note = new TFile("Existing.md");
  entries.set("Templates", new TFolder("Templates"));
  entries.set(template.path, template);
  entries.set(note.path, note);
  const writes: string[] = [];
  const removed: string[] = [];
  let content = "# Existing note\n";
  const hooks = {
    read: (): void => {}, folder: (): void => {}, process: (): void => {},
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      getMarkdownFiles: () => [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile && entry.extension === "md"),
      cachedRead: async () => { hooks.read(); return "# {{title}}\n"; },
      createFolder: async (path: string) => {
        const folder = new TFolder(path);
        entries.set(path, folder);
        hooks.folder();
        return folder;
      },
      create: async (path: string) => {
        writes.push(path);
        const file = new TFile(path);
        entries.set(path, file);
        return file;
      },
      process: async (_file: TFile, transform: (text: string) => string) => {
        hooks.process();
        content = transform(content);
        writes.push(note.path);
      },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: async (file: TAbstractFile) => { removed.push(file.path); entries.delete(file.path); } },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.templatesFolder = "Templates";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  plugin.loadedData = createDefaultStore(data, 1, "vault-write-boundary");
  await plugin.loadPluginData(false);
  return { plugin, hooks, entries, writes, removed, template, note, content: () => content };
}

const genericValue = { title: "New note", folder: "New", mode: "template" as const, templatePath: "Templates/Example.md", addToCollection: false };

test("ordinary creation refuses read-only, stale base/epoch and policy changes during template reads", async () => {
  for (const change of ["read-only", "base", "epoch", "generation", "templates"] as const) {
    const fixture = await harness();
    fixture.hooks.read = () => {
      const { plugin } = fixture;
      if (change === "read-only") plugin.dataCompatibilityWarning = "Plugin data is protected read-only.";
      else if (change === "templates") plugin.data.settings.templatesFolder = "Other templates";
      else if (change === "base") plugin.store.activeBaseId = "changed-base";
      else {
        const key = change === "epoch" ? "dataEpoch" : "externalChangeGeneration";
        const internal = plugin as unknown as Record<string, number>;
        internal[key] += 1;
      }
    };
    await assert.rejects(fixture.plugin.createKnowledgeNote(genericValue), /protected|changed|read-only/iu, change);
    assert.deepEqual(fixture.writes, [], change);
    assert.equal(fixture.entries.has("New"), false, "only newly created empty folders are cleaned");
    assert.ok(fixture.entries.has("Templates"));
  }
});

test("ordinary creation refuses replaced, moved or modified templates and occupied paths after async folder work", async () => {
  for (const change of ["replaced", "moved", "modified", "collision"] as const) {
    const fixture = await harness();
    fixture.hooks.folder = () => {
      if (change === "replaced") fixture.entries.set(fixture.template.path, new TFile(fixture.template.path));
      if (change === "moved") fixture.template.path = "Templates/Moved.md";
      if (change === "modified") fixture.template.stat.mtime += 1;
      if (change === "collision") {
        const other = new TFile("New/New note.md");
        fixture.entries.set(other.path, other);
        const folder = fixture.entries.get("New");
        assert.ok(folder instanceof TFolder);
        folder.children.push(other);
      }
    };
    await assert.rejects(fixture.plugin.createKnowledgeNote(genericValue), /template changed|already exists/iu, change);
    assert.deepEqual(fixture.writes, []);
    if (change === "collision") {
      assert.ok(fixture.entries.has("New/New note.md"), "concurrent note is untouched");
      assert.ok(fixture.entries.has("New"), "nonempty operation-created folder is preserved");
    } else assert.equal(fixture.entries.has("New"), false);
  }
});

test("empty, proposal and canonical creation repeat writability checks after folder creation", async () => {
  for (const kind of ["empty", "proposal", "canonical"] as const) {
    const fixture = await harness();
    fixture.hooks.folder = () => { fixture.plugin.dataCompatibilityWarning = "Protected read-only after sync."; };
    const topic = { title: "Laryngeal cleft", domain: "Laryngology", parentPath: "", topicKind: "condition", priority: "P2", safetyCritical: false, curriculumId: "ENT-LAR-010", addToCollection: false };
    const creation = kind === "empty"
      ? fixture.plugin.createKnowledgeNote({ ...genericValue, mode: "empty", templatePath: "" })
      : kind === "proposal" ? fixture.plugin.createProposal(topic) : fixture.plugin.createCanonical(topic);
    await assert.rejects(creation, /read-only/iu);
    assert.deepEqual(fixture.writes, []);
    assert.ok(fixture.removed.length > 0);
    assert.ok(fixture.entries.has("Existing.md"));
  }
});

test("Quick Append rechecks read-only, base, category and file movement inside the atomic transform", async () => {
  for (const change of ["read-only", "base", "category", "moved"] as const) {
    const fixture = await harness();
    fixture.hooks.process = () => {
      if (change === "read-only") fixture.plugin.dataCompatibilityWarning = "Protected read-only.";
      else if (change === "base") fixture.plugin.store.activeBaseId = "changed-base";
      else if (change === "category") fixture.plugin.data.settings.followUpCategories.find((category) => category.id === "questions")!.archived = true;
      else {
        fixture.entries.delete(fixture.note.path);
        fixture.note.path = "Moved.md";
        fixture.entries.set(fixture.note.path, fixture.note);
      }
    };
    await assert.rejects(fixture.plugin.appendFollowUpToFile(fixture.note, "questions", "Do not save"), /read-only|changed|same Markdown/iu);
    assert.equal(fixture.content(), "# Existing note\n");
    assert.deepEqual(fixture.writes, []);
  }
});

test("Quick Append undo rechecks writability inside the atomic transform", async () => {
  const fixture = await harness();
  await fixture.plugin.appendFollowUpToFile(fixture.note, "questions", "Keep this append");
  const appended = fixture.content();
  fixture.hooks.process = () => { fixture.plugin.dataCompatibilityWarning = "Protected read-only."; };
  const plugin = fixture.plugin as unknown as { undoLastFollowUpAppend(): Promise<void> };
  await assert.rejects(plugin.undoLastFollowUpAppend(), /read-only/iu);
  assert.equal(fixture.content(), appended);
});

test("attachment import refuses a late read-only transition before binary creation and cleans only empty new folders", async () => {
  const fixture = await harness();
  fixture.plugin.data.settings.attachmentStorageMode = "fixed-folder";
  fixture.plugin.data.settings.attachmentFolder = "New attachments";
  fixture.plugin.app.workspace.getActiveViewOfType = () => null;
  let binaryWrites = 0;
  fixture.plugin.app.vault.createBinary = async (path) => { binaryWrites += 1; return new TFile(path); };
  const file = new File([new Uint8Array([1, 2, 3])], "Synthetic.png");
  file.arrayBuffer = async () => {
    fixture.plugin.dataCompatibilityWarning = "Protected read-only while loading the attachment.";
    return new ArrayBuffer(3);
  };
  await assert.rejects(fixture.plugin.attachFileToNote(fixture.note, {
    file, requestedFolder: "", insertionMode: "end",
  }), /read-only/iu);
  assert.equal(binaryWrites, 0);
  assert.equal(fixture.content(), "# Existing note\n");
  assert.deepEqual(fixture.removed, ["New attachments"]);
  assert.ok(fixture.entries.has("Existing.md"));
});

test("Quick Append blocks close and all controls during save, restores draft on failure, and submits once", async () => {
  for (const fail of [false, true]) {
    const { document } = createFakeDom();
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let submissions = 0;
    const modal = new QuickAppendModal({} as never, {
      categories: [], file: new TFile("Synthetic.md"), initialDate: "2026-09-19",
      onSubmit: async () => { submissions += 1; await pending; if (fail) throw new Error("Synthetic write failure"); },
    });
    const internals = modal as unknown as {
      contentEl: HTMLElement; modalEl: HTMLElement; errorEl: HTMLElement;
      value: { categoryId: string; date: string; text: string }; submit(): Promise<void>;
    };
    const container = document.createElement("div");
    const modalEl = document.createElement("div");
    const controls = ["button", "input", "select", "textarea"].map((tag) => container.createEl(tag));
    controls.forEach((control) => { control.disabled = false; });
    controls[2].disabled = true;
    // The narrow fake DOM does not implement selector-list unions.
    container.querySelectorAll = (selector) => selector === "button, input, select, textarea" ? controls : [];
    const error = container.createDiv();
    internals.contentEl = asHtmlElement(container);
    internals.modalEl = asHtmlElement(modalEl);
    internals.errorEl = asHtmlElement(error);
    internals.value = { categoryId: "questions", date: "2026-09-19", text: "Keep the typed draft" };
    let closes = 0;
    const close = Object.getOwnPropertyDescriptor(Modal.prototype, "close");
    Modal.prototype.close = () => { closes += 1; };
    try {
      const save = internals.submit();
      assert.ok(controls.every((control) => control.disabled));
      assert.equal(modalEl.getAttribute("aria-busy"), "true");
      modal.close();
      await internals.submit();
      assert.equal(closes, 0);
      assert.equal(submissions, 1);
      finish();
      await save;
      assert.deepEqual(controls.map((control) => control.disabled), [false, false, true, false]);
      assert.equal(closes, fail ? 0 : 1);
      assert.equal(internals.value.text, "Keep the typed draft");
      if (fail) assert.match(error.textContent, /Synthetic write failure/u);
    } finally {
      if (close) Object.defineProperty(Modal.prototype, "close", close);
      else Reflect.deleteProperty(Modal.prototype, "close");
    }
  }
});
