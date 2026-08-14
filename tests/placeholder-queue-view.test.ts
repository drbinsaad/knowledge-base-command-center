import assert from "node:assert/strict";
import test from "node:test";
import { EntVaultCommandCenterView } from "../src/view";
import { cloneJsonValue, DEFAULT_DATA, type VaultRecord } from "../src/model";

function record(path: string, options: Partial<VaultRecord> = {}): VaultRecord {
  return {
    path, title: "Laryngomalacia", kind: "topic", role: "canonical", curriculumId: "ENT-PED-001", domain: "Airway", topicKind: "condition",
    priority: "", reviewStatus: "", synthesisStatus: "", autoresearchStatus: "", safetyCritical: false,
    sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "", doseStatus: "",
    sourceCoverage: "", folderOrder: "", mtime: 0, aiLock: false,
    ...options,
  };
}

test("Smart Queues and Resolve next retain a deleted linked note as an unresolved placeholder", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.portableIndex.groups = [{ id: "airway", title: "Airway", order: 0 }];
  data.portableIndex.subjects = [{
    id: "subject-one", title: "Laryngomalacia", groupId: "airway", parentId: null, order: 0,
    indexed: true, configuredId: "ENT-PED-001", recordKind: "topic", libraryId: null,
  }];
  const placeholderPath = "Notes/Deleted Laryngomalacia.md";
  data.portableIndex.resolvedPathBySubjectId["subject-one"] = placeholderPath;
  const placeholder = record(placeholderPath, {
    role: "placeholder",
    isPlaceholder: true,
    portableId: "subject-one",
    portableIndexed: true,
  });
  const local = record("Notes/Laryngomalacia.md");
  const records = [placeholder, local];
  let opened = "";
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    plugin: unknown;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    placeholderQueueCache: null;
    smartQueues(): Array<{ id: string; title: string; description: string; records: VaultRecord[] }>;
    guardLoadedBase(): boolean;
    openPlaceholderActions(record: VaultRecord): void;
    startResolveNextPlaceholder(): void;
  };
  view.plugin = { data, isClinicalMode: () => false };
  view.records = records;
  view.recordByPath = new Map(records.map((item) => [item.path, item]));
  view.placeholderQueueCache = null;
  view.guardLoadedBase = () => true;
  view.openPlaceholderActions = (item) => { opened = item.path; };
  const queues = view.smartQueues();
  assert.equal(queues[0]?.id, "imported-placeholders");
  assert.deepEqual(queues[0]?.records.map((item) => item.path), [placeholderPath]);
  assert.match(queues[0]?.description ?? "", /1 has exact local title or ID candidates/u);
  assert.match(queues[0]?.description ?? "", /never links automatically/u);
  assert.deepEqual(data.portableIndex.resolvedPathBySubjectId, { "subject-one": placeholderPath });
  view.startResolveNextPlaceholder();
  assert.equal(opened, placeholderPath);
});

test("a cached Smart Queues render does not re-enumerate or reread a 250k-note vault", () => {
  const data = cloneJsonValue(DEFAULT_DATA);
  data.portableIndex.groups = [{ id: "docs", title: "Docs", order: 0 }];
  data.portableIndex.subjects = [{
    id: "readme", title: "README", groupId: "docs", parentId: null, order: 0,
    indexed: true, configuredId: "", recordKind: "topic", libraryId: null,
  }];
  const placeholder = record("kbcc-placeholder:readme", {
    title: "README",
    role: "placeholder",
    isPlaceholder: true,
    portableId: "readme",
    portableIndexed: true,
  });
  const files = Array.from({ length: 250_000 }, (_, index) => ({
    path: `Other/${String(index).padStart(6, "0")}.md`,
    basename: "README",
  }));
  let enumerations = 0;
  let metadataReads = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    app: unknown;
    plugin: unknown;
    records: VaultRecord[];
    recordByPath: Map<string, VaultRecord>;
    placeholderQueueCache: null;
    smartQueues(): Array<{ id: string; description: string; records: VaultRecord[] }>;
  };
  view.app = {
    metadataCache: {
      getFileCache(): null {
        metadataReads += 1;
        return null;
      },
    },
  };
  view.plugin = {
    data,
    isClinicalMode: () => false,
    getActiveKnowledgeBaseId: () => "base-a",
    getVaultNoteGeneration: () => 7,
    getVaultNoteFiles: () => {
      enumerations += 1;
      return files;
    },
  };
  view.records = [placeholder];
  view.recordByPath = new Map([[placeholder.path, placeholder]]);
  view.placeholderQueueCache = null;

  assert.equal(view.smartQueues()[0]?.records.length, 1);
  assert.equal(enumerations, 1);
  assert.equal(metadataReads, files.length);
  assert.equal(view.smartQueues()[0]?.records.length, 1);
  assert.equal(enumerations, 1, "the O(1) generation cache is checked before eligible-note enumeration");
  assert.equal(metadataReads, files.length, "a cache hit performs no metadata projection reads");
});
