import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "./support/obsidian-stub.ts";
import { migrateData } from "../src/model.ts";
import { startE05Host, type E05Host, type ResolvedLinks } from "./support/e05-host.ts";

/**
 * E05 follow-up 3: targeted backlink invalidation. Work is counted on the
 * synthetic host (resolvedLinks root enumerations and per-source reads), never
 * timed.
 */
const TARGET = "Knowledge/Indexed.md";
const OTHER_TARGET = "Knowledge/Second.md";
const SOURCE_COUNT = 200;

function sourcePath(index: number): string {
  return `Journal/Source ${String(index).padStart(3, "0")}.md`;
}

async function backlinkHost(): Promise<E05Host & { sources: TFile[] }> {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.directIndexPaths = [TARGET, OTHER_TARGET];
  const sources = Array.from({ length: SOURCE_COUNT }, (_, index) => new TFile(sourcePath(index)));
  const files = [new TFile(TARGET), new TFile(OTHER_TARGET), ...sources];
  const resolvedLinks: ResolvedLinks = {};
  for (const source of sources) resolvedLinks[source.path] = {};
  resolvedLinks[sourcePath(0)] = { [TARGET]: 1 };
  resolvedLinks[sourcePath(1)] = { [TARGET]: 2, [OTHER_TARGET]: 1 };
  const host = await startE05Host({ data, files, resolvedLinks });
  return Object.assign(host, { sources });
}

const sorted = (paths: readonly string[]): string[] => [...paths].sort();

test("control: the lazy backlink build enumerates the graph once and answers exactly", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  assert.deepEqual(host.plugin.getBacklinkPaths(OTHER_TARGET), [sourcePath(1)]);
  assert.equal(host.counters.resolvedRootEnumerations, 1, "initial lazy build may enumerate once");
  assert.deepEqual(host.plugin.getBacklinkPaths("Knowledge/Nothing.md"), []);
  assert.equal(host.counters.resolvedRootEnumerations, 1, "a warm index is not rebuilt");
});

test("an unrelated source with identical destinations does not rescan the whole graph", async () => {
  const host = await backlinkHost();
  const before = sorted(host.plugin.getBacklinkPaths(TARGET));
  host.resetCounters();

  // Body-only edit: same destinations, per-file resolve follows changed.
  host.emitMetadata("changed", host.sources[0]);
  host.emitMetadata("resolve", host.sources[0]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), before, "exact results are unchanged");
  assert.equal(host.counters.resolvedRootEnumerations, 0, "no resolvedLinks root enumeration for one source");
  assert.ok(host.counters.resolvedSourceReads <= 4, `bounded per-source reads, saw ${host.counters.resolvedSourceReads} of ${SOURCE_COUNT}`);
});

test("a source with no links does not rescan the whole graph", async () => {
  const host = await backlinkHost();
  host.plugin.getBacklinkPaths(TARGET);
  host.resetCounters();
  host.emitMetadata("changed", host.sources[50]);
  host.emitMetadata("resolve", host.sources[50]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  assert.equal(host.counters.resolvedRootEnumerations, 0);
  assert.ok(host.counters.resolvedSourceReads <= 4);
});

test("control: one changed source adds and removes targets; count above one is one source", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  host.scheduledRefreshes.length = 0;

  // Source 2 (outside every knowledge base) gains a link with count 3 to TARGET.
  host.resolvedLinks[sourcePath(2)] = { [TARGET]: 3 };
  host.emitMetadata("changed", host.sources[2]);
  host.emitMetadata("resolve", host.sources[2]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1), sourcePath(2)]);
  assert.ok(host.scheduledRefreshes.length >= 1, "the visible inspector is told to redraw");

  // It then drops TARGET and links OTHER_TARGET instead: every affected target updates.
  host.scheduledRefreshes.length = 0;
  host.resolvedLinks[sourcePath(2)] = { [OTHER_TARGET]: 1 };
  host.emitMetadata("changed", host.sources[2]);
  host.emitMetadata("resolve", host.sources[2]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(OTHER_TARGET)), [sourcePath(1), sourcePath(2)]);

  // Removing the final outside backlink also refreshes the visible inspector.
  host.scheduledRefreshes.length = 0;
  host.resolvedLinks[sourcePath(0)] = {};
  host.emitMetadata("changed", host.sources[0]);
  host.emitMetadata("resolve", host.sources[0]);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), [sourcePath(1)]);
  assert.ok(host.scheduledRefreshes.length >= 1);
});

test("changed before the per-file resolve: edges updated later are still seen without another changed event", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);

  // Official ordering (obsidian.d.ts): `changed` fires while resolvedLinks still holds the OLD edges.
  host.emitMetadata("changed", host.sources[0]);
  // The inspector redraws in between and reads the (still old) graph.
  host.plugin.getBacklinkPaths(TARGET);
  host.plugin.getBacklinkPaths(OTHER_TARGET);
  // Then Obsidian updates the graph and fires the per-file resolve; no further changed event.
  host.resolvedLinks[sourcePath(0)] = { [OTHER_TARGET]: 1 };
  host.emitMetadata("resolve", host.sources[0]);

  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), [sourcePath(1)], "old edge dropped after the later resolve");
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(OTHER_TARGET)), [sourcePath(0), sourcePath(1)], "new edge added after the later resolve");
});

