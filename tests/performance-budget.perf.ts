import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  createDefaultStore,
  createKnowledgeBaseEntry,
  migrateData,
  parseQuery,
  type VaultRecord,
} from "../src/model.ts";
import {
  applyNoteOrganizerPlan,
  createNoteOrganizerPlan,
  MAX_NOTE_ORGANIZER_DIRECTIVES,
  MAX_NOTE_ORGANIZER_NOTES,
  type NoteOrganizerDirective,
  type NoteOrganizerFileFact,
} from "../src/note-organizer.ts";
import { BoundedKnowledgeBaseSearchCollector, DEFAULT_CROSS_BASE_SEARCH_LIMIT } from "../src/search.ts";

const baseCount = 50;
const notesPerBase = 10_000;
const examinedBudget = baseCount * notesPerBase;
const elapsedBudgetMs = Number(process.env.KBCC_SEARCH_BUDGET_MS ?? 20_000);
if (!Number.isFinite(elapsedBudgetMs) || elapsedBudgetMs <= 0) throw new Error("KBCC_SEARCH_BUDGET_MS must be a positive number.");

function benchmarkRecord(baseIndex: number, noteIndex: number): VaultRecord {
  return {
    path: `Shared/Base ${baseIndex}/Airway topic ${noteIndex}.md`,
    title: `Airway topic ${noteIndex}`,
    kind: "topic",
    role: "canonical",
    curriculumId: `ENT-PERF-${noteIndex}`,
    domain: `Domain ${noteIndex % 20}`,
    topicKind: "condition",
    priority: noteIndex % 10 === 0 ? "P1" : "P3",
    reviewStatus: "unverified",
    synthesisStatus: "none",
    autoresearchStatus: "none",
    safetyCritical: noteIndex % 10 === 0,
    sourceCount: 1,
    aliases: [`respiratory topic ${noteIndex}`],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "traced",
    folderOrder: "",
    mtime: noteIndex,
    aiLock: false,
  };
}

test("bounded cross-base search stays within the explicit 50-base × 10,000-note budget", { timeout: elapsedBudgetMs + 10_000 }, (context) => {
  const sources = Array.from({ length: baseCount }, (_, index) => ({ baseId: `base-${index}`, baseName: `Base ${index}` }));
  const collector = new BoundedKnowledgeBaseSearchCollector(sources, parseQuery("airway topic"), DEFAULT_CROSS_BASE_SEARCH_LIMIT);
  const startedAt = performance.now();
  for (let baseIndex = 0; baseIndex < baseCount; baseIndex += 1) {
    const matchedPaths = new Set<string>();
    for (let noteIndex = 0; noteIndex < notesPerBase; noteIndex += 1) {
      collector.consider(baseIndex, benchmarkRecord(baseIndex, noteIndex), matchedPaths);
    }
  }
  const result = collector.finish();
  const elapsed = performance.now() - startedAt;

  assert.equal(result.stats.examinedRecords, examinedBudget);
  assert.equal(result.stats.matchedRecords, examinedBudget);
  assert.equal(result.stats.peakRetainedCandidates, DEFAULT_CROSS_BASE_SEARCH_LIMIT, "the heap must stay bounded at the rendered result limit");
  assert.equal(result.stats.sortedCandidates, DEFAULT_CROSS_BASE_SEARCH_LIMIT, "finish must sort only retained candidates");
  assert.equal(result.rendered, DEFAULT_CROSS_BASE_SEARCH_LIMIT);
  assert.equal(result.total, examinedBudget);
  assert.equal(result.counts.length, baseCount);
  assert.equal(result.counts.every(({ total }) => total === notesPerBase), true);
  assert.ok(elapsed < elapsedBudgetMs, `50 × 10,000 bounded search took ${elapsed.toFixed(1)} ms; budget is ${elapsedBudgetMs} ms`);
  context.diagnostic(`50 bases × 10,000 notes: ${elapsed.toFixed(1)} ms; retained/sorted ${result.stats.peakRetainedCandidates}/${result.stats.sortedCandidates}.`);
});

const organizerBaseCount = MAX_NOTE_ORGANIZER_DIRECTIVES / MAX_NOTE_ORGANIZER_NOTES;
const organizerElapsedBudgetMs = Number(process.env.KBCC_ORGANIZER_BUDGET_MS ?? 8_000);
if (!Number.isFinite(organizerElapsedBudgetMs) || organizerElapsedBudgetMs <= 0) {
  throw new Error("KBCC_ORGANIZER_BUDGET_MS must be a positive number.");
}

