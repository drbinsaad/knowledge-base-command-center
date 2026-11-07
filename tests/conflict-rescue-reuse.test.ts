import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { createDefaultStore, migrateData, type PluginStore } from "../src/model.ts";
import { TFile } from "./support/obsidian-stub.ts";

// D02. Synthetic data only. A cached conflict-rescue path may be reused only
// when the saved file still exists with exactly the bytes that were written.

type RescueWriter = { writeConflictRescueStore(store: PluginStore, reason: string): Promise<string> };

interface Fixture {
  plugin: EntVaultCommandCenterPlugin;
  files: Map<string, string>;
  creates: string[];
  fail: { stat: boolean; read: boolean; create: boolean };
  rescue(store: PluginStore, reason?: string): Promise<string>;
}

function fixture(): Fixture {
  const files = new Map<string, string>();
  const creates: string[] = [];
  const fail = { stat: false, read: false, create: false };
  const vault = {
    configDir: ".obsidian",
    getMarkdownFiles: (): TFile[] => [],
    getAbstractFileByPath: (path: string) => (files.has(path) ? new TFile(path) : null),
    createFolder: async (): Promise<void> => {},
    create: async (path: string, content: string): Promise<TFile> => {
      if (fail.create) throw new Error("simulated rescue disk failure");
      if (files.has(path)) throw new Error("File already exists.");
      files.set(path, content);
      creates.push(path);
      return new TFile(path);
    },
    adapter: {
      exists: async (path: string) => files.has(path),
      stat: async (path: string) => {
        if (fail.stat) throw new Error("simulated stat failure");
        const text = files.get(path);
        return text === undefined ? null : { type: "file", ctime: 0, mtime: 0, size: new TextEncoder().encode(text).length };
      },
      read: async (path: string) => {
        if (fail.read) throw new Error("simulated read failure");
        const text = files.get(path);
        if (text === undefined) throw new Error("ENOENT");
        return text;
      },
    },
  };
  const app = {
    vault,
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
    fileManager: {},
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  return {
    plugin,
    files,
    creates,
    fail,
    rescue: (store, reason = "synthetic conflict") => (plugin as unknown as RescueWriter).writeConflictRescueStore(store, reason),
  };
}

function syntheticStore(label = "Losing organization"): PluginStore {
  const data = migrateData(null);
  data.settings.workspaceName = label;
  return createDefaultStore(data, 100, "vault-d02");
}

test("D02 control: an unchanged saved rescue is reused without a second file", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  const second = await f.rescue(store);
  assert.notEqual(first, "");
  assert.equal(second, first);
  assert.equal(f.creates.length, 1);
});

test("D02: a missing rescue file is rewritten as a new verified file", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  f.files.delete(first);
  const second = await f.rescue(store);
  assert.notEqual(second, "");
  assert.equal(f.creates.length, 2, "a new rescue file was written (its free name may equal the vanished one)");
  assert.match(f.files.get(second) ?? "", /Losing organization/);
});

test("D02: a moved or renamed rescue file is not trusted at its old path", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  const moved = `${first}.moved`;
  f.files.set(moved, f.files.get(first) ?? "");
  f.files.delete(first);
  const second = await f.rescue(store);
  assert.notEqual(second, "");
  assert.match(f.files.get(second) ?? "", /Losing organization/, "a fresh file now holds the rescue at a free name");
  assert.equal(f.files.get(moved) !== undefined, true, "the moved file is untouched");
  assert.equal(f.creates.length, 2);
});

test("D02: a truncated rescue file is not trusted and is never overwritten", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  const truncated = (f.files.get(first) ?? "").slice(0, 40);
  f.files.set(first, truncated);
  const second = await f.rescue(store);
  assert.notEqual(second, first);
  assert.equal(f.files.get(first), truncated, "the damaged file is left as it is");
  assert.match(f.files.get(second) ?? "", /Losing organization/);
});

test("D02: an altered same-length rescue file is not trusted", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  const original = f.files.get(first) ?? "";
  const altered = original.replace("Losing organization", "Losing orgXnization");
  assert.equal(altered.length, original.length);
  assert.notEqual(altered, original);
  f.files.set(first, altered);
  const second = await f.rescue(store);
  assert.notEqual(second, first);
  assert.equal(f.files.get(first), altered);
  assert.equal(f.files.get(second)?.includes("Losing organization"), true);
});

test("D02: a stat failure on the cached file writes a new verified rescue", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  f.fail.stat = true;
  const second = await f.rescue(store);
  // The cached file cannot be proven, so a new file is written and proven by read-back.
  assert.notEqual(second, "");
  assert.notEqual(second, first);
  assert.equal(f.creates.length, 2);
});

test("D02: a read failure on the cached file writes a new verified rescue only when read-back succeeds", async () => {
  const f = fixture();
  const store = syntheticStore();
  await f.rescue(store);
  f.fail.read = true;
  assert.equal(await f.rescue(store), "", "read-back of the new file also fails, so it fails closed");
  f.fail.read = false;
  const again = await f.rescue(store);
  assert.notEqual(again, "");
});

test("D02: a write failure fails closed and caches nothing", async () => {
  const f = fixture();
  const store = syntheticStore();
  const first = await f.rescue(store);
  f.files.delete(first);
  f.fail.create = true;
  assert.equal(await f.rescue(store), "");
  f.fail.create = false;
  const recovered = await f.rescue(store);
  assert.notEqual(recovered, "");
  assert.match(f.files.get(recovered) ?? "", /Losing organization/);
});

test("D02: an unrelated file in the exports folder is never touched", async () => {
  const f = fixture();
  const unrelated = "Knowledge Base Exports/user-note.json";
  f.files.set(unrelated, "{\"keep\":true}\n");
  const store = syntheticStore();
  const first = await f.rescue(store);
  f.files.delete(first);
  await f.rescue(store);
  assert.equal(f.files.get(unrelated), "{\"keep\":true}\n");
});
