import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BUILTIN_LIBRARY_IDS,
  canonicalJsonString,
  createKnowledgeBaseEntry,
  LIBRARY_KINDS,
  migrateData,
  type PluginData,
  type VaultRecord,
} from "../src/model.ts";
import {
  applyPortableExport,
  COMPLETE_PORTABLE_SELECTION,
  completePortableSelection,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  normalizePortableSelection,
  parsePortableExport,
  selectionAvailableForExport,
  serializePortableExport,
  type PortableExportSelection,
  type PortableExportV1,
} from "../src/portability.ts";
import { createPortfolioExport, serializePortfolioExport } from "../src/portfolio.ts";

/**
 * Lock-in tests for the pre-v4 selection inputs and pre-v4 packages. They pin what
 * users see today: which libraries get selected, what an export contains, and what an
 * old backup imports as. Legacy inputs are built as untyped data on purpose, the way
 * a real old caller or an old file would supply them.
 */

const EXPORTED_AT = "2026-08-08T00:00:00.000Z";
const PROCEDURE = BUILTIN_LIBRARY_IDS.procedure;
const MEDICATION = BUILTIN_LIBRARY_IDS.medication;
const SYNDROME = BUILTIN_LIBRARY_IDS.syndrome;
const ALL_LIBRARY_IDS = LIBRARY_KINDS.map((kind) => BUILTIN_LIBRARY_IDS[kind]);

const GENERATED_ID = /^(group|subject)-[0-9a-z]{6,}-[0-9a-z]{4,}$/;

/**
 * Group and subject IDs are generated fresh on every export, and the lists are ordered
 * by them. Name each generated ID after its title and sort lists of identified items,
 * so two exports with the same content give the same text. Nothing else changes.
 */
function scrub(text: string): string {
  const names = new Map<string, string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const match = typeof item.id === "string" ? GENERATED_ID.exec(item.id) : null;
      if (match && typeof item.title === "string") names.set(item.id as string, `${match[1]}:${item.title}`);
      Object.values(item).forEach(collect);
    }
  };
  collect(JSON.parse(text));
  let renamed = text;
  for (const [id, name] of names) renamed = renamed.split(id).join(name);
  const order = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const items = value.map(order);
      const identified = items.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string");
      return identified && items.length > 1
        ? items.sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1))
        : items;
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, order(inner)]));
    }
    return value;
  };
  return JSON.stringify(order(JSON.parse(renamed)), null, 2);
}

function stable(value: unknown): string {
  return scrub(typeof value === "string" ? value : canonicalJsonString(value));
}

