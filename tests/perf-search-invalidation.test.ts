import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "./support/obsidian-stub.ts";
import { createDefaultStore, createKnowledgeBaseEntry, migrateData, type PluginData } from "../src/model.ts";
import { startE05Host, type E05Host } from "./support/e05-host.ts";

/**
 * E05 follow-up 3 (search half): an unrelated Markdown metadata edit must not
 * discard a valid Generic search or its inventory, while every relevant edit
 * keeps full freshness and generation fencing. Counters, not timing.
 */
const ID_PROPERTY = migrateData(null).settings.idProperty;
const QUICK = { yieldEvery: Number.MAX_SAFE_INTEGER } as const;

function genericBase(name: string, folder: string): PluginData {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.workspaceName = name;
  data.settings.primaryFolder = folder;
  data.indexFolderSources = [{ id: `src-${folder}`, path: folder, origin: "user" }];
  return data;
}

interface SearchHost { host: E05Host; active: TFile; inactive: TFile; outsideRef: TFile; unrelated: TFile }

async function searchHost(options: { clinicalInactive?: boolean } = {}): Promise<SearchHost> {
  // File names deliberately avoid the query words: only title/ID edits may change matches.
  const active = new TFile("Active/Alpha.md");
  const inactive = new TFile("Inactive/Beta.md");
  const outsideRef = new TFile("Library/Gamma.md");
  const unrelated = new TFile("Journal/Today.md");
  const first = genericBase("Active base", "Active");
  first.directIndexPaths = [outsideRef.path];
  const second = options.clinicalInactive ? migrateData(null) : genericBase("Inactive base", "Inactive");
  if (options.clinicalInactive) {
    second.settings.workspaceMode = "ent-clinical";
    second.settings.workspaceName = "Clinical base";
    second.settings.primaryFolder = "Clinical Topics";
    second.settings.proposalFolder = "Inbox/Topic Proposals";
  }
  const store = createDefaultStore(first, 1, "vault-e05-search");
  store.bases.push(createKnowledgeBaseEntry(second, "base-second", 2));
  const files = [active, inactive, outsideRef, unrelated].sort((a, b) => a.path < b.path ? -1 : 1);
  const host = await startE05Host({
    data: store,
    files,
    frontmatter: {
      [active.path]: { title: "Zebra active" },
      [inactive.path]: { title: "Zebra inactive" },
      [outsideRef.path]: { title: "Zebra library" },
      [unrelated.path]: { title: "Daily journal" },
    },
  });
  return { host, active, inactive, outsideRef, unrelated };
}

type Searchable = {
  searchKnowledgeBases(query: string, options?: { yieldEvery?: number }): Promise<{
    total: number;
    groups: Array<{ records: Array<{ path: string }> }>;
  } | null>;
  getSearchGeneration(): number;
};
const search = (host: E05Host, query: string, options: { yieldEvery?: number } = QUICK) => (host.plugin as unknown as Searchable).searchKnowledgeBases(query, options);
const paths = (result: Awaited<ReturnType<typeof search>>): string[] => (result?.groups.flatMap((group) => group.records.map((record) => record.path)) ?? []).sort();
const generation = (host: E05Host): number => (host.plugin as unknown as Searchable).getSearchGeneration();

test("control: the search finds the base members and the referenced outside note exactly once", async () => {
  const { host, active, inactive, outsideRef } = await searchHost();
  host.plugin.getRecords();
  const result = await search(host, "zebra");
  assert.deepEqual(paths(result), [active.path, inactive.path, outsideRef.path].sort());
});

test("an unrelated Markdown metadata edit keeps a completed search valid and rebuilds no inventory", async () => {
  const { host, unrelated } = await searchHost();
  host.plugin.getRecords();
  const first = await search(host, "zebra");
  const before = generation(host);
  const snapshotBefore = (host.plugin as unknown as { knowledgeBaseSearchVaultSnapshot: unknown }).knowledgeBaseSearchVaultSnapshot;
  host.resetCounters();

  host.frontmatter[unrelated.path] = { title: "Daily journal, edited" };
  host.emitMetadata("changed", unrelated);

  assert.equal(generation(host), before, "no global search restart for an edit outside every searchable base");
  assert.equal((host.plugin as unknown as { knowledgeBaseSearchVaultSnapshot: unknown }).knowledgeBaseSearchVaultSnapshot, snapshotBefore, "the retained inventory is not discarded");
  // The event handler itself may inspect the edited file once (clinical-proposal check).
  assert.ok(host.counters.metadataReads <= 1, "the handler reads at most the edited file");
  host.resetCounters();
  const second = await search(host, "zebra");
  assert.deepEqual(paths(second), paths(first), "exact results are unchanged");
  assert.equal(second?.total, first?.total);
  assert.equal(host.counters.enumerations, 0, "no inventory rebuilt");
  assert.equal(host.counters.metadataReads, 0, "no record preparation attributable to the edit");
});

test("an unrelated edit during a yielded search lets that search complete with exact results", async () => {
  const { host, active, inactive, outsideRef, unrelated } = await searchHost();
  host.plugin.getRecords();
  const running = search(host, "zebra", { yieldEvery: 1 });
  host.frontmatter[unrelated.path] = { title: "Daily journal, edited" };
  host.emitMetadata("changed", unrelated);
  const result = await running;
  assert.ok(result, "an irrelevant edit must not cancel a valid search");
  assert.deepEqual(paths(result), [active.path, inactive.path, outsideRef.path].sort());
});

