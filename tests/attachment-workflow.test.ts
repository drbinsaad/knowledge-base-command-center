import assert from "node:assert/strict";
import test from "node:test";
import type { TAbstractFile } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { createDefaultStore, migrateData } from "../src/model.ts";
import { AttachmentLinkInsertionError } from "../src/attachment.ts";
import { TFile, TFolder } from "./support/obsidian-stub.ts";

interface PluginBase {
  loadedData: unknown;
}

const EXISTING_BYTES = [9, 9, 9];

async function fixture(options: { markdown?: string } = {}) {
  const note = new TFile("Knowledge/Topic.md");
  const existing = new TFile("Files/old.pdf");
  const files = new Map<string, TAbstractFile>([[note.path, note], [existing.path, existing], ["Files", new TFolder("Files")]]);
  const binaries = new Map<string, number[]>([[existing.path, [...EXISTING_BYTES]]]);
  let markdown = options.markdown ?? "# Topic\n\n## Notes\nKeep\n";
  const state = {
    createBinaryCalls: 0,
    removals: 0,
    cursorInserts: [] as string[],
    activeView: null as { file: TFile; editor: unknown } | null,
    failCreateOn: "",
    failLinkGeneration: false,
    onCreateFolder: () => {},
    onGetAvailable: () => {},
  };
  const editor = {
    getValue: () => markdown,
    getCursor: () => ({ line: 0, ch: 0 }),
    replaceRange: (value: string) => { state.cursorInserts.push(value); },
  };
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => { markdown = update(markdown); },
      createFolder: async (path: string) => { state.onCreateFolder(); files.set(path, new TFolder(path)); },
      createBinary: async (path: string, bytes: ArrayBuffer) => {
        state.createBinaryCalls += 1;
        if (state.failCreateOn && path.endsWith(state.failCreateOn)) throw new Error("simulated disk failure");
        const file = new TFile(path);
        files.set(path, file);
        binaries.set(path, [...new Uint8Array(bytes)]);
        return file;
      },
      delete: async () => { state.removals += 1; },
      trash: async () => { state.removals += 1; },
    },
    workspace: {
      getLeavesOfType: () => [],
      getActiveViewOfType: () => state.activeView,
      getActiveFile: () => note,
    },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      generateMarkdownLink: (file: TFile) => {
        if (state.failLinkGeneration) throw new Error("simulated link failure");
        return `[[${file.path}]]`;
      },
      getAvailablePathForAttachment: async (name: string) => { state.onGetAvailable(); return `Files/${name}`; },
    },
  };
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Files";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & PluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-workflow-test");
  await plugin.loadPluginData();
  return {
    plugin,
    note,
    files,
    state,
    editor,
    markdown: () => markdown,
    setMarkdown: (value: string) => { markdown = value; },
    preexistingBytesUnchanged: () => JSON.stringify(binaries.get(existing.path)) === JSON.stringify(EXISTING_BYTES),
  };
}

const batch = (names: string[], insertionMode: "cursor" | "end" = "end") => ({
  files: names.map((name) => new File(["x"], name)),
  requestedFolder: "",
  insertionMode,
  display: "link" as const,
});

test("A1 Cursor choice with another note or no editor copies nothing", async () => {
  const f = await fixture();
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["a.pdf"], "cursor")), /Markdown editor/u);
  f.state.activeView = { file: new TFile("Other.md"), editor: f.editor };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["a.pdf"], "cursor")), /Markdown editor/u);
  assert.equal(f.state.createBinaryCalls, 0);
  assert.equal(f.files.has("Files/a.pdf"), false);
  assert.equal(f.preexistingBytesUnchanged(), true);
});

test("A1 editor lost during the awaited bytes read copies nothing; corrected End retry copies exactly once", async () => {
  const f = await fixture();
  f.state.activeView = { file: f.note, editor: f.editor };
  const file = new File(["x"], "a.pdf");
  const original = file.arrayBuffer.bind(file);
  file.arrayBuffer = async () => { f.state.activeView = null; return original(); };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, { ...batch([]), files: [file], insertionMode: "cursor" }), /Markdown editor/u);
  assert.equal(f.state.createBinaryCalls, 0, "the stale editor is caught before the binary write");
  const created = await f.plugin.attachFilesToNote(f.note, batch(["a.pdf"], "end"));
  assert.deepEqual(created.map((entry) => entry.path), ["Files/a.pdf"]);
  assert.equal(f.state.createBinaryCalls, 1);
  assert.equal(f.markdown(), "# Topic\n\n## Notes\nKeep\n\n[[Files/a.pdf]]\n");
  assert.equal(f.preexistingBytesUnchanged(), true);
});

