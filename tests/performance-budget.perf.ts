import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { parseQuery, type VaultRecord } from "../src/model.ts";
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