test("control: a relevant edit during a yielded search never publishes stale results and the retry succeeds", async () => {
  const { host, inactive, active, outsideRef } = await searchHost();
  host.plugin.getRecords();
  const running = search(host, "zebra", { yieldEvery: 1 });
  host.frontmatter[inactive.path] = { title: "Quokka inactive" };
  host.emitMetadata("changed", inactive);
  assert.equal(await running, null, "fenced by the generation: cancelled, not stale");
  const retry = await search(host, "zebra");
  assert.deepEqual(paths(retry), [active.path, outsideRef.path].sort());
  assert.deepEqual(paths(await search(host, "quokka")), [inactive.path]);
});

test("control: member title then configured-ID edits (active, inactive, referenced outside note) are found exactly once", async () => {
  const { host, active, inactive, outsideRef } = await searchHost();
  host.plugin.getRecords();
  await search(host, "zebra"); // warm: the inactive base retains its projection
  for (const [index, file] of [active, inactive, outsideRef].entries()) {
    const word = ["quokka", "wombat", "numbat"][index] ?? "";
    host.frontmatter[file.path] = { title: `${word} renamed` };
    host.emitMetadata("changed", file);
    assert.deepEqual(paths(await search(host, word)), [file.path], `${file.path}: new title found once`);
    assert.equal(paths(await search(host, "zebra")).includes(file.path), false, `${file.path}: old title no longer matches`);

    const id = `E05-${index}-77`;
    host.frontmatter[file.path] = { title: `${word} renamed`, [ID_PROPERTY]: id };
    host.emitMetadata("changed", file);
    assert.deepEqual(paths(await search(host, id)), [file.path], `${file.path}: new configured ID found once`);
    host.frontmatter[file.path] = { title: `${word} renamed` };
    host.emitMetadata("changed", file);
    assert.deepEqual(paths(await search(host, id)), [], `${file.path}: old configured ID no longer matches`);
  }
});

test("control: an outside note that becomes, then stops being, a topic-proposal is discovered and removed (inactive clinical base)", async () => {
  const { host, unrelated } = await searchHost({ clinicalInactive: true });
  host.plugin.getRecords();
  assert.deepEqual(paths(await search(host, "adhoc")), []);

  host.frontmatter[unrelated.path] = { type: "topic-proposal", title: "Adhoc proposal" };
  host.emitMetadata("changed", unrelated);
  assert.deepEqual(paths(await search(host, "adhoc")), [unrelated.path], "discovered");

  host.frontmatter[unrelated.path] = { title: "Daily journal" };
  host.emitMetadata("changed", unrelated);
  assert.deepEqual(paths(await search(host, "adhoc")), [], "removed once it stops being a proposal");
});

test("control: an uncached inactive clinical base still discovers and drops an outside proposal", async () => {
  const { host, unrelated } = await searchHost({ clinicalInactive: true });
  host.plugin.getRecords();
  // No search has run, so the inactive clinical base has no retained projection at any edit.
  const internals = host.plugin as unknown as { inactiveSearchRecordsCache: Map<string, unknown>; recordsCacheByBase: Map<string, unknown> };
  assert.equal(internals.inactiveSearchRecordsCache.has("base-second"), false);
  assert.equal(internals.recordsCacheByBase.has("base-second"), false);

  host.frontmatter[unrelated.path] = { type: "topic-proposal", title: "Adhoc proposal" };
  host.emitMetadata("changed", unrelated);
  assert.deepEqual(paths(await search(host, "adhoc")), [unrelated.path], "proposal false to true discovered");

  host.frontmatter[unrelated.path] = { title: "Daily journal" };
  host.emitMetadata("changed", unrelated);
  assert.deepEqual(paths(await search(host, "adhoc")), [], "proposal true to false removed");
});

test("control: create, delete and rename keep generation fencing", async () => {
  const { host, unrelated } = await searchHost();
  host.plugin.getRecords();
  await search(host, "zebra");
  for (const [event, args] of [
    ["create", [unrelated]],
    ["delete", [unrelated]],
    ["rename", [unrelated, "Journal/Old.md"]],
  ] as const) {
    const before = generation(host);
    host.emitVault(event, ...args);
    assert.ok(generation(host) > before, `${event} advances the search generation`);
  }
});

test("cross-path independence: an unrelated edit keeps search work but still refreshes candidates and backlinks", async () => {
  const { host, unrelated } = await searchHost();
  host.plugin.getRecords();
  const searchBefore = generation(host);
  const noteBefore = host.plugin.getVaultNoteGeneration();
  host.scheduledRefreshes.length = 0;
  host.frontmatter[unrelated.path] = { title: "Zebra condition" };
  host.emitMetadata("changed", unrelated);
  assert.notEqual(host.plugin.getVaultNoteGeneration(), noteBefore, "placeholder title/ID candidates are invalidated");
  assert.equal(generation(host), searchBefore, "global search is not restarted");
  assert.ok(host.scheduledRefreshes.length >= 1, "the open view still refreshes (external backlinks, candidates)");
});