test("control: changed then resolve with no lookup in between is exact", async () => {
  const host = await backlinkHost();
  host.plugin.getBacklinkPaths(TARGET);
  host.emitMetadata("changed", host.sources[0]);
  host.resolvedLinks[sourcePath(0)] = { [OTHER_TARGET]: 1 };
  host.emitMetadata("resolve", host.sources[0]);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), [sourcePath(1)]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(OTHER_TARGET)), [sourcePath(0), sourcePath(1)]);
});

test("a later global resolved event (graph updated after modifications) refreshes reverse edges", async () => {
  const host = await backlinkHost();
  host.plugin.getBacklinkPaths(TARGET);
  // The first `resolved` was consumed by startup; Obsidian fires it again after later modifications.
  host.resolvedLinks[sourcePath(3)] = { [TARGET]: 1 };
  host.emitMetadata("resolved");
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1), sourcePath(3)]);
});

test("removing the genuinely last backlink empties the target and a LATE resolve still refreshes the inspector", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  // Both sources drop TARGET. Obsidian fires changed first, the graph updates, then resolve.
  host.emitMetadata("changed", host.sources[0]);
  host.emitMetadata("changed", host.sources[1]);
  host.scheduledRefreshes.length = 0;
  delete host.resolvedLinks[sourcePath(0)]?.[TARGET];
  delete host.resolvedLinks[sourcePath(1)]?.[TARGET];
  host.emitMetadata("resolve", host.sources[0]);
  host.emitMetadata("resolve", host.sources[1]);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), [], "no backlink remains");
  assert.ok(host.scheduledRefreshes.length >= 1, "the late resolve requests a redraw of the visible inspector");
  assert.deepEqual(host.plugin.getBacklinkPaths(OTHER_TARGET), [sourcePath(1)], "unaffected targets keep their sources");
});

test("control: source delete keeps the remaining sources", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  delete host.resolvedLinks[sourcePath(0)];
  host.emitVault("delete", host.sources[0]);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), [sourcePath(1)]);
  assert.deepEqual(host.plugin.getBacklinkPaths(OTHER_TARGET), [sourcePath(1)]);
});

test("control: repeated source renames never retain retired source paths", async () => {
  const host = await backlinkHost();
  host.plugin.getBacklinkPaths(TARGET);
  const renamed = host.sources[0];
  let previous = renamed.path;
  for (let index = 0; index < 40; index += 1) {
    const next = `Journal/Renamed ${index}.md`;
    host.resolvedLinks[next] = host.resolvedLinks[previous] ?? {};
    delete host.resolvedLinks[previous];
    renamed.path = next;
    host.emitVault("rename", renamed, previous);
    host.emitMetadata("resolve", renamed);
    previous = next;
  }
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [previous, sourcePath(1)].sort());
});

test("control: target rename moves the reverse edges and drops the old target", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  const target = host.files.find((file) => file.path === TARGET);
  assert.ok(target);
  const renamedTo = "Knowledge/Indexed renamed.md";
  for (const source of [sourcePath(0), sourcePath(1)]) {
    const edges = host.resolvedLinks[source] ?? {};
    if (edges[TARGET] !== undefined) {
      edges[renamedTo] = edges[TARGET];
      delete edges[TARGET];
    }
  }
  target.path = renamedTo;
  host.emitVault("rename", target, TARGET);
  host.emitMetadata("resolve", host.sources[0]);
  host.emitMetadata("resolve", host.sources[1]);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), []);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(renamedTo)), [sourcePath(0), sourcePath(1)]);
});

test("control: target delete then recreation restores its reverse edges exactly", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  const target = host.files.find((file) => file.path === TARGET);
  assert.ok(target);
  // Deleted: Obsidian keeps the unresolved edge out of resolvedLinks.
  for (const source of [sourcePath(0), sourcePath(1)]) delete (host.resolvedLinks[source] ?? {})[TARGET];
  host.files.splice(host.files.indexOf(target), 1);
  assert.equal(host.app.vault.getAbstractFileByPath(TARGET), null, "the vault no longer resolves the deleted target");
  host.emitVault("delete", target);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), []);
  // Recreated as a new file object: sources resolve to it again.
  const recreated = new TFile(TARGET);
  host.files.push(recreated);
  assert.equal(host.app.vault.getAbstractFileByPath(TARGET), recreated);
  for (const source of [sourcePath(0), sourcePath(1)]) (host.resolvedLinks[source] ?? {})[TARGET] = 1;
  host.emitVault("create", recreated);
  host.emitMetadata("resolve", host.sources[0]);
  host.emitMetadata("resolve", host.sources[1]);
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
});

test("control: a replaced resolvedLinks object (new identity on metadataCache) is read on the next lookup", async () => {
  const host = await backlinkHost();
  assert.deepEqual(sorted(host.plugin.getBacklinkPaths(TARGET)), [sourcePath(0), sourcePath(1)]);
  const identityBefore = host.app.metadataCache.resolvedLinks;
  host.replaceResolvedLinks({ [sourcePath(7)]: { [TARGET]: 1 } });
  assert.notEqual(host.app.metadataCache.resolvedLinks, identityBefore, "the exposed object is genuinely replaced");
  host.emitMetadata("changed", host.sources[7]);
  host.emitMetadata("resolve", host.sources[7]);
  assert.deepEqual(host.plugin.getBacklinkPaths(TARGET), [sourcePath(7)]);
});
