import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "./support/obsidian-stub.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { cloneJsonValue, DEFAULT_DATA, migrateData, type PluginData, type VaultRecord } from "../src/model.ts";
import { startE05Host } from "./support/e05-host.ts";

/**
 * E05 follow-up 1: with no unresolved placeholders the Smart Queues / tab badge
 * must not project eligible-note candidates (enumeration + metadata reads).
 * Counters on the synthetic host, never wall-clock time. Red tests carry
 * node:test `todo` until the implementation lands.
 */
const PENDING = { todo: "E05 implementation pending" } as const;

function record(path: string, options: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path, title: "Laryngomalacia", kind: "topic", role: "canonical", curriculumId: "ENT-PED-001", domain: "Airway", topicKind: "condition",
    priority: "", reviewStatus: "", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "", mtime: 0, aiLock: false,
    ...options,
  };
}

interface ViewSeam {
  app: unknown;
  plugin: unknown;
  records: VaultRecord[];
  recordByPath: Map<string, VaultRecord>;
  placeholderQueueCache: null;
  smartQueues(): Array<{ id: string; title: string; description: string; records: VaultRecord[] }>;
  tabCount(tab: string): number;
}

interface Fixture {
  view: ViewSeam;
  data: PluginData;
  counters: { enumerations: number; metadataReads: number };
  /** Simulates any metadata/inventory change the plugin reports through its generation token. */
  bumpGeneration(): void;
  setRecords(records: VaultRecord[]): void;
}

const outsideFiles = (count: number): Array<{ path: string; basename: string }> => Array.from({ length: count }, (_, index) => ({
  path: `Other/${String(index).padStart(3, "0")}.md`,
  basename: `Other ${index}`,
}));

function fixture(setup: (data: PluginData) => VaultRecord[], files = outsideFiles(40)): Fixture {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.portableIndex.groups = [{ id: "airway", title: "Airway", order: 0 }];
  const records = setup(data);
  const counters = { enumerations: 0, metadataReads: 0 };
  let generation = 1;
  const view = Object.create(EntVaultCommandCenterView.prototype) as ViewSeam;
  view.app = { metadataCache: { getFileCache(): null { counters.metadataReads += 1; return null; } } };
  view.plugin = {
    data,
    isClinicalMode: () => false,
    getActiveKnowledgeBaseId: () => "base-a",
    getVaultNoteGeneration: () => generation,
    getVaultNoteFiles: () => { counters.enumerations += 1; return files; },
  };
  view.placeholderQueueCache = null;
  const fixtureValue: Fixture = {
    view, data, counters,
    bumpGeneration: () => { generation += 1; },
    setRecords: (next) => { view.records = next; view.recordByPath = new Map(next.map((item) => [item.path, item])); },
  };
  fixtureValue.setRecords(records);
  return fixtureValue;
}

function subject(id: string, title: string, configuredId = "") {
  return { id, title, groupId: "airway", parentId: null, order: 0, indexed: true, configuredId, recordKind: "topic" as const, libraryId: null };
}

/** Every subject is bound to a live, non-placeholder note: zero effective unresolved subjects. */
function allResolvedSetup(data: PluginData): VaultRecord[] {
  data.portableIndex.subjects = [subject("s-one", "Laryngomalacia", "ENT-PED-001"), subject("s-two", "Stridor")];
  data.portableIndex.resolvedPathBySubjectId = { "s-one": "Notes/Laryngomalacia.md", "s-two": "Notes/Stridor.md" };
  return [
    record("Notes/Laryngomalacia.md", { portableId: "s-one", portableIndexed: true }),
    record("Notes/Stridor.md", { title: "Stridor", curriculumId: "", portableId: "s-two", portableIndexed: true }),
  ];
}

const otherQueues = (queues: ReturnType<ViewSeam["smartQueues"]>): Array<[string, string[]]> => (
  queues.filter((queue) => queue.id !== "imported-placeholders").map((queue) => [queue.id, queue.records.map((item) => item.path)])
);

test("zero unresolved subjects: cold, warm and a generation change project no eligible-note candidates", PENDING, () => {
  const fx = fixture(allResolvedSetup);
  const cold = fx.view.smartQueues();
  assert.equal(cold[0]?.id, "imported-placeholders");
  assert.deepEqual(cold[0]?.records, []);
  assert.match(cold[0]?.description ?? "", /^0 unresolved subjects; 0 have exact local title or ID candidates\./u);
  assert.equal(fx.counters.enumerations, 0, "cold: no getVaultNoteFiles enumeration");
  assert.equal(fx.counters.metadataReads, 0, "cold: no candidate metadata projection");

  fx.view.smartQueues();
  assert.equal(fx.view.tabCount("queues"), uniqueCount(fx.view.smartQueues()));
  assert.equal(fx.counters.enumerations, 0, "warm: still none");
  assert.equal(fx.counters.metadataReads, 0);

  fx.bumpGeneration(); // one metadata-generation change
  fx.view.smartQueues();
  assert.equal(fx.counters.enumerations, 0, "after a generation change: still none");
  assert.equal(fx.counters.metadataReads, 0);
});