test("A1 editor lost during the awaited destination allocation copies nothing", async () => {
  const f = await fixture();
  f.state.activeView = { file: f.note, editor: f.editor };
  f.files.delete("Files");
  f.state.onCreateFolder = () => { f.state.activeView = null; };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["a.pdf"], "cursor")), /Markdown editor/u);
  assert.equal(f.state.createBinaryCalls, 0);
});

test("A2 owning editor still inserts once at the cursor", async () => {
  const f = await fixture();
  f.state.activeView = { file: f.note, editor: f.editor };
  await f.plugin.attachFilesToNote(f.note, batch(["a.pdf", "b.pdf"], "cursor"));
  assert.equal(f.state.createBinaryCalls, 2);
  assert.deepEqual(f.state.cursorInserts, ["[[Files/a.pdf]]\n[[Files/b.pdf]]"]);
});

test("A4 insertion failure after two copies reports exact paths and deletes nothing", async () => {
  const f = await fixture();
  f.state.failLinkGeneration = true;
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["a.pdf", "b.pdf"])), (error: unknown) => {
    assert.ok(error instanceof AttachmentLinkInsertionError);
    assert.deepEqual(error.copiedPaths, ["Files/a.pdf", "Files/b.pdf"]);
    return true;
  });
  assert.equal(f.state.createBinaryCalls, 2);
  assert.equal(f.state.removals, 0);
  assert.equal(f.files.has("Files/a.pdf") && f.files.has("Files/b.pdf"), true);
  assert.equal(f.preexistingBytesUnchanged(), true);
});

test("A5 second copy failure keeps and links the first file", async () => {
  const f = await fixture();
  f.state.failCreateOn = "b.pdf";
  const created = await f.plugin.attachFilesToNote(f.note, batch(["a.pdf", "b.pdf", "c.pdf"]));
  assert.deepEqual(created.map((entry) => entry.path), ["Files/a.pdf"]);
  assert.equal(f.state.createBinaryCalls, 2, "the third file is never attempted");
  assert.equal(f.markdown().includes("[[Files/a.pdf]]"), true);
  assert.equal(f.preexistingBytesUnchanged(), true);
});

test("the consented heading policy stays frozen when settings change mid-copy", async () => {
  const f = await fixture();
  const settings = (f.plugin as unknown as { data: { settings: { attachmentHeading: string } } }).data.settings;
  settings.attachmentHeading = "Attachments";
  const policy = (f.plugin as unknown as { captureAttachmentPolicy(): never }).captureAttachmentPolicy();
  const file = new File(["x"], "a.pdf");
  const original = file.arrayBuffer.bind(file);
  file.arrayBuffer = async () => { settings.attachmentHeading = "Redirected"; return original(); };
  await f.plugin.attachFilesToNote(f.note, { files: [file], requestedFolder: "", insertionMode: "heading", display: "link" }, policy);
  assert.equal(f.markdown().includes("## Attachments\n\n[[Files/a.pdf]]"), true);
  assert.equal(f.markdown().includes("Redirected"), false, "insertion is not redirected by a later settings change");
});

test("a failure after the first copy keeps and reports the copied file instead of deleting or re-copying", async () => {
  const f = await fixture();
  f.state.activeView = { file: f.note, editor: f.editor };
  const second = new File(["y"], "b.pdf");
  const original = second.arrayBuffer.bind(second);
  second.arrayBuffer = async () => { f.state.activeView = null; return original(); };
  await assert.rejects(
    f.plugin.attachFilesToNote(f.note, { files: [new File(["x"], "a.pdf"), second], requestedFolder: "", insertionMode: "cursor", display: "link" }),
    (error: unknown) => {
      assert.ok(error instanceof AttachmentLinkInsertionError);
      assert.deepEqual(error.copiedPaths, ["Files/a.pdf"]);
      return true;
    },
  );
  assert.equal(f.state.createBinaryCalls, 1, "the first file was copied once; the second never started");
  assert.equal(f.files.has("Files/a.pdf"), true);
  assert.equal(f.state.removals, 0);
});

test("A6 AI-locked, replaced or immutable notes copy nothing", async () => {
  const locked = await fixture({ markdown: "---\nai_lock: true\n---\n# Topic\n" });
  await assert.rejects(locked.plugin.attachFilesToNote(locked.note, batch(["a.pdf"])), /ai_lock/u);
  assert.equal(locked.state.createBinaryCalls, 0);
  const replaced = await fixture();
  await assert.rejects(replaced.plugin.attachFilesToNote(new TFile(replaced.note.path), batch(["a.pdf"])), /changed or was replaced/u);
  assert.equal(replaced.state.createBinaryCalls, 0);
});