function sha(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function record(overrides: Partial<VaultRecord>): VaultRecord {
  return {
    path: "Source/Topic.md",
    title: "Topic",
    kind: "topic",
    role: "canonical",
    curriculumId: "",
    domain: "Topics",
    topicKind: "",
    priority: "",
    reviewStatus: "unverified",
    synthesisStatus: "none",
    autoresearchStatus: "none",
    safetyCritical: false,
    sourceCount: 0,
    aliases: [],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "",
    folderOrder: "",
    mtime: 1,
    aiLock: false,
    ...overrides,
  };
}

const RECORDS: VaultRecord[] = [
  record({ path: "Source/Topic.md", title: "Topic", kind: "topic", role: "supporting", domain: "Topics" }),
  record({ path: "Source/Procedure.md", title: "Procedure one", kind: "procedure", role: "library", domain: "Procedures" }),
  record({ path: "Source/Medication.md", title: "Medication one", kind: "medication", role: "library", domain: "Medications" }),
  record({ path: "Source/Syndrome.md", title: "Syndrome one", kind: "syndrome", role: "library", domain: "Syndromes" }),
];

const BASE_FLAGS = { workspace: false, index: false, collections: false, study: false, savedViews: false, recovery: false };

/** A selection as an old caller would write it: boolean flags per built-in library, untyped. */
function oldSelection(flags: Record<string, boolean>, libraryIds?: string[]): PortableExportSelection {
  const raw: Record<string, unknown> = { ...BASE_FLAGS, ...flags };
  if (libraryIds) raw.libraryIds = libraryIds;
  return raw as unknown as PortableExportSelection;
}

function exportFor(selection: PortableExportSelection): PortableExportV1 {
  return createPortableExport(migrateData(null), RECORDS, selection, EXPORTED_AT);
}

function rawText(selection: PortableExportSelection): string {
  return serializePortableExport(exportFor(selection));
}

function exportedText(selection: PortableExportSelection): string {
  return scrub(rawText(selection));
}

/** Sort-insensitive summary of what an import changed, from user-visible catalog content. */
function importedCatalog(data: PluginData): unknown {
  return {
    libraries: data.portableIndex.libraries.map((library) => library.id).sort(),
    subjects: data.portableIndex.subjects
      .map((subject) => ({ title: subject.title, kind: subject.recordKind, library: subject.libraryId, indexed: subject.indexed }))
      .sort((a, b) => a.title.localeCompare(b.title, "en")),
  };
}

function importAll(value: PortableExportV1): unknown {
  const target = migrateData(null);
  applyPortableExport(target, value, selectionAvailableForExport(value), "replace");
  return importedCatalog(target);
}

test("old selection inputs select the same built-in libraries, alone and combined", () => {
  const cases: Array<{ name: string; input: PortableExportSelection; expected: string[] }> = [
    { name: "procedures", input: oldSelection({ procedures: true }), expected: [PROCEDURE] },
    { name: "medications", input: oldSelection({ medications: true }), expected: [MEDICATION] },
    { name: "syndromes", input: oldSelection({ syndromes: true }), expected: [SYNDROME] },
    { name: "all three flags", input: oldSelection({ procedures: true, medications: true, syndromes: true }), expected: ALL_LIBRARY_IDS },
    { name: "flag false", input: oldSelection({ procedures: false, medications: false, syndromes: false }), expected: [] },
    { name: "flag plus other libraryIds", input: oldSelection({ medications: true }, ["library-custom"]), expected: ["library-custom", MEDICATION] },
    { name: "flag plus the same libraryId", input: oldSelection({ medications: true }, [MEDICATION]), expected: [MEDICATION] },
    { name: "libraryIds alone", input: oldSelection({}, [SYNDROME, PROCEDURE]), expected: [SYNDROME, PROCEDURE] },
  ];
  for (const { name, input, expected } of cases) {
    assert.deepEqual(normalizePortableSelection(input).libraryIds, expected, name);
  }
});

test("old selection inputs create the same export package as the libraryIds form", () => {
  const pairs: Array<{ name: string; old: PortableExportSelection; current: PortableExportSelection }> = [
    { name: "medications", old: oldSelection({ medications: true }), current: oldSelection({}, [MEDICATION]) },
    { name: "syndromes with index", old: oldSelection({ syndromes: true, index: true }), current: oldSelection({ index: true }, [SYNDROME]) },
    {
      name: "all three with collections",
      old: oldSelection({ procedures: true, medications: true, syndromes: true, collections: true }),
      current: oldSelection({ collections: true }, ALL_LIBRARY_IDS),
    },
    { name: "flag plus libraryIds", old: oldSelection({ procedures: true }, [MEDICATION]), current: oldSelection({}, [MEDICATION, PROCEDURE]) },
  ];
  for (const { name, old, current } of pairs) {
    assert.equal(exportedText(old), exportedText(current), name);
    const parsed = parsePortableExport(JSON.parse(rawText(old)) as unknown);
    assert.deepEqual(
      normalizePortableSelection(selectionAvailableForExport(parsed)).libraryIds.slice().sort(),
      normalizePortableSelection(old).libraryIds.filter((id) => ALL_LIBRARY_IDS.includes(id as never)).slice().sort(),
      name,
    );
  }
});

test("export bytes for old selection inputs are unchanged from before the tidy-up", () => {
  assert.equal(sha(exportedText(oldSelection({ medications: true }))), "12b31214cd9a62edd3a3ef8c60d23e186f7b94c61d51af6b2f1d098cbfd5756a");
  assert.equal(sha(exportedText(oldSelection({ procedures: true, medications: true, syndromes: true, index: true, collections: true }))), "fc9c8653cfc201f7b73cf890b4cd7f9cce23d0348645e62fc48b37806bb84e68");
  assert.equal(sha(exportedText(oldSelection({ index: true }))), "4975ecd92200f19182ec1718568d51f7c722fd3448a61a52b9467b6bb445fe84");
});

test("complete and empty selections, completePortableSelection and selectionAvailableForExport agree", () => {
  assert.deepEqual(normalizePortableSelection(COMPLETE_PORTABLE_SELECTION).libraryIds, ALL_LIBRARY_IDS);
  assert.deepEqual(normalizePortableSelection(EMPTY_PORTABLE_SELECTION).libraryIds, []);
  assert.equal(normalizePortableSelection(COMPLETE_PORTABLE_SELECTION).recovery, false);
  assert.equal(normalizePortableSelection(EMPTY_PORTABLE_SELECTION).workspace, false);
  assert.deepEqual(completePortableSelection(ALL_LIBRARY_IDS).libraryIds, ALL_LIBRARY_IDS);
  assert.deepEqual(completePortableSelection([MEDICATION]).libraryIds, [MEDICATION]);
  assert.deepEqual(completePortableSelection([]).libraryIds, []);

  const complete = exportedText(COMPLETE_PORTABLE_SELECTION);
  assert.equal(exportedText(completePortableSelection(ALL_LIBRARY_IDS)), complete);
  assert.equal(exportedText(oldSelection({ ...COMPLETE_FLAGS }, ALL_LIBRARY_IDS)), complete);

  const parsed = parsePortableExport(JSON.parse(rawText(COMPLETE_PORTABLE_SELECTION)) as unknown);
  const available = selectionAvailableForExport(parsed);
  assert.deepEqual(normalizePortableSelection(available).libraryIds, ALL_LIBRARY_IDS);
  assert.equal(serializePortableExport(createPortableExport(migrateData(null), RECORDS, available, EXPORTED_AT)).length > 0, true);
  assert.equal(sha(complete), "11ed62be2bd7ea5a5d3d0acbf5f796600d331fabf6b483b1b8a071445a83b024");

  // The empty selection selects nothing, whatever the flags say.
  assert.deepEqual(normalizePortableSelection(oldSelection({ procedures: false })).libraryIds, []);
  assert.throws(() => exportedText(EMPTY_PORTABLE_SELECTION), /Choose at least one export component/);
});

const COMPLETE_FLAGS = { procedures: true, medications: true, syndromes: true, workspace: true, index: true, collections: true, study: true, savedViews: true };

/** A current-format export reduced to a package from before format v4, as the older plugin wrote it. */
function downgraded(version: 1 | 2 | 3): unknown {
  const v4 = structuredClone(exportFor(oldSelection({ index: true }, [MEDICATION, SYNDROME]))) as unknown as {
    version: number;
    components: { index: Record<string, unknown> & { version: number } };
  };
  v4.version = version;
  const index = v4.components.index;
  index.version = version;
  delete index.libraries;
  if (version === 1) {
    delete index.libraryLayouts;
    delete index.includedSections;
    delete index.includeIndex;
  } else {
    if (version === 2) delete index.libraryLayouts;
    else {
      const layouts = index.libraryLayouts as Record<string, unknown>;
      for (const kind of LIBRARY_KINDS) layouts[kind] ??= [];
    }
    index.includedSections = { index: true, procedures: false, medications: true, syndromes: true };
  }
  return v4;
}

test("a portable package from before format v4 parses and imports as it does today", () => {
  const results: Record<string, unknown> = {};
  for (const version of [1, 2, 3] as const) {
    const parsed = parsePortableExport(downgraded(version));
    assert.equal(parsed.version, version);
    const sections = parsed.components.index?.includedSections;
    if (version === 1) assert.equal(sections, undefined);
    else {
      assert.deepEqual(sections, {
        index: true,
        libraryIds: [MEDICATION, SYNDROME],
        procedures: false,
        medications: true,
        syndromes: true,
      });
    }
    assert.deepEqual(
      normalizePortableSelection(selectionAvailableForExport(parsed)).libraryIds,
      version === 1 ? [] : [MEDICATION, SYNDROME],
    );
    results[`v${version}`] = { parsed: sha(parsed), imported: importAll(parsed) };
  }
  assert.equal(sha(results), "36c7e3f1603249710caacc83562b5f07bd2af3241fc5ec31969b509f9a76b789");
});

test("a pre-v4 package imports the same libraries when the old flags select them", () => {
  const parsed = parsePortableExport(downgraded(2));
  const viaFlags = migrateData(null);
  applyPortableExport(viaFlags, parsed, oldSelection({ medications: true, syndromes: true, index: true }), "replace");
  const viaIds = migrateData(null);
  applyPortableExport(viaIds, parsed, oldSelection({ index: true }, [MEDICATION, SYNDROME]), "replace");
  assert.deepEqual(importedCatalog(viaFlags), importedCatalog(viaIds));
  assert.equal(sha(importedCatalog(viaFlags)), "17f83e45e65d58b7fc316f557002968c70fdcbf0ceda24abd2a1877782880cf6");
});

test("portfolio manifests carry the same selection for old inputs and the libraryIds form", () => {
  const entry = createKnowledgeBaseEntry(migrateData(null), "base-source", 100);
  const build = (selection: PortableExportSelection): string => scrub(serializePortfolioExport(
    createPortfolioExport([{ entry, records: RECORDS, selection }], EXPORTED_AT, "vault-source"),
  ));
  const old = build(oldSelection({ medications: true, index: true }));
  assert.equal(old, build(oldSelection({ index: true }, [MEDICATION])));
  const manifestEntry = (JSON.parse(old) as { manifest: { entries: Array<{ selection: Record<string, unknown> }> } }).manifest.entries[0];
  // The written manifest carries the three pre-v4 boolean flags next to libraryIds, in this order.
  assert.deepEqual(Object.keys(manifestEntry?.selection ?? {}), [
    "workspace", "index", "libraryIds", "procedures", "medications", "syndromes", "collections", "study", "savedViews", "recovery",
  ]);
  assert.deepEqual(manifestEntry?.selection.libraryIds, [MEDICATION]);
  assert.deepEqual(
    [manifestEntry?.selection.procedures, manifestEntry?.selection.medications, manifestEntry?.selection.syndromes],
    [false, true, false],
  );
  assert.equal(sha(old), "bdfcc0489c8b70c633b66e9f811c6287505fd7cc2b3293d8a6490cc43f2d3d41");
});