test("zero subjects at all (default blueprint): no candidate projection either", PENDING, () => {
  const fx = fixture(() => [record("Notes/Only.md")]);
  assert.deepEqual(fx.view.smartQueues()[0]?.records, []);
  assert.match(fx.view.smartQueues()[0]?.description ?? "", /^0 unresolved subjects/u);
  assert.equal(fx.counters.enumerations, 0);
  assert.equal(fx.counters.metadataReads, 0);
});

test("control: the zero-placeholder badge and the other queues are unchanged", () => {
  const fx = fixture((data) => {
    const records = allResolvedSetup(data);
    data.pinnedPaths = ["Notes/Stridor.md"];
    data.nextStudyPaths = ["Notes/Laryngomalacia.md"];
    return records;
  });
  const queues = fx.view.smartQueues();
  const placeholder = queues[0];
  assert.equal(placeholder?.id, "imported-placeholders");
  assert.deepEqual(placeholder?.records, []);
  assert.match(placeholder?.description ?? "", /^0 unresolved subjects; 0 have exact local title or ID candidates\. Choose each subject/u);
  assert.deepEqual(otherQueues(queues).find(([id]) => id === "pinned"), ["pinned", ["Notes/Stridor.md"]]);
  assert.deepEqual(otherQueues(queues).find(([id]) => id === "next"), ["next", ["Notes/Laryngomalacia.md"]]);
  assert.equal(fx.view.tabCount("queues"), uniqueCount(queues));
  assert.equal(uniqueCount(queues), 2, "only the pinned and next-list notes are queued");
});

test("control: a deleted-linked placeholder is recognised with a non-empty binding map", () => {
  const placeholderPath = "Notes/Deleted Laryngomalacia.md";
  const fx = fixture((data) => {
    data.portableIndex.subjects = [subject("s-gone", "Laryngomalacia", "ENT-PED-001"), subject("s-live", "Stridor")];
    // Both subjects are bound: the binding map is non-empty and has no empty-binding subject.
    data.portableIndex.resolvedPathBySubjectId = { "s-gone": placeholderPath, "s-live": "Notes/Stridor.md" };
    return [
      record(placeholderPath, { role: "placeholder", isPlaceholder: true, portableId: "s-gone", portableIndexed: true }),
      record("Notes/Stridor.md", { title: "Stridor", curriculumId: "", portableId: "s-live", portableIndexed: true }),
      record("Notes/Laryngomalacia.md"),
    ];
  }, [{ path: "Notes/Laryngomalacia.md", basename: "Laryngomalacia" }, ...outsideFiles(10)]);
  const queue = fx.view.smartQueues()[0];
  assert.deepEqual(queue?.records.map((item) => item.path), [placeholderPath]);
  assert.match(queue?.description ?? "", /^1 unresolved subject; 1 has exact local title or ID candidates/u);
  assert.ok(fx.counters.enumerations >= 1, "projection still runs because a projected placeholder exists");
  assert.deepEqual(fx.data.portableIndex.resolvedPathBySubjectId, { "s-gone": placeholderPath, "s-live": "Notes/Stridor.md" }, "opening a queue never links a note");
});

test("control: an unbound subject keeps its exact title candidate and the cached render reuses the projection", () => {
  const fx = fixture((data) => {
    data.portableIndex.subjects = [subject("s-open", "Zebra condition")];
    data.portableIndex.resolvedPathBySubjectId = {};
    return [record("kbcc-placeholder:s-open", { title: "Zebra condition", role: "placeholder", isPlaceholder: true, portableId: "s-open", portableIndexed: true })];
  }, [{ path: "Other/Zebra condition.md", basename: "Zebra condition" }, ...outsideFiles(10)]);
  assert.match(fx.view.smartQueues()[0]?.description ?? "", /^1 unresolved subject; 1 has exact local title or ID candidates/u);
  const reads = fx.counters.metadataReads;
  assert.ok(reads > 0);
  fx.view.smartQueues();
  assert.equal(fx.counters.enumerations, 1, "same records, base, generation and settings: the cache is reused");
  assert.equal(fx.counters.metadataReads, reads);
});

test("control: a generation change, a settings change and a records replacement each invalidate a non-empty queue", () => {
  const fx = fixture((data) => {
    data.portableIndex.subjects = [subject("s-open", "Zebra condition")];
    return [record("kbcc-placeholder:s-open", { title: "Zebra condition", role: "placeholder", isPlaceholder: true, portableId: "s-open", portableIndexed: true })];
  }, [{ path: "Other/Zebra condition.md", basename: "Zebra condition" }]);
  fx.view.smartQueues();
  assert.equal(fx.counters.enumerations, 1);
  fx.bumpGeneration();
  fx.view.smartQueues();
  assert.equal(fx.counters.enumerations, 2, "metadata generation change recomputes");
  fx.data.settings.idProperty = "alternate_id";
  fx.view.smartQueues();
  assert.equal(fx.counters.enumerations, 3, "candidate-affecting settings change recomputes");
  fx.setRecords([...(fx.view.records)]);
  fx.view.smartQueues();
  assert.equal(fx.counters.enumerations, 4, "base/records replacement recomputes");
});

