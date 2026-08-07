export const TOPIC_ROOT = "03 Clinical Topics/";
export const PROCEDURE_ROOT = "04 Procedures/";
export const MEDICATION_ROOT = "06 Clinical Tools/Medications/";
export const SYNDROME_ROOT = "06 Clinical Tools/Syndromes/";
export const DEFAULT_PROPOSAL_FOLDER = "01 Inbox/ENT Topic Proposals";
export const DATA_VERSION = 8;

export type RecordKind = "topic" | "procedure" | "medication" | "syndrome" | "proposal" | "note";
export type RecordRole = "canonical" | "supporting" | "library" | "proposal" | "vault-note";
export type MainTab = "curriculum" | "inbox" | "collections" | "queues" | "procedures" | "medications" | "syndromes";
export type OpenNoteBehavior = "new-tab" | "same-tab" | "split";
export type WorkspaceMode = "generic" | "ent-clinical";
export type NewNoteMode = "empty" | "template";

export interface DomainDefinition {
  name: string;
  folder: string;
  code: string;
}

export const DOMAIN_DEFINITIONS: DomainDefinition[] = [
  { name: "Pediatric", folder: "01 Pediatric", code: "PED" },
  { name: "Otology", folder: "02 Otology", code: "OTO" },
  { name: "Laryngology", folder: "03 Laryngology", code: "LAR" },
  { name: "Head and Neck", folder: "04 Head and Neck", code: "HN" },
  { name: "General", folder: "05 General", code: "GEN" },
  { name: "Basic Sciences", folder: "06 Basic Sciences", code: "SCI" },
  { name: "Rhinology", folder: "07 Rhinology", code: "RHI" },
  { name: "Trauma", folder: "08 Trauma", code: "TRA" },
];

export const TOPIC_KINDS = [
  "condition",
  "intervention",
  "clinical-approach",
  "clinical-presentation",
  "diagnostic-test",
  "foundational-science",
] as const;

export interface VaultRecord {
  path: string;
  title: string;
  kind: RecordKind;
  role: RecordRole;
  curriculumId: string;
  domain: string;
  topicKind: string;
  priority: string;
  reviewStatus: string;
  synthesisStatus: string;
  autoresearchStatus: string;
  safetyCritical: boolean;
  sourceCount: number;
  aliases: string[];
  relatedTopics: string[];
  parentTopic: string;
  imageStatus: string;
  doseStatus: string;
  sourceCoverage: string;
  folderOrder: string;
  mtime: number;
  aiLock: boolean;
}

export interface TopicFormValue {
  title: string;
  domain: string;
  parentPath: string;
  topicKind: string;
  priority: string;
  safetyCritical: boolean;
  curriculumId: string;
  addToCollection: boolean;
}

export interface GenericNoteFormValue {
  title: string;
  folder: string;
  mode: NewNoteMode;
  templatePath: string;
  addToCollection: boolean;
}

export interface CanonicalTopicData extends Omit<TopicFormValue, "parentPath" | "addToCollection"> {
  parentTopic: string;
}

export interface LayoutSubheading {
  id: string;
  title: string;
  collapsed: boolean;
  subjects: string[];
}

export interface LayoutHeading {
  id: string;
  title: string;
  collapsed: boolean;
  subjects: string[];
  subheadings: LayoutSubheading[];
}

/** A visual-only curriculum overlay. It never changes note paths or frontmatter. */
export interface CurriculumVisualState {
  parentByPath: Record<string, string | null>;
  orderByContainer: Record<string, string[]>;
}

export interface CurriculumTreeNode {
  record: VaultRecord;
  children: CurriculumTreeNode[];
}

export interface CurriculumDomainTree {
  domain: string;
  folderOrder: string;
  roots: CurriculumTreeNode[];
}

export interface CurriculumTreeResult {
  domains: CurriculumDomainTree[];
  parentByPath: Map<string, string | null>;
}

export interface SavedView {
  id: string;
  name: string;
  tab: MainTab;
  query: string;
}

export interface PersonalSnapshot {
  label: string;
  at: number;
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  curriculumVisual: CurriculumVisualState;
  manualIndexPaths: string[];
  excludedIndexPaths: string[];
  indexGroupByPath: Record<string, string>;
  indexGroupOrder: string[];
}

export interface PluginSettings {
  setupComplete: boolean;
  workspaceMode: WorkspaceMode;
  workspaceName: string;
  workspaceSubtitle: string;
  indexLabel: string;
  itemSingular: string;
  itemPlural: string;
  groupLabel: string;
  primaryFolder: string;
  inboxLabel: string;
  idProperty: string;
  groupProperty: string;
  parentProperty: string;
  templatesFolder: string;
  defaultNoteFolder: string;
  defaultNewNoteMode: NewNoteMode;
  defaultTemplatePath: string;
  defaultTab: MainTab;
  recentLimit: number;
  enableHoverPreview: boolean;
  showSafetyBadges: boolean;
  proposalFolder: string;
  enableAdvancedCanonicalActions: boolean;
  openNoteBehavior: OpenNoteBehavior;
  allowClinicalVisualGroupMoves: boolean;
}

export interface MigrationBackup {
  version: 1;
  headings: unknown[];
  migratedAt: number;
}

export interface V2MigrationBackup {
  version: 2;
  migratedAt: number;
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  settings: Record<string, unknown>;
}

export interface PluginData {
  version: 8;
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  curriculumVisual: CurriculumVisualState;
  manualIndexPaths: string[];
  excludedIndexPaths: string[];
  indexGroupByPath: Record<string, string>;
  indexGroupOrder: string[];
  selectedPath: string;
  activeTab: MainTab;
  settings: PluginSettings;
  layoutSnapshots: PersonalSnapshot[];
  undoStack: PersonalSnapshot[];
  redoStack: PersonalSnapshot[];
  migrationBackup?: MigrationBackup;
  v2MigrationBackup?: V2MigrationBackup;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  setupComplete: false,
  workspaceMode: "generic",
  workspaceName: "Knowledge Base Command Center",
  workspaceSubtitle: "Search, organize, arrange, and create notes without moving source files.",
  indexLabel: "Knowledge Index",
  itemSingular: "note",
  itemPlural: "notes",
  groupLabel: "Group",
  primaryFolder: "Knowledge Base",
  inboxLabel: "Inbox",
  idProperty: "id",
  groupProperty: "category",
  parentProperty: "parent",
  templatesFolder: "Templates",
  defaultNoteFolder: "Knowledge Base",
  defaultNewNoteMode: "empty",
  defaultTemplatePath: "",
  defaultTab: "curriculum",
  recentLimit: 25,
  enableHoverPreview: true,
  showSafetyBadges: true,
  proposalFolder: "Inbox",
  enableAdvancedCanonicalActions: false,
  openNoteBehavior: "new-tab",
  allowClinicalVisualGroupMoves: false,
};

