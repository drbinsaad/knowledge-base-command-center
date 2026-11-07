import assert from "node:assert/strict";
import test from "node:test";
import EntVaultCommandCenterPlugin, { KBCC_RETURN_NAVIGATION_STATE_KEY } from "../src/main.ts";
import { createDefaultStore, migrateData } from "../src/model.ts";
import { TFile } from "./support/obsidian-stub.ts";

type LeafArgs = unknown[];

async function fixture(behavior: "same-tab" | "split" | "new-tab", openFailure?: Error) {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.openNoteBehavior = behavior;
  const localValues = new Map<string, unknown>();
  const leafRequests: LeafArgs[] = [];
  const opened: string[] = [];
  const app = {
    vault: { configDir: ".obsidian", getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: (...args: unknown[]) => {
        leafRequests.push(args);
        return {
          openFile: async (file: TFile) => {
            if (openFailure) throw openFailure;
            opened.push(file.path);
          },
        };
      },
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }), resolvedLinks: {} },
    fileManager: {},
    loadLocalStorage: (key: string) => structuredClone(localValues.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { localValues.set(key, structuredClone(value)); },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never) as EntVaultCommandCenterPlugin & { loadedData: unknown };
  plugin.loadedData = createDefaultStore(data, 1, "vault-file-opening-test");
  await plugin.loadPluginData();
  let captures = 0;
  const sourceView = {
    captureReturnViewState: () => {
      captures += 1;
      return { activeTab: "collections", selectedPath: "Notes/a.md", query: "q", detailVisible: true, browseRowLimit: 900, browseStructureLimit: 600, listScrollTop: 5, detailScrollTop: 6 };
    },
  };
  return { plugin, leafRequests, opened, localValues, sourceView: sourceView as never, captures: () => captures };
}

test("O1 non-Markdown files opened from KBCC request a new tab for every open preference", async () => {
  for (const behavior of ["same-tab", "split", "new-tab"] as const) {
    for (const path of ["Files/Paper.pdf", "Files/Scan.PNG", "Files/data.custom", "Files/NoExtension"]) {
      const f = await fixture(behavior);
      await f.plugin.openFile(new TFile(path), f.sourceView);
      assert.deepEqual(f.leafRequests, [["tab"]], `${behavior} ${path}`);
      assert.deepEqual(f.opened, [path], "the host still performs the open");
      assert.equal(f.captures(), 0, "the origin view is not asked for a note return route");
      assert.equal(f.localValues.has(KBCC_RETURN_NAVIGATION_STATE_KEY), false);
    }
  }
});

test("O2 Markdown keeps all three open preferences and its durable return route", async () => {
  const expected: Record<string, unknown[]> = { "same-tab": [false], split: ["split", "vertical"], "new-tab": ["tab"] };
  for (const behavior of ["same-tab", "split", "new-tab"] as const) {
    const f = await fixture(behavior);
    await f.plugin.openFile(new TFile("Notes/Topic.md"), f.sourceView);
    assert.deepEqual(f.leafRequests, [expected[behavior]], behavior);
    assert.equal(f.captures(), 1);
    const durable = f.localValues.get(KBCC_RETURN_NAVIGATION_STATE_KEY) as { routes?: Array<{ notePath?: string }> } | undefined;
    assert.equal(durable?.routes?.[0]?.notePath, "Notes/Topic.md");
  }
});

test("O3 without a KBCC origin non-Markdown files keep the preference-based leaf", async () => {
  const expected: Record<string, unknown[]> = { "same-tab": [false], split: ["split", "vertical"], "new-tab": ["tab"] };
  for (const behavior of ["same-tab", "split", "new-tab"] as const) {
    const f = await fixture(behavior);
    await f.plugin.openFile(new TFile("Files/Paper.pdf"));
    assert.deepEqual(f.leafRequests, [expected[behavior]], behavior);
    assert.deepEqual(f.opened, ["Files/Paper.pdf"]);
  }
});

test("O4 an open failure rejects to the caller after requesting the new tab, with the exact path available", async () => {
  const f = await fixture("same-tab", new Error("simulated host open failure"));
  await assert.rejects(f.plugin.openFile(new TFile("Files/Paper.pdf"), f.sourceView), /simulated host open failure/u);
  assert.deepEqual(f.leafRequests, [["tab"]]);
  assert.deepEqual(f.opened, []);
});