test("the maximum 5,000-note × four-base organizer review stays within its explicit budget", {
  timeout: organizerElapsedBudgetMs + 10_000,
}, (context) => {
  const template = migrateData(null);
  template.settings.workspaceMode = "generic";
  template.settings.setupComplete = true;
  template.indexGroupOrder = ["General"];
  const store = createDefaultStore(template, 1, "vault-organizer-performance");
  store.bases = Array.from({ length: organizerBaseCount }, (_, index) => {
    const data = migrateData(template);
    data.settings.workspaceName = `Organizer base ${index + 1}`;
    return createKnowledgeBaseEntry(data, `organizer-base-${index + 1}`, 100 + index);
  });
  store.activeBaseId = store.bases[0]?.id ?? "";
  const facts: NoteOrganizerFileFact[] = [];
  const directives: NoteOrganizerDirective[] = [];
  for (const base of store.bases) {
    for (let index = 0; index < MAX_NOTE_ORGANIZER_NOTES; index += 1) {
      const path = `Imported/Topic ${index}.md`;
      facts.push({
        path,
        baseId: base.id,
        title: `Topic ${index}`,
        mtime: index + 1,
        size: 100,
        exists: true,
        markdown: true,
        eligible: true,
        sourceKind: "note",
        sourceRole: "vault-note",
        configuredId: "",
        indexEligible: true,
        suggestedIndexGroup: "General",
      });
      directives.push({
        path,
        baseId: base.id,
        primary: { mode: "index", groupTitle: "General" },
      });
    }
  }

  const startedAt = performance.now();
  const plan = createNoteOrganizerPlan(store, facts, directives, { now: 10_000 });
  const preparedAt = performance.now();
  const applied = applyNoteOrganizerPlan(store, plan, facts, 0);
  const elapsed = performance.now() - startedAt;

  assert.equal(plan.reviews.length, MAX_NOTE_ORGANIZER_DIRECTIVES);
  assert.equal(plan.diffs.length, MAX_NOTE_ORGANIZER_DIRECTIVES);
  assert.equal(plan.operations.length, organizerBaseCount);
  assert.equal(applied.activeBaseId, store.activeBaseId);
  assert.equal(applied.bases.every((base) => base.data.directIndexPaths.length === MAX_NOTE_ORGANIZER_NOTES), true);
  assert.ok(elapsed < organizerElapsedBudgetMs,
    `Maximum organizer prepare + apply took ${elapsed.toFixed(1)} ms; budget is ${organizerElapsedBudgetMs} ms`);
  context.diagnostic(
    `${MAX_NOTE_ORGANIZER_NOTES.toLocaleString()} notes × ${organizerBaseCount} bases: prepare ${(preparedAt - startedAt).toFixed(1)} ms; total ${elapsed.toFixed(1)} ms.`,
  );
});

test("5,000 exact Collection memberships do not rescan a 30,000-note Collection per directive", {
  timeout: organizerElapsedBudgetMs + 10_000,
}, (context) => {
  const template = migrateData(null);
  template.settings.workspaceMode = "generic";
  template.settings.setupComplete = true;
  const selectedPaths = Array.from(
    { length: MAX_NOTE_ORGANIZER_NOTES },
    (_, index) => `Imported/Collection topic ${index}.md`,
  );
  template.collections = [{
    id: "large-collection",
    title: "Large collection",
    collapsed: true,
    subjects: [
      ...selectedPaths,
      ...Array.from({ length: 25_000 }, (_, index) => `Existing/Collection member ${index}.md`),
    ],
    subheadings: [],
  }];
  const store = createDefaultStore(template, 1, "vault-organizer-collection-performance");
  const baseId = store.activeBaseId;
  const facts = selectedPaths.map((path, index): NoteOrganizerFileFact => ({
    path,
    baseId,
    title: `Collection topic ${index}`,
    mtime: index + 1,
    size: 100,
    exists: true,
    markdown: true,
    eligible: true,
    sourceKind: "note",
    sourceRole: "vault-note",
    configuredId: "",
    indexEligible: true,
    suggestedIndexGroup: "General",
  }));
  const directives = selectedPaths.map((path): NoteOrganizerDirective => ({
    path,
    baseId,
    collections: { mode: "add", targets: [{ headingId: "large-collection" }] },
  }));

  const startedAt = performance.now();
  const plan = createNoteOrganizerPlan(store, facts, directives, { now: 20_000 });
  const applied = applyNoteOrganizerPlan(store, plan, facts, plan.expectedExternalGeneration);
  const elapsed = performance.now() - startedAt;

  assert.equal(plan.operations.length, 0, "an exact Add request remains a semantic no-op");
  assert.equal(plan.reviews.length, MAX_NOTE_ORGANIZER_NOTES);
  assert.deepEqual(applied, store);
  assert.ok(elapsed < organizerElapsedBudgetMs,
    `5,000 exact memberships against 30,000 Collection subjects took ${elapsed.toFixed(1)} ms; budget is ${organizerElapsedBudgetMs} ms`);
  context.diagnostic(`5,000 × 30,000 exact Collection membership review: ${elapsed.toFixed(1)} ms.`);
});