export const ENT_CLINICAL_SETTINGS: PluginSettings = {
  ...DEFAULT_SETTINGS,
  setupComplete: true,
  workspaceMode: "ent-clinical",
  workspaceName: "ENT Vault Command Center",
  workspaceSubtitle: "Canonical knowledge, personal study organization, and review queues — without moving source notes.",
  indexLabel: "Curriculum",
  itemSingular: "topic",
  itemPlural: "topics",
  groupLabel: "ENT domain",
  primaryFolder: "03 Clinical Topics",
  inboxLabel: "Topic Inbox",
  idProperty: "curriculum_id",
  groupProperty: "domain",
  parentProperty: "parent_topic",
  templatesFolder: "90 Templates",
  defaultNoteFolder: "01 Inbox",
  defaultNewNoteMode: "empty",
  defaultTemplatePath: "",
  proposalFolder: DEFAULT_PROPOSAL_FOLDER,
};

export const DEFAULT_DATA: PluginData = {
  version: 8,
  collections: [],
  pinnedPaths: [],
  nextStudyPaths: [],
  savedViews: [],
  curriculumVisual: { parentByPath: {}, orderByContainer: {} },
  manualIndexPaths: [],
  excludedIndexPaths: [],
  indexGroupByPath: {},
  indexGroupOrder: [],
  selectedPath: "",
  activeTab: "curriculum",
  settings: { ...DEFAULT_SETTINGS },
  layoutSnapshots: [],
  undoStack: [],
  redoStack: [],
};

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function normalizeWikiLink(value: string): string {
  const clean = value.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  return (clean.split("|")[0] ?? clean).replace(/\.md$/, "").trim();
}

export function curriculumRoot(curriculumId: string): string {
  return curriculumId.match(/^(ENT-[A-Z]+-EXT-\d+)/)?.[1]
    ?? curriculumId.match(/^(ENT-[A-Z]+-\d+)/)?.[1]
    ?? "";
}

export function cleanDomainFolder(path: string): string {
  const folder = path.split("/")[1] ?? "Unassigned";
  return folder.replace(/^\d+\s+/, "").trim() || "Unassigned";
}

export function compareRecords(a: VaultRecord, b: VaultRecord): number {
  return (a.curriculumId || "ZZZ").localeCompare(b.curriculumId || "ZZZ", undefined, { numeric: true })
    || a.title.localeCompare(b.title);
}

export function countHeading(heading: LayoutHeading): number {
  return heading.subjects.length + heading.subheadings.reduce((sum, item) => sum + item.subjects.length, 0);
}

export function cloneCollections(collections: LayoutHeading[]): LayoutHeading[] {
  return collections.map((heading) => ({
    ...heading,
    subjects: [...heading.subjects],
    subheadings: heading.subheadings.map((subheading) => ({ ...subheading, subjects: [...subheading.subjects] })),
  }));
}

export function cloneCurriculumVisual(state: CurriculumVisualState): CurriculumVisualState {
  return {
    parentByPath: { ...state.parentByPath },
    orderByContainer: Object.fromEntries(Object.entries(state.orderByContainer).map(([key, paths]) => [key, [...paths]])),
  };
}

export function clonePathMap(input: Record<string, string>): Record<string, string> {
  return { ...input };
}

export function replacePathMapKey(map: Record<string, string>, oldPath: string, newPath: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(map, oldPath)) return false;
  map[newPath] = map[oldPath] ?? "";
  delete map[oldPath];
  return true;
}

export function snapshotPersonal(data: PluginData, label: string): PersonalSnapshot {
  return {
    label,
    at: Date.now(),
    collections: cloneCollections(data.collections),
    pinnedPaths: [...data.pinnedPaths],
    nextStudyPaths: [...data.nextStudyPaths],
    savedViews: data.savedViews.map((view) => ({ ...view })),
    curriculumVisual: cloneCurriculumVisual(data.curriculumVisual),
    manualIndexPaths: [...data.manualIndexPaths],
    excludedIndexPaths: [...data.excludedIndexPaths],
    indexGroupByPath: clonePathMap(data.indexGroupByPath),
    indexGroupOrder: [...data.indexGroupOrder],
  };
}

export function restoreSnapshot(data: PluginData, snapshot: PersonalSnapshot): void {
  data.collections = cloneCollections(snapshot.collections);
  data.pinnedPaths = [...snapshot.pinnedPaths];
  data.nextStudyPaths = [...snapshot.nextStudyPaths];
  data.savedViews = snapshot.savedViews.map((view) => ({ ...view }));
  data.curriculumVisual = cloneCurriculumVisual(snapshot.curriculumVisual);
  data.manualIndexPaths = [...snapshot.manualIndexPaths];
  data.excludedIndexPaths = [...snapshot.excludedIndexPaths];
  data.indexGroupByPath = clonePathMap(snapshot.indexGroupByPath);
  data.indexGroupOrder = [...snapshot.indexGroupOrder];
}

function cleanLayout(input: unknown): LayoutHeading[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw): LayoutHeading[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const title = asText(value.title);
    if (!title) return [];
    return [{
      id: asText(value.id, makeId("collection")),
      title,
      collapsed: value.collapsed === true,
      subjects: asStringList(value.subjects),
      subheadings: Array.isArray(value.subheadings) ? value.subheadings.flatMap((rawSub): LayoutSubheading[] => {
        if (!rawSub || typeof rawSub !== "object") return [];
        const sub = rawSub as Record<string, unknown>;
        const subTitle = asText(sub.title);
        if (!subTitle) return [];
        return [{
          id: asText(sub.id, makeId("subheading")),
          title: subTitle,
          collapsed: sub.collapsed === true,
          subjects: asStringList(sub.subjects),
        }];
      }) : [],
    }];
  });
}

function isMainTab(value: unknown): value is MainTab {
  return ["curriculum", "inbox", "collections", "queues", "procedures", "medications", "syndromes"].includes(String(value));
}

function isOpenNoteBehavior(value: unknown): value is OpenNoteBehavior {
  return ["new-tab", "same-tab", "split"].includes(String(value));
}

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "generic" || value === "ent-clinical";
}

function isNewNoteMode(value: unknown): value is NewNoteMode {
  return value === "empty" || value === "template";
}

function cleanSavedViews(input: unknown): SavedView[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw): SavedView[] => {
    if (!raw || typeof raw !== "object") return [];
    const view = raw as Record<string, unknown>;
    if (!asText(view.name) || !isMainTab(view.tab)) return [];
    return [{ id: asText(view.id, makeId("view")), name: asText(view.name), tab: view.tab, query: asText(view.query) }];
  });
}

export function cleanCurriculumVisual(input: unknown): CurriculumVisualState {
  if (!input || typeof input !== "object") return { parentByPath: {}, orderByContainer: {} };
  const raw = input as Record<string, unknown>;
  const parentByPath: Record<string, string | null> = {};
  if (raw.parentByPath && typeof raw.parentByPath === "object") {
    for (const [path, parent] of Object.entries(raw.parentByPath as Record<string, unknown>)) {
      const cleanPath = asText(path);
      if (cleanPath && (parent === null || typeof parent === "string")) parentByPath[cleanPath] = parent === null ? null : asText(parent);
    }
  }
  const orderByContainer: Record<string, string[]> = {};
  if (raw.orderByContainer && typeof raw.orderByContainer === "object") {
    for (const [key, paths] of Object.entries(raw.orderByContainer as Record<string, unknown>)) {
      const cleanKey = asText(key);
      if (cleanKey) orderByContainer[cleanKey] = [...new Set(asStringList(paths))];
    }
  }
  return { parentByPath, orderByContainer };
}

function cleanPathMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const output: Record<string, string> = {};
  for (const [path, value] of Object.entries(input as Record<string, unknown>)) {
    const cleanPath = asText(path);
    const cleanValue = asText(value);
    if (cleanPath && cleanValue) output[cleanPath] = cleanValue;
  }
  return output;
}

function cleanSnapshots(input: unknown): PersonalSnapshot[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw): PersonalSnapshot[] => {
    if (!raw || typeof raw !== "object") return [];
    const snapshot = raw as Record<string, unknown>;
    return [{
      label: asText(snapshot.label, "Saved organization"),
      at: Number(snapshot.at) || Date.now(),
      collections: cleanLayout(snapshot.collections),
      pinnedPaths: asStringList(snapshot.pinnedPaths),
      nextStudyPaths: asStringList(snapshot.nextStudyPaths),
      savedViews: cleanSavedViews(snapshot.savedViews),
      curriculumVisual: cleanCurriculumVisual(snapshot.curriculumVisual),
      manualIndexPaths: asStringList(snapshot.manualIndexPaths),
      excludedIndexPaths: asStringList(snapshot.excludedIndexPaths),
      indexGroupByPath: cleanPathMap(snapshot.indexGroupByPath),
      indexGroupOrder: [...new Set(asStringList(snapshot.indexGroupOrder))],
    }];
  });
}

function cleanSettings(input: unknown, legacyEnt = false): PluginSettings {
  const settings = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const base = legacyEnt ? ENT_CLINICAL_SETTINGS : DEFAULT_SETTINGS;
  return {
    setupComplete: settings.setupComplete === true || legacyEnt,
    workspaceMode: isWorkspaceMode(settings.workspaceMode) ? settings.workspaceMode : base.workspaceMode,
    workspaceName: asText(settings.workspaceName, base.workspaceName),
    workspaceSubtitle: asText(settings.workspaceSubtitle, base.workspaceSubtitle),
    indexLabel: asText(settings.indexLabel, base.indexLabel),
    itemSingular: asText(settings.itemSingular, base.itemSingular),
    itemPlural: asText(settings.itemPlural, base.itemPlural),
    groupLabel: asText(settings.groupLabel, base.groupLabel),
    primaryFolder: asText(settings.primaryFolder, base.primaryFolder).replace(/^\/+|\/+$/g, ""),
    inboxLabel: asText(settings.inboxLabel, base.inboxLabel),
    idProperty: asText(settings.idProperty, base.idProperty),
    groupProperty: asText(settings.groupProperty, base.groupProperty),
    parentProperty: asText(settings.parentProperty, base.parentProperty),
    templatesFolder: asText(settings.templatesFolder, base.templatesFolder).replace(/^\/+|\/+$/g, ""),
    defaultNoteFolder: asText(settings.defaultNoteFolder, base.defaultNoteFolder).replace(/^\/+|\/+$/g, ""),
    defaultNewNoteMode: isNewNoteMode(settings.defaultNewNoteMode) ? settings.defaultNewNoteMode : base.defaultNewNoteMode,
    defaultTemplatePath: asText(settings.defaultTemplatePath, base.defaultTemplatePath).replace(/^\/+/, ""),
    defaultTab: isMainTab(settings.defaultTab) ? settings.defaultTab : base.defaultTab,
    recentLimit: Math.max(5, Math.min(100, Number(settings.recentLimit) || base.recentLimit)),
    enableHoverPreview: settings.enableHoverPreview !== false,
    showSafetyBadges: settings.showSafetyBadges !== false,
    proposalFolder: asText(settings.proposalFolder, base.proposalFolder).replace(/^\/+|\/+$/g, ""),
    enableAdvancedCanonicalActions: settings.enableAdvancedCanonicalActions === true,
    openNoteBehavior: isOpenNoteBehavior(settings.openNoteBehavior) ? settings.openNoteBehavior : base.openNoteBehavior,
    allowClinicalVisualGroupMoves: settings.allowClinicalVisualGroupMoves === true,
  };
}

