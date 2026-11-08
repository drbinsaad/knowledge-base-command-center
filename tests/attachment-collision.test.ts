import assert from "node:assert/strict";
import test from "node:test";
import type { TAbstractFile } from "obsidian";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { createDefaultStore, migrateData } from "../src/model.ts";
import { AttachmentLinkInsertionError, MAX_ATTACHMENT_CREATE_ATTEMPTS } from "../src/attachment.ts";
import { TFile, TFolder } from "./support/obsidian-stub.ts";

interface PluginBase {
  loadedData: unknown;
}

const key = (name: string): string => name.normalize("NFC").toLocaleLowerCase();

/** A vault whose createBinary is exclusive and case/Unicode-insensitive, like a hostile filesystem. */
async function fixture() {
  const note = new TFile("Knowledge/Topic.md");
  const folder = new TFolder("Files");
  const entries = new Map<string, TAbstractFile>([[note.path, note], [folder.path, folder]]);
  const bytes = new Map<string, number[]>();
  let markdown = "# Topic\n";
  const state = {
    attempts: [] as string[],
    removals: 0,
    /** Runs just before the exclusive create of each attempted destination. */
    beforeCreate: (_path: string, _attempt: number): void => {},
    ioFailure: false,
    ioError: null as Error | null,
  };
  const occupy = (name: string, content: number[] = [7, 7], asFolder = false): TAbstractFile => {
    const path = `Files/${name}`;
    const entry = asFolder ? new TFolder(path) : new TFile(path);
    entries.set(path, entry);
    folder.children.push(entry);
    if (!asFolder) bytes.set(path, content);
    return entry;
  };
  const snapshot = () => JSON.stringify([...bytes.entries()].filter(([path]) => preexisting.has(path)));
  const preexisting = new Set<string>();
  const app = {
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => (path === "/" ? null : entries.get(path) ?? null),
      getMarkdownFiles: () => [note],
      cachedRead: async () => markdown,
      process: async (_file: TFile, update: (value: string) => string) => { markdown = update(markdown); },
      createFolder: async (path: string) => { entries.set(path, new TFolder(path)); },
      createBinary: async (path: string, data: ArrayBuffer) => {
        state.attempts.push(path);
        state.beforeCreate(path, state.attempts.length);
        if (state.ioFailure) throw state.ioError ?? new Error("simulated disk failure");
        const name = path.slice(path.lastIndexOf("/") + 1);
        if (folder.children.some((child) => key(child.name) === key(name))) throw new Error("Destination file already exists!");
        const file = new TFile(path);
        entries.set(path, file);
        folder.children.push(file);
        bytes.set(path, [...new Uint8Array(data)]);
        return file;
      },
      delete: async () => { state.removals += 1; },
      trash: async () => { state.removals += 1; },
    },
    workspace: { getLeavesOfType: () => [], getActiveViewOfType: () => null, getActiveFile: () => note },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: {
      generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
      getAvailablePathForAttachment: async () => "unused",
    },
  };
  const data = migrateData(null);
  data.settings.attachmentStorageMode = "fixed-folder";
  data.settings.attachmentFolder = "Files";
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & PluginBase;
  plugin.loadedData = createDefaultStore(data, 1, "vault-attachment-collision-test");
  await plugin.loadPluginData();
  return {
    plugin, note, state, entries, bytes, occupy,
    markdown: () => markdown,
    /** Record a pre-existing object so later assertions can prove it is unchanged. */
    seed: (name: string, content?: number[], asFolder = false) => {
      const entry = occupy(name, content, asFolder);
      preexisting.add(entry.path);
      return entry;
    },
    seededUnchanged: snapshot,
  };
}

const batch = (names: string[]) => ({
  files: names.map((name) => new File(["new"], name)),
  requestedFolder: "",
  insertionMode: "end" as const,
  display: "link" as const,
});

test("A8 a case-different existing file is never overwritten", async () => {
  const f = await fixture();
  const existing = f.seed("Cover.JPG", [1, 2, 3]);
  const before = f.seededUnchanged();
  const created = await f.plugin.attachFilesToNote(f.note, batch(["cover.jpg"]));
  assert.deepEqual(created.map((file) => file.path), ["Files/cover 1.jpg"]);
  assert.deepEqual(f.state.attempts, ["Files/cover 1.jpg"], "exactly one create, at the safe name");
  assert.equal(f.entries.get("Files/Cover.JPG"), existing);
  assert.equal(f.seededUnchanged(), before);
});

test("A8 a canonically equivalent Unicode name is treated as occupied", async () => {
  const f = await fixture();
  f.seed("Café.pdf", [4]);
  const before = f.seededUnchanged();
  const created = await f.plugin.attachFilesToNote(f.note, batch(["Café.pdf"]));
  assert.deepEqual(created.map((file) => file.path), ["Files/Café 1.pdf"]);
  assert.equal(f.seededUnchanged(), before);
});

