import assert from "node:assert/strict";
import test from "node:test";
import { TAbstractFile, TFile, TFolder } from "./support/obsidian-stub.ts";
import EntVaultCommandCenterPlugin, { type LibraryKnowledgeNoteCreationPolicy } from "../src/main.ts";
import { createDefaultStore, migrateData, type LibraryDefinition } from "../src/model.ts";

interface PluginTestAccess {
  loadedData: unknown;
}

/** Titles whose sanitized basename would be empty, dot-only or hidden. */
const INVALID_TITLES: Array<[string, string]> = [
  ["leading dot", ".draft"],
  ["dot only", "."],
  ["double dot", ".."],
  ["triple dot", "..."],
  ["whitespace only", "   \t  "],
  ["leading whitespace then dot", "   .draft"],
  ["zero-width prefix", "​.draft"],
  ["control prefix", "\u0007.draft"],
  ["non-breaking space prefix", " .draft"],
  ["sanitized empty (format only)", "​‍"],
  ["dots and spaces", ". . ."],
  ["extension-like", ".md"],
];

async function harness() {
  const templateFolder = new TFolder("Templates");
  const template = new TFile("Templates/Example.md");
  templateFolder.children.push(template);
  const entries = new Map<string, TAbstractFile>([
    [templateFolder.path, templateFolder],
    [template.path, template],
    ["Research", new TFolder("Research")],
  ]);
  const counts = { create: 0, createFolder: 0, adapterWrite: 0, process: 0 };
  const created: string[] = [];
  const app = {
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    vault: {
      configDir: ".obsidian",
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      getMarkdownFiles: () => [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile && entry.extension === "md"),
      cachedRead: async () => "# {{title}}\n",
      read: async () => "# {{title}}\n",
      createFolder: async (path: string) => {
        counts.createFolder += 1;
        const folder = new TFolder(path);
        entries.set(path, folder);
        return folder;
      },
      create: async (path: string) => {
        counts.create += 1;
        created.push(path);
        const file = new TFile(path);
        entries.set(path, file);
        const parent = entries.get(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
        if (parent instanceof TFolder) parent.children.push(file);
        return file;
      },
      process: async () => { counts.process += 1; },
      adapter: { write: async () => { counts.adapterWrite += 1; } },
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, resolvedLinks: {} },
    fileManager: { trashFile: async (file: TAbstractFile) => { entries.delete(file.path); } },
  };
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.templatesFolder = "Templates";
  data.settings.proposalFolder = "Proposals";
  const library: LibraryDefinition = {
    id: "library-research", name: "Research", singularName: "Paper", icon: "microscope",
    order: 0, sourceKind: null, archivedAt: null,
  };
  const target = { headingId: "heading-evidence", subheadingId: "sub-guidelines" };
  data.portableIndex.libraries = [library];
  data.portableIndex.libraryLayouts[library.id] = [{
    id: target.headingId, title: "Evidence", collapsed: false, subjects: [],
    subheadings: [{ id: target.subheadingId, title: "Guidelines", collapsed: false, subjects: [] }],
  }];
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  (plugin as unknown as PluginTestAccess).loadedData = createDefaultStore(data, 1, "vault-new-note-basename");
  await plugin.loadPluginData(false);
  plugin.refreshViews = async () => {};
  const policy = (): LibraryKnowledgeNoteCreationPolicy => ({
    openedData: plugin.data,
    openedBaseId: plugin.getActiveKnowledgeBaseId(),
    openedDataEpoch: plugin.getDataEpoch(),
    openedExternalChangeGeneration: plugin.getExternalChangeGeneration(),
  });
  return { plugin, entries, counts, created, library, target, policy };
}

function noWrites(counts: { create: number; createFolder: number; adapterWrite: number; process: number }, label: string): void {
  assert.deepEqual(counts, { create: 0, createFolder: 0, adapterWrite: 0, process: 0 }, label);
}

const topic = (title: string) => ({
  title, domain: "Laryngology", parentPath: "", topicKind: "condition", priority: "P2",
  safetyCritical: false, curriculumId: "", addToCollection: false,
});

test("N1: hidden, dot-only and empty new-note basenames are rejected before any write on every creation route", async (t) => {
  for (const [label, title] of INVALID_TITLES) await t.test(label, async () => {
    for (const mode of ["empty", "template"] as const) {
      const value = { title, folder: "Missing/Sub", mode, templatePath: mode === "template" ? "Templates/Example.md" : "", addToCollection: false };
      const fixture = await harness();
      const message = `${label} / generic ${mode}`;
      assert.ok(fixture.plugin.validateGenericNote(value), `${message}: form error`);
      await assert.rejects(fixture.plugin.createKnowledgeNote(value), /title|name|filename/iu, message);
      noWrites(fixture.counts, message);
      assert.equal(fixture.entries.has("Missing"), false, message);
    }
    const library = await harness();
    const libraryValue = { title, folder: "Research/New", mode: "empty" as const, templatePath: "", addToCollection: false };
    await assert.rejects(
      library.plugin.createKnowledgeNoteInLibrary(libraryValue, library.library.id, library.target, library.policy()),
      /title|name|filename/iu,
      `${label} / library`,
    );
    noWrites(library.counts, `${label} / library`);
    const proposal = await harness();
    assert.ok(proposal.plugin.validateProposal(topic(title)), `${label}: proposal form error`);
    await assert.rejects(proposal.plugin.createProposal(topic(title)), /title|name|filename/iu, `${label} / proposal`);
    noWrites(proposal.counts, `${label} / proposal`);
    assert.equal(proposal.entries.has("Proposals"), false, `${label} / proposal folder`);
  });
});

test("N2: internal dots and Unicode titles still create the Markdown note", async () => {
  for (const title of ["Ward round 2024.01.15", "Node.js", "Résumé of cases"]) {
    const fixture = await harness();
    assert.equal(fixture.plugin.validateGenericNote({ title, folder: "Research", mode: "empty", templatePath: "", addToCollection: false }), null, title);
    const file = await fixture.plugin.createKnowledgeNote({ title, folder: "Research", mode: "empty", templatePath: "", addToCollection: false });
    assert.equal(file.path, `Research/${title}.md`);
    assert.deepEqual(fixture.created, [`Research/${title}.md`]);
  }
  const proposal = await harness();
  const file = await proposal.plugin.createProposal(topic("Ward round 2024.01.15"));
  assert.equal(file.path, "Proposals/Ward round 2024.01.15.md");
});

test("N3: a valid note into a missing folder creates the folder once and never overwrites an existing note", async () => {
  const fixture = await harness();
  const value = { title: "Fresh", folder: "Missing", mode: "empty" as const, templatePath: "", addToCollection: false };
  await fixture.plugin.createKnowledgeNote(value);
  assert.equal(fixture.counts.createFolder, 1);
  assert.equal(fixture.counts.create, 1);
  await assert.rejects(fixture.plugin.createKnowledgeNote(value), /already exists/iu);
  assert.equal(fixture.counts.create, 1, "existing note is neither renamed nor overwritten");
});