export function storedDataVersion(input: unknown): number {
  if (!input || typeof input !== "object") return 0;
  const version = Number((input as Record<string, unknown>).version);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

export function migrateData(input: unknown): PluginData {
  if (!input || typeof input !== "object") return structuredClone(DEFAULT_DATA);
  const loaded = input as Record<string, unknown>;
  const loadedVersion = storedDataVersion(loaded);
  // Versions newer than this plugin are read through the latest compatible
  // shape instead of being mistaken for v1. main.ts keeps them read-only.
  if (loadedVersion >= 3) {
    return {
      version: 8,
      collections: cleanLayout(loaded.collections),
      pinnedPaths: asStringList(loaded.pinnedPaths),
      nextStudyPaths: asStringList(loaded.nextStudyPaths),
      savedViews: cleanSavedViews(loaded.savedViews),
      curriculumVisual: cleanCurriculumVisual(loaded.curriculumVisual),
      manualIndexPaths: asStringList(loaded.manualIndexPaths),
      excludedIndexPaths: asStringList(loaded.excludedIndexPaths),
      indexGroupByPath: cleanPathMap(loaded.indexGroupByPath),
      indexGroupOrder: [...new Set(asStringList(loaded.indexGroupOrder))],
      selectedPath: asText(loaded.selectedPath),
      activeTab: isMainTab(loaded.activeTab) ? loaded.activeTab : DEFAULT_SETTINGS.defaultTab,
      settings: cleanSettings(loaded.settings, loadedVersion <= 5),
      layoutSnapshots: cleanSnapshots(loaded.layoutSnapshots),
      undoStack: cleanSnapshots(loaded.undoStack),
      redoStack: cleanSnapshots(loaded.redoStack),
      migrationBackup: loaded.migrationBackup as MigrationBackup | undefined,
      v2MigrationBackup: loaded.v2MigrationBackup as V2MigrationBackup | undefined,
    };
  }

  if (loaded.version === 2) {
    const collections = cleanLayout(loaded.collections);
    const pinnedPaths = asStringList(loaded.pinnedPaths);
    const nextStudyPaths = asStringList(loaded.nextStudyPaths);
    const savedViews = cleanSavedViews(loaded.savedViews);
    const rawSettings = loaded.settings && typeof loaded.settings === "object" ? loaded.settings as Record<string, unknown> : {};
    return {
      version: 8,
      collections,
      pinnedPaths,
      nextStudyPaths,
      savedViews,
      curriculumVisual: cleanCurriculumVisual(loaded.curriculumVisual),
      manualIndexPaths: [],
      excludedIndexPaths: [],
      indexGroupByPath: {},
      indexGroupOrder: [],
      selectedPath: asText(loaded.selectedPath),
      activeTab: isMainTab(loaded.activeTab) ? loaded.activeTab : DEFAULT_SETTINGS.defaultTab,
      settings: cleanSettings(rawSettings, true),
      layoutSnapshots: cleanSnapshots(loaded.layoutSnapshots),
      undoStack: [],
      redoStack: [],
      migrationBackup: loaded.migrationBackup as MigrationBackup | undefined,
      v2MigrationBackup: {
        version: 2,
        migratedAt: Date.now(),
        collections: cloneCollections(collections),
        pinnedPaths: [...pinnedPaths],
        nextStudyPaths: [...nextStudyPaths],
        savedViews: savedViews.map((view) => ({ ...view })),
        settings: structuredClone(rawSettings),
      },
    };
  }

  const oldHeadings = Array.isArray(loaded.headings) ? loaded.headings : [];
  const custom = oldHeadings.filter((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const heading = raw as Record<string, unknown>;
    return heading.kind === "custom" || (!String(heading.id ?? "").startsWith("auto-") && heading.id !== "ent-cc-inbox");
  });
  return {
    ...structuredClone(DEFAULT_DATA),
    collections: cleanLayout(custom),
    selectedPath: asText(loaded.selectedPath),
    settings: { ...ENT_CLINICAL_SETTINGS },
    migrationBackup: { version: 1, headings: structuredClone(oldHeadings), migratedAt: Date.now() },
  };
}

export function recordMatchesLink(record: VaultRecord, link: string): boolean {
  const normalized = normalizeWikiLink(link).toLowerCase();
  const basename = record.path.split("/").pop()?.replace(/\.md$/, "").toLowerCase() ?? "";
  return Boolean(normalized && (normalized === record.title.toLowerCase() || normalized === basename || record.aliases.some((alias) => alias.toLowerCase() === normalized)));
}

export function curriculumContainerKey(domain: string, parentPath: string | null): string {
  return parentPath ? `parent:${parentPath}` : `root:${domain.toLowerCase()}`;
}

function defaultCurriculumParent(record: VaultRecord, topics: VaultRecord[]): string | null {
  if (record.role === "canonical" && record.curriculumId) {
    const parentId = expectedParentCurriculumId(record.curriculumId);
    if (parentId) return topics.find((candidate) => candidate.domain === record.domain && candidate.curriculumId === parentId)?.path ?? null;
  }
  if (record.parentTopic) {
    return topics.find((candidate) => candidate.domain === record.domain && recordMatchesLink(candidate, record.parentTopic))?.path ?? null;
  }
  return null;
}

function sortCurriculumNodes(nodes: CurriculumTreeNode[], state: CurriculumVisualState, key: string): void {
  const order = state.orderByContainer[key] ?? [];
  const positions = new Map(order.map((path, index) => [path, index]));
  nodes.sort((a, b) => {
    const aIndex = positions.get(a.record.path);
    const bIndex = positions.get(b.record.path);
    if (aIndex !== undefined || bIndex !== undefined) {
      if (aIndex === undefined) return 1;
      if (bIndex === undefined) return -1;
      if (aIndex !== bIndex) return aIndex - bIndex;
    }
    return compareRecords(a.record, b.record);
  });
  for (const node of nodes) sortCurriculumNodes(node.children, state, curriculumContainerKey(node.record.domain, node.record.path));
}

/** Build the effective visual tree while safely ignoring invalid, cross-domain, and cyclic overrides. */
export function buildCurriculumTree(records: VaultRecord[], state: CurriculumVisualState): CurriculumTreeResult {
  const topics = records.filter((record) => record.kind === "topic" && (record.role === "canonical" || record.role === "supporting"));
  const byPath = new Map(topics.map((record) => [record.path, record]));
  const parentByPath = new Map<string, string | null>();
  for (const record of topics) {
    const hasOverride = Object.prototype.hasOwnProperty.call(state.parentByPath, record.path);
    const requested = hasOverride ? state.parentByPath[record.path] ?? null : defaultCurriculumParent(record, topics);
    const parent = requested ? byPath.get(requested) : undefined;
    parentByPath.set(record.path, parent && parent.path !== record.path && parent.domain === record.domain ? parent.path : null);
  }

  // Break each cycle at the first node encountered, leaving a valid rooted tree.
  for (const record of topics) {
    const seen = new Set<string>([record.path]);
    let cursor = parentByPath.get(record.path) ?? null;
    while (cursor) {
      if (seen.has(cursor)) {
        parentByPath.set(record.path, null);
        break;
      }
      seen.add(cursor);
      cursor = parentByPath.get(cursor) ?? null;
    }
  }

  const nodes = new Map<string, CurriculumTreeNode>(topics.map((record) => [record.path, { record, children: [] }]));
  const domains = new Map<string, CurriculumDomainTree>();
  for (const record of topics) {
    const key = record.domain.toLowerCase();
    const domain = domains.get(key) ?? { domain: record.domain || "Unassigned", folderOrder: record.folderOrder, roots: [] };
    if (record.folderOrder < domain.folderOrder) domain.folderOrder = record.folderOrder;
    domains.set(key, domain);
    const node = nodes.get(record.path)!;
    const parentPath = parentByPath.get(record.path);
    const parent = parentPath ? nodes.get(parentPath) : undefined;
    if (parent) parent.children.push(node); else domain.roots.push(node);
  }
  const sorted = [...domains.values()].sort((a, b) => a.folderOrder.localeCompare(b.folderOrder, undefined, { numeric: true }) || a.domain.localeCompare(b.domain));
  for (const domain of sorted) sortCurriculumNodes(domain.roots, state, curriculumContainerKey(domain.domain, null));
  return { domains: sorted, parentByPath };
}

export function curriculumSiblingPaths(tree: CurriculumTreeResult, record: VaultRecord): string[] {
  const parentPath = tree.parentByPath.get(record.path) ?? null;
  if (parentPath) {
    const find = (nodes: CurriculumTreeNode[]): CurriculumTreeNode | undefined => {
      for (const node of nodes) {
        if (node.record.path === parentPath) return node;
        const nested = find(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    return find(tree.domains.flatMap((domain) => domain.roots))?.children.map((node) => node.record.path) ?? [];
  }
  return tree.domains.find((domain) => domain.domain === record.domain)?.roots.map((node) => node.record.path) ?? [];
}

export function curriculumDescendantPaths(tree: CurriculumTreeResult, path: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const [child, parent] of tree.parentByPath) if (parent) children.set(parent, [...(children.get(parent) ?? []), child]);
  const descendants = new Set<string>();
  const visit = (parent: string): void => {
    for (const child of children.get(parent) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      visit(child);
    }
  };
  visit(path);
  return descendants;
}

export function moveCurriculumVisual(
  state: CurriculumVisualState,
  record: VaultRecord,
  parentPath: string | null,
  siblingPaths: string[],
  index: number,
): void {
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    const next = paths.filter((path) => path !== record.path);
    if (next.length > 0) state.orderByContainer[key] = next;
    else delete state.orderByContainer[key];
  }
  state.parentByPath[record.path] = parentPath;
  const ordered = siblingPaths.filter((path, position, all) => path !== record.path && all.indexOf(path) === position);
  ordered.splice(Math.max(0, Math.min(index, ordered.length)), 0, record.path);
  state.orderByContainer[curriculumContainerKey(record.domain, parentPath)] = ordered;
}

export function resetCurriculumVisualPath(state: CurriculumVisualState, path: string): void {
  delete state.parentByPath[path];
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    // A custom order is container-wide. Reset the whole sibling order so this
    // record can return to its true canonical position instead of being forced
    // behind every still-explicit sibling.
    if (paths.includes(path)) delete state.orderByContainer[key];
  }
}

export function replaceCurriculumVisualPath(state: CurriculumVisualState, oldPath: string, newPath: string): boolean {
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(state.parentByPath, oldPath)) {
    state.parentByPath[newPath] = state.parentByPath[oldPath] ?? null;
    delete state.parentByPath[oldPath];
    changed = true;
  }
  for (const [path, parent] of Object.entries(state.parentByPath)) {
    if (parent === oldPath) { state.parentByPath[path] = newPath; changed = true; }
  }
  const oldKey = `parent:${oldPath}`;
  const newKey = `parent:${newPath}`;
  if (state.orderByContainer[oldKey]) {
    state.orderByContainer[newKey] = state.orderByContainer[oldKey]!;
    delete state.orderByContainer[oldKey];
    changed = true;
  }
  for (const paths of Object.values(state.orderByContainer)) {
    for (let index = 0; index < paths.length; index += 1) {
      if (paths[index] === oldPath) { paths[index] = newPath; changed = true; }
    }
  }
  return changed;
}