test("A9 a case-equivalent folder occupies the candidate", async () => {
  const f = await fixture();
  const dir = f.seed("report.pdf", undefined, true);
  const created = await f.plugin.attachFilesToNote(f.note, batch(["Report.PDF"]));
  assert.deepEqual(created.map((file) => file.path), ["Files/Report 1.PDF"]);
  assert.equal(f.entries.get("Files/report.pdf"), dir, "the folder is untouched");
  assert.deepEqual(f.state.attempts, ["Files/Report 1.PDF"]);
});

test("A10 a race at the allocated path retries once with a new name and keeps the other file", async () => {
  const f = await fixture();
  f.state.beforeCreate = (_path, attempt) => { if (attempt === 1) f.occupy("X.PDF", [5, 5]); };
  const created = await f.plugin.attachFilesToNote(f.note, batch(["x.pdf"]));
  assert.deepEqual(f.state.attempts, ["Files/x.pdf", "Files/x 1.pdf"]);
  assert.deepEqual(created.map((file) => file.path), ["Files/x 1.pdf"]);
  assert.deepEqual(f.bytes.get("Files/X.PDF"), [5, 5], "the concurrent file is unchanged");
  assert.equal(f.markdown().match(/\[\[Files\/x 1\.pdf\]\]/gu)?.length, 1, "linked exactly once");
});

test("A11 collisions at every attempt stop at the bound with an explicit failure", async () => {
  const f = await fixture();
  f.state.beforeCreate = (path) => { f.occupy(path.slice("Files/".length).toUpperCase(), [8]); };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["y.pdf"])), /No unused name was found for y\.pdf after 5 attempts\. Nothing was overwritten\./u);
  assert.equal(f.state.attempts.length, MAX_ATTACHMENT_CREATE_ATTEMPTS);
  assert.equal([...f.bytes.keys()].every((path) => path !== "Files/y.pdf"), true, "no attachment was created");
  assert.equal(f.state.removals, 0);
});

test("A12 an unrelated I/O failure is not retried", async () => {
  const f = await fixture();
  f.state.ioFailure = true;
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["z.pdf"])), /could not be copied to Files\/z\.pdf/u);
  assert.deepEqual(f.state.attempts, ["Files/z.pdf"]);
});

test("A12 an I/O failure with a competing case-equivalent path stops at once and keeps the old bytes", async () => {
  const f = await fixture();
  f.state.ioFailure = true;
  f.state.beforeCreate = () => { f.occupy("IO.PDF", [6, 6]); };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["io.pdf"])), (error: unknown) => {
    assert.match((error as Error).message, /^The attachment could not be copied to Files\/io\.pdf\.$/u);
    return true;
  });
  assert.deepEqual(f.state.attempts, ["Files/io.pdf"], "occupancy alone is not proof of a collision");
  assert.deepEqual(f.bytes.get("Files/IO.PDF"), [6, 6]);
});

test("A12 an explicit EIO code wins over a message that mentions 'already exists'", async () => {
  const f = await fixture();
  f.state.ioFailure = true;
  f.state.ioError = Object.assign(new Error("EIO: write failed, Files/already exists.pdf"), { code: "EIO" });
  f.state.beforeCreate = () => { f.occupy("EIO.PDF", [4, 4]); };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["eio.pdf"])), /could not be copied to Files\/eio\.pdf/u);
  assert.deepEqual(f.state.attempts, ["Files/eio.pdf"]);
  assert.deepEqual(f.bytes.get("Files/EIO.PDF"), [4, 4]);
});

test("A13 a second-file race exhaustion keeps and links the first file once", async () => {
  const f = await fixture();
  f.state.beforeCreate = (path) => { if (path.includes("two")) f.occupy(path.slice("Files/".length).toUpperCase(), [3]); };
  const created = await f.plugin.attachFilesToNote(f.note, batch(["one.pdf", "two.pdf", "three.pdf"]));
  assert.deepEqual(created.map((file) => file.path), ["Files/one.pdf"]);
  assert.equal(f.state.attempts.filter((path) => path.includes("three")).length, 0, "no later file is attempted");
  assert.equal(f.markdown().match(/\[\[Files\/one\.pdf\]\]/gu)?.length, 1);
  assert.equal(f.state.removals, 0);
});

test("A13 the same failure with a failing insertion keeps the first file as terminal recovery", async () => {
  const f = await fixture();
  f.state.beforeCreate = (path) => { if (path.includes("two")) f.occupy(path.slice("Files/".length).toUpperCase(), [3]); };
  (f.plugin as unknown as { app: { fileManager: { generateMarkdownLink: () => string } } }).app.fileManager.generateMarkdownLink = () => {
    throw new Error("simulated link failure");
  };
  await assert.rejects(f.plugin.attachFilesToNote(f.note, batch(["one.pdf", "two.pdf"])), (error: unknown) => {
    assert.ok(error instanceof AttachmentLinkInsertionError);
    assert.deepEqual(error.copiedPaths, ["Files/one.pdf"]);
    return true;
  });
  assert.equal(f.state.removals, 0);
});