test("control: the zero-placeholder skip must reopen when a bound note disappears (projected placeholder appears)", () => {
  const fx = fixture(allResolvedSetup);
  fx.view.smartQueues();
  // The bound note is deleted: the plugin re-projects that subject as a placeholder record.
  fx.setRecords([
    record("Notes/Laryngomalacia.md", { role: "placeholder", isPlaceholder: true, portableId: "s-one", portableIndexed: true }),
    record("Notes/Stridor.md", { title: "Stridor", curriculumId: "", portableId: "s-two", portableIndexed: true }),
  ]);
  fx.bumpGeneration();
  const queue = fx.view.smartQueues()[0];
  assert.deepEqual(queue?.records.map((item) => item.path), ["Notes/Laryngomalacia.md"]);
  assert.match(queue?.description ?? "", /^1 unresolved subject;/u);
});

function uniqueCount(queues: ReturnType<ViewSeam["smartQueues"]>): number {
  return new Set(queues.flatMap((queue) => queue.records.map((item) => item.path))).size;
}

// ---- real plugin: the candidate-freshness token and an end-to-end title/ID edit ----

async function placeholderHost() {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.primaryFolder = "Knowledge";
  data.portableIndex.groups = [{ id: "airway", title: "Airway", order: 0 }];
  data.portableIndex.subjects = [subject("s-open", "Zebra condition", "ZEB-001")];
  const outside = new TFile("Journal/Unindexed.md");
  const host = await startE05Host({
    data,
    files: [outside],
    frontmatter: { [outside.path]: { title: "Something else" } },
  });
  return { host, outside };
}

interface QueueView { smartQueues(): Array<{ id: string; description: string }> }
function realView(host: Awaited<ReturnType<typeof startE05Host>>): QueueView {
  const view = Object.create(EntVaultCommandCenterView.prototype) as ViewSeam & QueueView;
  const records = host.plugin.getRecords();
  Object.assign(view, {
    app: host.app,
    plugin: host.plugin,
    records,
    recordByPath: new Map(records.map((item) => [item.path, item])),
    placeholderQueueCache: null,
  });
  return view;
}

const candidateText = (view: QueueView): string => view.smartQueues().find((queue) => queue.id === "imported-placeholders")?.description ?? "";

test("control: an outside-note metadata change advances the candidate-freshness token without any create/delete", async () => {
  const { host, outside } = await placeholderHost();
  const before = host.plugin.getVaultNoteGeneration();
  host.frontmatter[outside.path] = { title: "Zebra condition" };
  host.emitMetadata("changed", outside);
  assert.notEqual(host.plugin.getVaultNoteGeneration(), before, "title edit on an outside note must invalidate candidates");
  const afterTitle = host.plugin.getVaultNoteGeneration();
  host.frontmatter[outside.path] = { title: "Zebra condition", [host.plugin.data.settings.idProperty]: "ZEB-001" };
  host.emitMetadata("changed", outside);
  assert.notEqual(host.plugin.getVaultNoteGeneration(), afterTitle, "configured-ID edit must invalidate candidates");
});

test("control: outside title, then configured-ID edits refresh exact candidates (false to match and back)", async () => {
  const { host, outside } = await placeholderHost();
  const view = realView(host);
  assert.match(candidateText(view), /^1 unresolved subject; 0 have exact local title or ID candidates/u);

  host.frontmatter[outside.path] = { title: "Zebra condition" };
  host.emitMetadata("changed", outside);
  assert.match(candidateText(view), /^1 unresolved subject; 1 has exact local title or ID candidates/u, "false to match by title");

  host.frontmatter[outside.path] = { title: "Different again" };
  host.emitMetadata("changed", outside);
  assert.match(candidateText(view), /^1 unresolved subject; 0 have exact/u, "match to false by title");

  host.frontmatter[outside.path] = { title: "Different again", [host.plugin.data.settings.idProperty]: "ZEB-001" };
  host.emitMetadata("changed", outside);
  assert.match(candidateText(view), /^1 unresolved subject; 1 has exact/u, "false to match by configured ID");

  host.frontmatter[outside.path] = { title: "Different again" };
  host.emitMetadata("changed", outside);
  assert.match(candidateText(view), /^1 unresolved subject; 0 have exact/u, "match to false by configured ID");
  assert.deepEqual(host.plugin.data.portableIndex.resolvedPathBySubjectId, {}, "reading candidates never links a note");
});