export function reconcileCurriculumVisual(state: CurriculumVisualState, records: VaultRecord[], groupByPath: Record<string, string> = {}): boolean {
  const topics = new Map(records.filter((record) => record.kind === "topic" && (record.role === "canonical" || record.role === "supporting")).map((record) => [record.path, record]));
  let changed = false;
  for (const [path, parentPath] of Object.entries(state.parentByPath)) {
    const record = topics.get(path);
    const parent = parentPath ? topics.get(parentPath) : undefined;
    const recordGroup = record ? groupByPath[path] || record.domain : "";
    const parentGroup = parent && parentPath ? groupByPath[parentPath] || parent.domain : "";
    if (!record || (parentPath && (!parent || parentGroup !== recordGroup || parentPath === path))) {
      delete state.parentByPath[path];
      changed = true;
    }
  }
  for (const [key, paths] of Object.entries(state.orderByContainer)) {
    const parentPath = key.startsWith("parent:") ? key.slice(7) : "";
    if (parentPath && !topics.has(parentPath)) { delete state.orderByContainer[key]; changed = true; continue; }
    const next = paths.filter((path, index, all) => topics.has(path) && all.indexOf(path) === index);
    if (next.length !== paths.length) { changed = true; }
    if (next.length > 0) state.orderByContainer[key] = next;
    else { delete state.orderByContainer[key]; changed = true; }
  }
  return changed;
}

export function curriculumVisualHasChanges(state: CurriculumVisualState): boolean {
  return Object.keys(state.parentByPath).length > 0 || Object.keys(state.orderByContainer).length > 0;
}

export function buildCurriculumLayout(records: VaultRecord[]): LayoutHeading[] {
  const canonical = records.filter((record) => record.kind === "topic" && record.role === "canonical" && record.curriculumId);
  const supporting = records.filter((record) => record.kind === "topic" && record.role === "supporting");
  const buckets = new Map<string, { title: string; folderOrder: string; records: VaultRecord[] }>();
  for (const topic of canonical) {
    const key = topic.domain.toLowerCase();
    const bucket = buckets.get(key) ?? { title: topic.domain || "Unassigned", folderOrder: topic.folderOrder, records: [] };
    bucket.records.push(topic);
    if (topic.folderOrder < bucket.folderOrder) bucket.folderOrder = topic.folderOrder;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => a.folderOrder.localeCompare(b.folderOrder, undefined, { numeric: true }))
    .map((bucket) => {
      const rootTitles = new Map<string, string>();
      for (const topic of bucket.records) {
        if (topic.curriculumId === curriculumRoot(topic.curriculumId)) rootTitles.set(topic.curriculumId, topic.title);
      }
      const groups = new Map<string, VaultRecord[]>();
      for (const topic of bucket.records) {
        const root = curriculumRoot(topic.curriculumId);
        if (root) groups.set(root, [...(groups.get(root) ?? []), topic]);
      }
      const direct: VaultRecord[] = [];
      for (const note of supporting.filter((item) => item.domain.toLowerCase() === bucket.title.toLowerCase())) {
        const parent = canonical.find((candidate) => recordMatchesLink(candidate, note.parentTopic));
        const root = parent ? curriculumRoot(parent.curriculumId) : "";
        if (root) groups.set(root, [...(groups.get(root) ?? []), note]);
        else direct.push(note);
      }
      return {
        id: `curriculum-${bucket.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        title: bucket.title,
        collapsed: bucket.title.toLowerCase() !== "pediatric",
        subjects: direct.sort(compareRecords).map((record) => record.path),
        subheadings: [...groups.entries()]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([root, grouped]) => ({
            id: `curriculum-${root.toLowerCase()}`,
            title: rootTitles.get(root) ?? grouped.find((record) => record.curriculumId === root)?.title ?? root,
            collapsed: !/congenital laryngeal anomalies/i.test(rootTitles.get(root) ?? ""),
            subjects: grouped.sort((a, b) => a.role.localeCompare(b.role) || compareRecords(a, b)).map((record) => record.path),
          })),
      };
    });
}

interface ParsedQuery {
  text: string;
  tokens: Map<string, string[]>;
}

export function parseQuery(query: string): ParsedQuery {
  const tokens = new Map<string, string[]>();
  const remainder = query.replace(/([a-z_]+):(?:"([^"]+)"|(\S+))/gi, (_match, key: string, quoted: string, bare: string) => {
    const normalized = key.toLowerCase();
    tokens.set(normalized, [...(tokens.get(normalized) ?? []), (quoted || bare || "").toLowerCase()]);
    return " ";
  });
  return { text: remainder.trim().toLowerCase(), tokens };
}

export const KNOWN_QUERY_TOKENS = new Set([
  "domain", "priority", "kind", "type", "status", "review", "safety", "source", "dose", "image",
]);

export function unknownQueryTokens(query: string): string[] {
  return [...parseQuery(query).tokens.keys()].filter((key) => !KNOWN_QUERY_TOKENS.has(key));
}

function fuzzyContains(haystack: string, needle: string): boolean {
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function tokenMatches(record: VaultRecord, key: string, values: string[]): boolean {
  return values.some((value) => {
    if (key === "domain") return record.domain.toLowerCase().includes(value);
    if (key === "priority") return record.priority.toLowerCase() === value;
    if (key === "kind" || key === "type") return record.kind === value || record.role === value || record.topicKind.toLowerCase().includes(value);
    if (key === "status" || key === "review") return record.reviewStatus.toLowerCase().includes(value) || record.synthesisStatus.toLowerCase().includes(value);
    if (key === "safety") return record.safetyCritical === ["true", "yes", "critical", "1"].includes(value);
    if (key === "source") return value === "gap" ? record.sourceCount === 0 || record.sourceCoverage === "none" : value === "traced" ? record.sourceCount > 0 : String(record.sourceCount) === value;
    if (key === "dose") return record.doseStatus.toLowerCase().includes(value);
    if (key === "image") return record.imageStatus.toLowerCase().includes(value);
    return false;
  });
}

export function matchesQuery(record: VaultRecord, query: string): boolean {
  const parsed = parseQuery(query);
  for (const [key, values] of parsed.tokens) if (!tokenMatches(record, key, values)) return false;
  if (!parsed.text) return true;
  const haystack = [record.title, record.curriculumId, record.domain, record.topicKind, record.role, record.path, ...record.aliases].join(" ").toLowerCase();
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  return parsed.text.split(/\s+/).every((term) => haystack.includes(term)
    || words.some((word) => word[0] === term[0] && fuzzyContains(word, term)));
}

export function metadataHasGap(record: VaultRecord): boolean {
  if (record.kind === "topic") return record.role === "canonical" && (!record.curriculumId || !record.priority || record.sourceCount === 0);
  if (record.kind === "procedure") return !record.reviewStatus || record.sourceCount === 0;
  if (record.kind === "medication") return record.doseStatus !== "reviewed" || record.sourceCount === 0 || record.sourceCoverage === "none";
  if (record.kind === "syndrome") return record.imageStatus === "absent" || record.sourceCount === 0 || record.sourceCoverage === "none";
  return false;
}

export function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
}

export function canonicalIdIsValid(curriculumId: string, domain: string): boolean {
  const definition = DOMAIN_DEFINITIONS.find((item) => item.name === domain);
  if (!definition) return false;
  const pattern = new RegExp(`^ENT-${definition.code}-(?:EXT-\\d{3}|\\d{3}(?:\\.\\d{1,2})?)$`);
  return pattern.test(curriculumId.trim().toUpperCase());
}

export function expectedParentCurriculumId(curriculumId: string): string {
  return curriculumId.trim().toUpperCase().match(/^(ENT-[A-Z]+-\d+)\.\d{1,2}$/)?.[1] ?? "";
}

export function isExtensionCurriculumId(curriculumId: string): boolean {
  return /^ENT-[A-Z]+-EXT-\d{3}$/.test(curriculumId.trim().toUpperCase());
}

export function resolveExpectedParentPath(curriculumId: string, domain: string, records: VaultRecord[]): string {
  const expectedId = expectedParentCurriculumId(curriculumId);
  if (!expectedId) return "";
  return records.find((record) => record.role === "canonical" && record.domain === domain && record.curriculumId.toUpperCase() === expectedId)?.path ?? "";
}

export function canonicalHierarchyIssue(value: TopicFormValue, records: VaultRecord[], currentPath = ""): string | null {
  const curriculumId = value.curriculumId.trim().toUpperCase();
  const expectedId = expectedParentCurriculumId(curriculumId);
  if (!expectedId) {
    if (isExtensionCurriculumId(curriculumId)) {
      if (!value.parentPath) return null;
      const extensionParent = records.find((record) => record.path === value.parentPath);
      if (!extensionParent || extensionParent.role !== "canonical") return "The selected extension-topic parent is no longer canonical.";
      if (extensionParent.path === currentPath) return "A topic cannot be its own parent.";
      return extensionParent.domain === value.domain ? null : "An extension topic can only use a parent from the same ENT domain.";
    }
    return value.parentPath ? `Root curriculum ID ${curriculumId} cannot have a parent topic.` : null;
  }
  const expected = records.find((record) => record.path !== currentPath
    && record.role === "canonical"
    && record.domain === value.domain
    && record.curriculumId.toUpperCase() === expectedId);
  if (!expected) return `Child curriculum ID ${curriculumId} requires the existing parent ${expectedId} in ${value.domain}.`;
  if (!value.parentPath) return `Select ${expectedId} · ${expected.title} as the parent for ${curriculumId}.`;
  const selected = records.find((record) => record.path === value.parentPath);
  if (!selected || selected.role !== "canonical") return "The selected parent is no longer a canonical topic.";
  if (selected.path === currentPath) return "A topic cannot be its own parent.";
  if (selected.domain !== value.domain || selected.curriculumId.toUpperCase() !== expectedId) {
    return `${curriculumId} must use ${expectedId} in ${value.domain} as its parent.`;
  }
  return null;
}

export function canonicalPath(value: Pick<TopicFormValue, "title" | "domain" | "curriculumId">): string {
  const definition = DOMAIN_DEFINITIONS.find((item) => item.name === value.domain);
  if (!definition) return "";
  return `${TOPIC_ROOT}${definition.folder}/${value.curriculumId.trim().toUpperCase()} - ${sanitizeFileName(value.title)}.md`;
}

export function proposalPath(folder: string, title: string): string {
  return `${folder.replace(/^\/+|\/+$/g, "")}/${sanitizeFileName(title)}.md`;
}

export function genericNotePath(folder: string, title: string): string {
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const fileName = `${sanitizeFileName(title)}.md`;
  return cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
}

export function pathIsInsideFolder(path: string, folder: string): boolean {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  return !clean || path === clean || path.startsWith(`${clean}/`);
}

export function configuredGroupFromPath(path: string, primaryFolder: string, fallback = "Ungrouped"): string {
  const cleanRoot = primaryFolder.trim().replace(/^\/+|\/+$/g, "");
  const relative = cleanRoot && path.startsWith(`${cleanRoot}/`) ? path.slice(cleanRoot.length + 1) : path;
  const segments = relative.split("/");
  return segments.length > 1 ? segments[0] || fallback : fallback;
}

export function applyTemplateTokens(content: string, title: string, date: string, time: string): string {
  return content
    .replace(/{{\s*title\s*}}/gi, title)
    .replace(/{{\s*date\s*}}/gi, date)
    .replace(/{{\s*time\s*}}/gi, time);
}

export function validateWritableFolderPath(folder: string, configDir = ".obsidian"): string | null {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  const cleanConfig = configDir.trim().replace(/^\/+|\/+$/g, "");
  if (clean === cleanConfig || clean.startsWith(`${cleanConfig}/`)) return `The folder cannot be inside ${cleanConfig}.`;
  if (clean.split("/").some((segment) => segment === "." || segment === "..")) return "The folder cannot contain . or .. path segments.";
  return null;
}

export function validateProposalFolderPath(folder: string, configDir = ".obsidian"): string | null {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  if (!clean.startsWith("01 Inbox/")) return "The proposal folder must be a subfolder inside 01 Inbox.";
  if (isRestrictedVaultPath(`${clean}/`, configDir)) return "The proposal folder cannot use a restricted vault area.";
  return null;
}

export interface CanonicalFrontmatterOptions {
  value: TopicFormValue;
  parentTopic: string;
  date: string;
  forceUnverified: boolean;
  removeProposalFields?: boolean;
}

export function applyCanonicalFrontmatter(metadata: Record<string, unknown>, options: CanonicalFrontmatterOptions): void {
  const { value, parentTopic, date, forceUnverified } = options;
  const sources = Array.isArray(metadata.sources) ? metadata.sources : [];
  const cssclasses = asStringList(metadata.cssclasses);
  metadata.type = "clinical-topic";
  metadata.title = value.title;
  metadata.curriculum_id = value.curriculumId.trim().toUpperCase();
  metadata.domain = value.domain;
  metadata.topic_kind = value.topicKind;
  metadata.parent_topic = parentTopic;
  metadata.aliases = Array.isArray(metadata.aliases) ? metadata.aliases : [];
  metadata.priority = value.priority;
  metadata.safety_critical = value.safetyCritical;
  metadata.review_status = forceUnverified ? "unverified" : asText(metadata.review_status, "unverified");
  metadata.synthesis_status = asText(metadata.synthesis_status, "empty");
  metadata.autoresearch_status = asText(metadata.autoresearch_status, "none");
  metadata.ai_lock = false;
  metadata.has_source = sources.length > 0;
  metadata.reviewed_by = forceUnverified ? null : (metadata.reviewed_by ?? null);
  metadata.reviewed_date = forceUnverified ? null : (metadata.reviewed_date ?? null);
  metadata.last_tested = metadata.last_tested ?? null;
  metadata.recall_confidence = metadata.recall_confidence ?? null;
  metadata.sources = sources;
  metadata.created = metadata.created ?? date;
  metadata.updated = date;
  metadata.cssclasses = cssclasses.includes("clinical-note") ? cssclasses : [...cssclasses, "clinical-note"];
  if (options.removeProposalFields) {
    delete metadata.proposed_domain;
    delete metadata.proposed_parent;
    delete metadata.proposal_status;
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildProposalMarkdown(value: Omit<TopicFormValue, "curriculumId" | "addToCollection"> & { parentTopic: string }, date: string): string {
  return `---
type: topic-proposal
title: ${yamlString(value.title)}
proposed_domain: ${yamlString(value.domain)}
proposed_parent: ${value.parentTopic ? yamlString(value.parentTopic) : ""}
topic_kind: ${yamlString(value.topicKind)}
priority: ${value.priority}
safety_critical: ${value.safetyCritical}
proposal_status: inbox
review_status: unverified
synthesis_status: empty
autoresearch_status: none
ai_lock: false
has_source: false
sources: []
created: ${date}
updated: ${date}
cssclasses:
  - clinical-note
---
# ${value.title}

> [!warning] Topic proposal — unverified
> This is an educational capture scaffold. It is not part of the canonical curriculum until Dr. Ali explicitly promotes it. Do not add clinical claims, doses, thresholds, or timing without source citations.

## Summary

> [!todo] One-minute synthesis
> Define the scope and consultant priorities after a full-library source audit.

## Immediate safety & red flags

> [!todo] Safety gate
> Add source-traced red flags and escalation decisions only after evidence review.

## Clinical detail

### Definition and scope

### Epidemiology and risk factors

### Mechanism or pathophysiology

### Clinical phenotype

### Differential diagnosis

### Focused assessment

### Investigations that change management

### Classification, severity, or staging

## Management

### Observation and medical management

### Indications and timing for intervention

### Multidisciplinary considerations

## Complications & follow-up

### Complications and rescue plan

### Surveillance, outcomes, and counselling

## Figures & tables

## Contradictions

## Autoresearch

> [!autoresearch] External research options
> None drafted.

## Evidence & practice

### Published evidence

### Local or institutional practice

### Personal technical pearl

## Sources

- No source-traced synthesis yet.

## Change history

| Date | Change | Source or reason |
|---|---|---|
| ${date} | Topic proposal created from ENT Vault Command Center | User capture; unverified |
`;
}

export function buildCanonicalMarkdown(value: CanonicalTopicData, date: string): string {
  return `---
type: clinical-topic
title: ${yamlString(value.title)}
curriculum_id: ${yamlString(value.curriculumId.trim().toUpperCase())}
domain: ${yamlString(value.domain)}
topic_kind: ${yamlString(value.topicKind)}
parent_topic: ${value.parentTopic ? yamlString(value.parentTopic) : ""}
aliases: []
priority: ${value.priority}
safety_critical: ${value.safetyCritical}
review_status: unverified
synthesis_status: empty
autoresearch_status: none
ai_lock: false
has_source: false
reviewed_by:
reviewed_date:
last_tested:
recall_confidence:
sources: []
created: ${date}
updated: ${date}
cssclasses:
  - clinical-note
---
# ${value.title}

> [!warning] Unverified clinical-topic scaffold
> This educational note contains no clinically approved content. Complete a source-traced build and keep it unverified until Dr. Ali reviews it.

## Summary

> [!todo] One-minute synthesis
> Add a source-traced consultant summary.

## Immediate safety & red flags

> [!todo] Safety gate
> Add source-traced red flags and escalation decisions only after evidence review.

## Clinical detail

### Definition and scope

### Epidemiology and risk factors

### Mechanism or pathophysiology

### Clinical phenotype

### Differential diagnosis

### Focused assessment

### Investigations that change management

### Classification, severity, or staging

## Management

### Observation and medical management

### Indications and timing for intervention

### Multidisciplinary considerations

## Complications & follow-up

### Complications and rescue plan

### Surveillance, outcomes, and counselling

## Figures & tables

## Contradictions

## Autoresearch

> [!autoresearch] External research options
> None drafted.

## Evidence & practice

### Published evidence

### Local or institutional practice

### Personal technical pearl

## Sources

- No source-traced synthesis yet.

## Change history

| Date | Change | Source or reason |
|---|---|---|
| ${date} | Canonical topic scaffold created from ENT Vault Command Center | User-authorized creation; unverified |
`;
}

export function isImmutableSourcePath(path: string): boolean {
  return path.startsWith("05 Sources/_books/");
}

export function isRestrictedVaultPath(path: string, configDir = ".obsidian"): boolean {
  const cleanConfigDir = configDir.replace(/^\/+|\/+$/g, "");
  return [`${cleanConfigDir}/`, "05 Sources/", "90 Templates/", "91 Assets/", "99 Archive/"].some((root) => path.startsWith(root));
}

export interface IndexDiagnostic {
  id: string;
  kind: "missing-note" | "duplicate-membership" | "broken-parent" | "orphaned-group" | "invalid-visual-parent";
  title: string;
  detail: string;
  path?: string;
}

export function buildIndexDiagnostics(data: PluginData, records: VaultRecord[], existingPaths: Set<string>): IndexDiagnostic[] {
  const diagnostics: IndexDiagnostic[] = [];
  const addMissing = (path: string, owner: string): void => {
    if (!path || existingPaths.has(path)) return;
    diagnostics.push({ id: `missing:${owner}:${path}`, kind: "missing-note", title: "Missing note reference", detail: `${owner} references a note that no longer exists.`, path });
  };
  for (const path of data.manualIndexPaths) addMissing(path, "Manual index membership");
  for (const path of data.excludedIndexPaths) addMissing(path, "Hidden index membership");
  for (const path of data.pinnedPaths) addMissing(path, "Pins");
  for (const path of data.nextStudyPaths) addMissing(path, "Next list");
  for (const heading of data.collections) {
    const inspect = (paths: string[], owner: string): void => {
      paths.forEach((path) => addMissing(path, owner));
      for (const path of new Set(paths)) {
        const count = paths.filter((candidate) => candidate === path).length;
        if (count > 1) diagnostics.push({ id: `duplicate:${owner}:${path}`, kind: "duplicate-membership", title: "Duplicate collection membership", detail: `${owner} contains the same note ${count} times.`, path });
      }
    };
    inspect(heading.subjects, `Collection “${heading.title}”`);
    for (const subheading of heading.subheadings) inspect(subheading.subjects, `Collection “${heading.title} / ${subheading.title}”`);
  }

  const topics = records.filter((record) => record.kind === "topic" && (record.role === "canonical" || record.role === "supporting"));
  const topicByPath = new Map(topics.map((record) => [record.path, record]));
  for (const record of topics) {
    if (record.parentTopic && !topics.some((candidate) => candidate.path !== record.path && candidate.domain === record.domain && recordMatchesLink(candidate, record.parentTopic))) {
      diagnostics.push({ id: `parent:${record.path}`, kind: "broken-parent", title: "Unresolved configured parent", detail: `The configured parent “${record.parentTopic}” does not resolve inside ${record.domain}.`, path: record.path });
    }
  }
  for (const [path, group] of Object.entries(data.indexGroupByPath)) {
    if (!existingPaths.has(path)) addMissing(path, `Visual group “${group}”`);
    else if (!topicByPath.has(path) && !data.excludedIndexPaths.includes(path)) diagnostics.push({ id: `group:${path}`, kind: "orphaned-group", title: "Orphaned visual group override", detail: `The note has a visual group override (“${group}”) but is not currently indexed.`, path });
  }
  for (const [path, parentPath] of Object.entries(data.curriculumVisual.parentByPath)) {
    if (!parentPath) continue;
    const record = topicByPath.get(path);
    const parent = topicByPath.get(parentPath);
    const recordGroup = record ? data.indexGroupByPath[path] || record.domain : "";
    const parentGroup = parent ? data.indexGroupByPath[parentPath] || parent.domain : "";
    if (!record || !parent || recordGroup !== parentGroup || path === parentPath) {
      diagnostics.push({ id: `visual-parent:${path}`, kind: "invalid-visual-parent", title: "Invalid visual parent", detail: `The visual parent ${parentPath} is missing, self-referential, or in another group.`, path });
    }
  }
  return diagnostics;
}

export interface WorkspaceConfig {
  kind: "knowledge-base-command-center-workspace";
  version: 1;
  exportedAt: string;
  settings: PluginSettings;
  indexGroupOrder: string[];
}

export function createWorkspaceConfig(data: PluginData, exportedAt: string): WorkspaceConfig {
  return {
    kind: "knowledge-base-command-center-workspace",
    version: 1,
    exportedAt,
    settings: structuredClone(data.settings),
    indexGroupOrder: [...data.indexGroupOrder],
  };
}

export function parseWorkspaceConfig(input: unknown): WorkspaceConfig {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a Command Center workspace configuration.");
  const value = input as Record<string, unknown>;
  if (value.kind !== "knowledge-base-command-center-workspace" || value.version !== 1) throw new Error("Unsupported Command Center workspace configuration.");
  return {
    kind: "knowledge-base-command-center-workspace",
    version: 1,
    exportedAt: asText(value.exportedAt),
    settings: { ...cleanSettings(value.settings), setupComplete: true },
    indexGroupOrder: [...new Set(asStringList(value.indexGroupOrder))],
  };
}

export interface PersonalBackup {
  kind: "ent-vault-command-center-personal-backup";
  version: 3;
  exportedAt: string;
  collections: LayoutHeading[];
  pinnedPaths: string[];
  nextStudyPaths: string[];
  savedViews: SavedView[];
  curriculumVisual: CurriculumVisualState;
  manualIndexPaths: string[];
  excludedIndexPaths: string[];
  indexGroupByPath: Record<string, string>;
  indexGroupOrder: string[];
  layoutSnapshots: PersonalSnapshot[];
}

export function createPersonalBackup(data: PluginData, exportedAt: string): PersonalBackup {
  return {
    kind: "ent-vault-command-center-personal-backup",
    version: 3,
    exportedAt,
    collections: cloneCollections(data.collections),
    pinnedPaths: [...data.pinnedPaths],
    nextStudyPaths: [...data.nextStudyPaths],
    savedViews: data.savedViews.map((view) => ({ ...view })),
    curriculumVisual: cloneCurriculumVisual(data.curriculumVisual),
    manualIndexPaths: [...data.manualIndexPaths],
    excludedIndexPaths: [...data.excludedIndexPaths],
    indexGroupByPath: clonePathMap(data.indexGroupByPath),
    indexGroupOrder: [...data.indexGroupOrder],
    layoutSnapshots: cleanSnapshots(data.layoutSnapshots),
  };
}

export function parsePersonalBackup(input: unknown): PersonalBackup {
  if (!input || typeof input !== "object") throw new Error("The selected file is not a Command Center backup.");
  const value = input as Record<string, unknown>;
  if (value.kind !== "ent-vault-command-center-personal-backup" || ![1, 2, 3].includes(Number(value.version))) {
    throw new Error("Unsupported Command Center backup format.");
  }
  return {
    kind: "ent-vault-command-center-personal-backup",
    version: 3,
    exportedAt: asText(value.exportedAt),
    collections: cleanLayout(value.collections),
    pinnedPaths: asStringList(value.pinnedPaths),
    nextStudyPaths: asStringList(value.nextStudyPaths),
    savedViews: cleanSavedViews(value.savedViews),
    curriculumVisual: cleanCurriculumVisual(value.curriculumVisual),
    manualIndexPaths: asStringList(value.manualIndexPaths),
    excludedIndexPaths: asStringList(value.excludedIndexPaths),
    indexGroupByPath: cleanPathMap(value.indexGroupByPath),
    indexGroupOrder: [...new Set(asStringList(value.indexGroupOrder))],
    layoutSnapshots: cleanSnapshots(value.layoutSnapshots),
  };
}

export function roleLabel(record: Pick<VaultRecord, "role" | "kind">): string {
  if (record.role === "canonical") return "Canonical topic";
  if (record.role === "supporting") return "Supporting note";
  if (record.role === "proposal") return "Topic proposal";
  if (record.role === "vault-note") return "Vault note";
  return record.kind[0]?.toUpperCase() + record.kind.slice(1);
}

export function shouldHandleRowShortcut(eventTargetIsRow: boolean, key: string): boolean {
  return eventTargetIsRow && ["Enter", "m", "M", "p", "P"].includes(key);
}
