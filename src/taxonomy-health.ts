import {
  isPortablePlaceholderPath,
  normalizeWikiLink,
  pathIsInsideFolder,
  recordBelongsToIndex,
  resolveLibraryNoteProfile,
  resetCurriculumVisualPath,
  subjectLibraryId,
  validateTemplateFilePath,
  validateWritableFolderPath,
  type LayoutHeading,
  type PluginData,
  type VaultRecord,
} from "./model";

export type TaxonomyHealthSeverity = "warning" | "info";

export type TaxonomyHealthKind =
  | "duplicate-name"
  | "name-variant"
  | "confusable-name"
  | "orphan-parent"
  | "parent-cycle"
  | "empty-structure"
  | "unreachable-structure"
  | "unavailable-path"
  | "duplicate-binding"
  | "placeholder-match";

export type TaxonomyRepairPlan =
  | {
      kind: "clear-visual-parent";
      path: string;
      expectedParentPath: string;
      label: string;
      preview: string;
    }
  | {
      kind: "clear-portable-parent";
      subjectId: string;
      expectedParentId: string;
      label: string;
      preview: string;
    };

export interface TaxonomyHealthFinding {
  id: string;
  kind: TaxonomyHealthKind;
  severity: TaxonomyHealthSeverity;
  title: string;
  detail: string;
  scope: string;
  path?: string;
  repair?: TaxonomyRepairPlan;
}

export interface TaxonomyHealthInput {
  data: PluginData;
  records: VaultRecord[];
  existingMarkdownPaths: ReadonlySet<string>;
  existingFolderPaths: ReadonlySet<string>;
  configDir: string;
}

interface NamedEntity {
  id: string;
  title: string;
  scope: string;
  description: string;
  path?: string;
}

const HYPHENS = /[\u002d\u058a\u05be\u1400\u1806\u2010-\u2015\u2e17\u2e1a\u2e3a-\u2e3b\u2e40\u301c\u3030\u30a0\ufe31-\ufe32\ufe58\ufe63\uff0d_]+/gu;

// Intentionally small and auditable. This covers the common Latin-looking
// Greek/Cyrillic characters without importing the large, noisy UTS #39 table.
const CONFUSABLE_TO_LATIN: Readonly<Record<string, string>> = Object.freeze({
  "Α": "a", "А": "a", "а": "a",
  "Β": "b", "В": "b", "в": "b",
  "Ε": "e", "Е": "e", "е": "e",
  "Ζ": "z",
  "Η": "h", "Н": "h", "н": "h",
  "Ι": "i", "І": "i", "і": "i",
  "Κ": "k", "К": "k", "к": "k",
  "Μ": "m", "М": "m", "м": "m",
  "Ν": "n",
  "Ο": "o", "ο": "o", "О": "o", "о": "o",
  "Ρ": "p", "ρ": "p", "Р": "p", "р": "p",
  "С": "c", "с": "c",
  "Τ": "t", "Т": "t", "т": "t",
  "Υ": "y", "У": "y", "у": "y",
  "Χ": "x", "χ": "x", "Х": "x", "х": "x",
});

export function localeInvariantTaxonomyKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

export function taxonomyVariantKey(value: string): string {
  return localeInvariantTaxonomyKey(value).replace(HYPHENS, " ").replace(/\s+/gu, " ").trim();
}

export function taxonomyConfusableSkeleton(value: string): string {
  let output = "";
  for (const character of value.normalize("NFKC")) output += CONFUSABLE_TO_LATIN[character] ?? character.toLowerCase();
  return output.replace(HYPHENS, " ").replace(/\s+/gu, " ").trim();
}

function findingId(kind: TaxonomyHealthKind, ...parts: string[]): string {
  return [kind, ...parts].map((part) => encodeURIComponent(part)).join(":");
}

function boundedList(values: readonly string[], limit = 6): string {
  const visible = values.slice(0, limit);
  const suffix = values.length > visible.length ? `, and ${values.length - visible.length} more` : "";
  return `${visible.join(", ")}${suffix}`;
}

function cycleIdentity(cycle: readonly string[]): string {
  let smallest = cycle[0] ?? "";
  for (const value of cycle) if (value < smallest) smallest = value;
  return `${smallest}\u0000${cycle.length}`;
}

function addNamedStructure(
  output: NamedEntity[],
  headings: LayoutHeading[],
  rootScope: string,
  rootDescription: string,
): void {
  for (const heading of headings) {
    output.push({ id: `${rootScope}:heading:${heading.id}`, title: heading.title, scope: rootScope, description: `${rootDescription} heading` });
    for (const subheading of heading.subheadings) {
      output.push({
        id: `${rootScope}:subheading:${subheading.id}`,
        title: subheading.title,
        scope: `${rootScope}:heading:${heading.id}`,
        description: `${rootDescription} subheading under “${heading.title}”`,
      });
    }
  }
}

function collectNamedEntities(data: PluginData, records: VaultRecord[]): NamedEntity[] {
  const output: NamedEntity[] = [];
  const representedSubjects = new Set<string>();
  for (const record of records) {
    const scope = record.libraryId ? `library-records:${record.libraryId}` : `index-records:${localeInvariantTaxonomyKey(record.domain)}`;
    output.push({
      id: `record:${record.path}`,
      title: data.displayNameByPath[record.path] || record.title,
      scope,
      description: record.libraryId ? "Library record" : `Index record in “${record.domain || "Ungrouped"}”`,
      path: isPortablePlaceholderPath(record.path) ? undefined : record.path,
    });
    if (record.portableId) representedSubjects.add(record.portableId);
  }
  for (const subject of data.portableIndex.subjects) {
    if (representedSubjects.has(subject.id)) continue;
    const libraryId = subjectLibraryId(subject);
    output.push({
      id: `subject:${subject.id}`,
      title: subject.title,
      scope: libraryId ? `library-records:${libraryId}` : `index-portable-group:${subject.groupId}`,
      description: "Portable subject",
    });
  }
  addNamedStructure(output, data.collections, "collections", "Collection");
  for (const library of data.portableIndex.libraries) {
    output.push({ id: `library:${library.id}`, title: library.name, scope: "libraries", description: "Top-level Library" });
    addNamedStructure(output, data.portableIndex.libraryLayouts[library.id] ?? [], `library-layout:${library.id}`, library.name);
  }
  const effectiveGroups = new Set<string>();
  for (const title of data.indexGroupOrder) effectiveGroups.add(title.normalize("NFC").trim());
  for (const group of data.portableIndex.groups) effectiveGroups.add(group.title.normalize("NFC").trim());
  for (const record of records.filter((record) => recordBelongsToIndex(record, data.settings.workspaceMode === "ent-clinical"))) {
    if (record.domain) effectiveGroups.add(record.domain.normalize("NFC").trim());
  }
  for (const title of effectiveGroups) output.push({ id: `index-group:${title}`, title, scope: "index-groups", description: "Index heading" });
  return output.filter((item) => item.title.trim());
}

function addNameFindings(findings: TaxonomyHealthFinding[], entities: NamedEntity[]): void {
  const byScope = new Map<string, NamedEntity[]>();
  for (const entity of entities) {
    const items = byScope.get(entity.scope) ?? [];
    items.push(entity);
    byScope.set(entity.scope, items);
  }
  for (const [scope, items] of byScope) {
    const exact = new Map<string, NamedEntity[]>();
    const variants = new Map<string, NamedEntity[]>();
    const confusables = new Map<string, NamedEntity[]>();
    for (const item of items) {
      const exactKey = item.title.normalize("NFC").trim();
      const variantKey = taxonomyVariantKey(item.title);
      const confusableKey = taxonomyConfusableSkeleton(item.title);
      (exact.get(exactKey) ?? exact.set(exactKey, []).get(exactKey))?.push(item);
      (variants.get(variantKey) ?? variants.set(variantKey, []).get(variantKey))?.push(item);
      (confusables.get(confusableKey) ?? confusables.set(confusableKey, []).get(confusableKey))?.push(item);
    }
    for (const [key, group] of exact) {
      if (group.length < 2) continue;
      const descriptions = [...new Set(group.map((item) => `${item.description}: “${item.title}”`))];
      findings.push({
        id: findingId("duplicate-name", scope, key), kind: "duplicate-name", severity: "warning",
        title: "Duplicate display name", scope,
        detail: `${group.length} items share the same visible name in one container. ${boundedList(descriptions)}. Renaming or merging is ambiguous, so no automatic repair is offered.`,
        path: group.find((item) => item.path)?.path,
      });
    }
    for (const [key, group] of variants) {
      const visible = [...new Set(group.map((item) => item.title.normalize("NFC").trim()))];
      if (visible.length < 2) continue;
      findings.push({
        id: findingId("name-variant", scope, key), kind: "name-variant", severity: "info",
        title: "Case or hyphen variant", scope,
        detail: `${boundedList(visible.map((title) => `“${title}”`))} normalize to the same case/hyphen-insensitive name. Review them manually before renaming or merging.`,
        path: group.find((item) => item.path)?.path,
      });
    }
    for (const [key, group] of confusables) {
      const variantKeys = new Set(group.map((item) => taxonomyVariantKey(item.title)));
      if (group.length < 2 || variantKeys.size < 2) continue;
      const visible = [...new Set(group.map((item) => item.title.normalize("NFC").trim()))];
      findings.push({
        id: findingId("confusable-name", scope, key), kind: "confusable-name", severity: "warning",
        title: "Visually confusable name", scope,
        detail: `${boundedList(visible.map((title) => `“${title}”`))} use different Latin/Greek/Cyrillic characters but share the same curated visual skeleton. Review manually; the plugin will not rename them automatically.`,
        path: group.find((item) => item.path)?.path,
      });
    }
  }
}

function graphCycles(nodes: readonly string[], parentOf: (node: string) => string | null): string[][] {
  const valid = new Set(nodes);
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();
  const cycles: string[][] = [];
  for (const start of nodes) {
    if (state.get(start)) continue;
    let node: string | null = start;
    while (node && valid.has(node) && !state.get(node)) {
      state.set(node, 1);
      stackIndex.set(node, stack.length);
      stack.push(node);
      node = parentOf(node);
    }
    if (node && state.get(node) === 1) {
      const index = stackIndex.get(node);
      if (index !== undefined) cycles.push(stack.slice(index));
    }
    while (stack.length > 0) {
      const popped = stack.pop();
      if (!popped) break;
      stackIndex.delete(popped);
      state.set(popped, 2);
    }
  }
  return cycles;
}

function addParentFindings(findings: TaxonomyHealthFinding[], data: PluginData, records: VaultRecord[]): void {
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  const visualNodes = Object.keys(data.curriculumVisual.parentByPath);
  for (const [path, parentPath] of Object.entries(data.curriculumVisual.parentByPath)) {
    if (!parentPath) continue;
    const record = recordsByPath.get(path);
    const parent = recordsByPath.get(parentPath);
    const recordGroup = record ? data.indexGroupByPath[path] || record.domain : "";
    const parentGroup = parent ? data.indexGroupByPath[parentPath] || parent.domain : "";
    if (path !== parentPath && record && parent && recordGroup === parentGroup) continue;
    findings.push({
      id: findingId("orphan-parent", "visual", path, parentPath), kind: "orphan-parent", severity: "warning",
      title: "Invalid visual parent", scope: "Index hierarchy", path: record?.path,
      detail: `“${record?.title ?? path}” points to a missing, self-referential, or cross-heading visual parent (${parentPath}). The Markdown note and its properties are not affected.`,
      repair: {
        kind: "clear-visual-parent", path, expectedParentPath: parentPath,
        label: `Clear invalid visual parent for “${record?.title ?? path}”`,
        preview: `Remove only the stored visual-parent edge from “${record?.title ?? path}” to “${parent?.title ?? parentPath}”. The note, folders, properties, Index membership, and other relationships will not change. Undo will restore the edge.`,
      },
    });
  }
  for (const cycle of graphCycles(visualNodes, (path) => data.curriculumVisual.parentByPath[path] ?? null)) {
    if (cycle.length < 2) continue;
    const labels = cycle.map((path) => recordsByPath.get(path)?.title ?? path);
    findings.push({
      id: findingId("parent-cycle", "visual", cycleIdentity(cycle)), kind: "parent-cycle", severity: "warning",
      title: "Visual hierarchy cycle", scope: "Index hierarchy",
      detail: `${boundedList(labels.map((label) => `“${label}”`))} form a ${cycle.length}-item cycle. Choosing which relationship to remove is ambiguous, so no automatic repair is offered.`,
      path: cycle.find((path) => recordsByPath.has(path)),
    });
  }

  const subjects = data.portableIndex.subjects;
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  for (const subject of subjects) {
    const parent = subject.parentId ? subjectById.get(subject.parentId) : undefined;
    const validParent = Boolean(parent
      && parent?.id !== subject.id
      && parent.groupId === subject.groupId
      && subjectLibraryId(parent) === subjectLibraryId(subject));
    if (!subject.parentId || validParent) continue;
    const expectedParentId = subject.parentId;
    findings.push({
      id: findingId("orphan-parent", "portable", subject.id, expectedParentId), kind: "orphan-parent", severity: "warning",
      title: "Invalid portable parent", scope: "Portable hierarchy",
      detail: `“${subject.title}” points to a missing, self-referential, cross-group, or cross-Library portable parent (${expectedParentId}).`,
      repair: {
        kind: "clear-portable-parent", subjectId: subject.id, expectedParentId,
        label: `Clear invalid portable parent for “${subject.title}”`,
        preview: `Make “${subject.title}” a top-level subject in its current group by clearing only its invalid portable-parent identity. Its note binding, Index or Library membership, title, and group will not change. Undo will restore the edge.`,
      },
    });
  }
  for (const cycle of graphCycles(subjects.map((subject) => subject.id), (id) => subjectById.get(id)?.parentId ?? null)) {
    if (cycle.length < 2) continue;
    const labels = cycle.map((id) => subjectById.get(id)?.title ?? id);
    findings.push({
      id: findingId("parent-cycle", "portable", cycleIdentity(cycle)), kind: "parent-cycle", severity: "warning",
      title: "Portable hierarchy cycle", scope: "Portable hierarchy",
      detail: `${boundedList(labels.map((label) => `“${label}”`))} form a ${cycle.length}-item cycle. The safe edge to remove is ambiguous, so this is report-only.`,
    });
  }

  const topics = records.filter((record) => recordBelongsToIndex(record, data.settings.workspaceMode === "ent-clinical"));
  const lookup = new Map<string, string[]>();
  for (const record of topics) {
    const group = localeInvariantTaxonomyKey(record.domain);
    const basename = record.path.split("/").pop()?.replace(/\.md$/iu, "") ?? "";
    for (const title of [record.title, basename, ...record.aliases]) {
      const key = `${group}\u0000${localeInvariantTaxonomyKey(normalizeWikiLink(title))}`;
      const paths = lookup.get(key) ?? [];
      paths.push(record.path);
      lookup.set(key, paths);
    }
  }
  const configuredParent = new Map<string, string>();
  for (const record of topics) {
    if (!record.parentTopic) continue;
    const key = `${localeInvariantTaxonomyKey(record.domain)}\u0000${localeInvariantTaxonomyKey(normalizeWikiLink(record.parentTopic))}`;
    const candidates = [...new Set(lookup.get(key) ?? [])].filter((path) => path !== record.path);
    if (candidates.length === 1) configuredParent.set(record.path, candidates[0] ?? "");
    else findings.push({
      id: findingId("orphan-parent", "configured", record.path, record.parentTopic), kind: "orphan-parent", severity: "warning",
      title: candidates.length === 0 ? "Unresolved configured parent" : "Ambiguous configured parent", scope: "Note metadata", path: record.path,
      detail: `“${record.title}” names “${record.parentTopic}” as its parent, but ${candidates.length === 0 ? "no unique note resolves" : `${candidates.length} notes resolve`} inside “${record.domain}”. Note properties are never changed by the health center.`,
    });
  }
  for (const cycle of graphCycles(topics.map((record) => record.path), (path) => configuredParent.get(path) ?? null)) {
    findings.push({
      id: findingId("parent-cycle", "configured", cycleIdentity(cycle)), kind: "parent-cycle", severity: "warning",
      title: "Configured parent cycle", scope: "Note metadata", path: cycle[0],
      detail: `${boundedList(cycle.map((path) => `“${recordsByPath.get(path)?.title ?? path}”`))} form a ${cycle.length}-item metadata-parent cycle. This report never rewrites Markdown properties.`,
    });
  }
}

function addStructureFinding(
  findings: TaxonomyHealthFinding[],
  kind: "empty-structure" | "unreachable-structure",
  title: string,
  detail: string,
  scope: string,
  id: string,
): void {
  findings.push({ id: findingId(kind, scope, id), kind, severity: "info", title, detail, scope });
}

function addStructureFindings(findings: TaxonomyHealthFinding[], data: PluginData, records: VaultRecord[]): void {
  const recordPaths = new Set(records.map((record) => record.path));
  for (const heading of data.collections) {
    const headingValid = heading.subjects.filter((path) => recordPaths.has(path)).length;
    if (heading.subjects.length === 0 && heading.subheadings.every((subheading) => subheading.subjects.length === 0)) {
      addStructureFinding(findings, "empty-structure", "Empty collection heading", `“${heading.title}” has no direct or nested members. It may be intentional scaffolding, so removal is manual.`, "Collections", heading.id);
    } else if (heading.subjects.length > 0 && headingValid === 0) {
      addStructureFinding(findings, "unreachable-structure", "Unreachable collection heading", `Every direct member of “${heading.title}” is unavailable in the current record projection. Review the missing references before changing the heading.`, "Collections", heading.id);
    }
    for (const subheading of heading.subheadings) {
      const valid = subheading.subjects.filter((path) => recordPaths.has(path)).length;
      if (subheading.subjects.length === 0) addStructureFinding(findings, "empty-structure", "Empty collection subheading", `“${heading.title} / ${subheading.title}” has no members. It may be intentional scaffolding.`, "Collections", subheading.id);
      else if (valid === 0) addStructureFinding(findings, "unreachable-structure", "Unreachable collection subheading", `Every member of “${heading.title} / ${subheading.title}” is unavailable.`, "Collections", subheading.id);
    }
  }
  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  for (const library of data.portableIndex.libraries) {
    const layout = data.portableIndex.libraryLayouts[library.id] ?? [];
    for (const heading of layout) {
      const validForLibrary = (id: string): boolean => {
        const subject = subjectById.get(id);
        return Boolean(subject && subjectLibraryId(subject) === library.id);
      };
      if (heading.subjects.length === 0 && heading.subheadings.every((subheading) => subheading.subjects.length === 0)) {
        addStructureFinding(findings, "empty-structure", "Empty Library heading", `“${library.name} / ${heading.title}” has no direct or nested records. It may be intentional scaffolding.`, library.name, heading.id);
      } else if (heading.subjects.length > 0 && heading.subjects.every((id) => !validForLibrary(id))) {
        addStructureFinding(findings, "unreachable-structure", "Unreachable Library heading", `Every direct identity in “${library.name} / ${heading.title}” is missing or belongs to another Library.`, library.name, heading.id);
      }
      for (const subheading of heading.subheadings) {
        if (subheading.subjects.length === 0) addStructureFinding(findings, "empty-structure", "Empty Library subheading", `“${library.name} / ${heading.title} / ${subheading.title}” has no records.`, library.name, subheading.id);
        else if (subheading.subjects.every((id) => !validForLibrary(id))) addStructureFinding(findings, "unreachable-structure", "Unreachable Library subheading", `Every identity in “${library.name} / ${heading.title} / ${subheading.title}” is missing or belongs to another Library.`, library.name, subheading.id);
      }
    }
  }
  const populatedGroups = new Set(records
    .filter((record) => recordBelongsToIndex(record, data.settings.workspaceMode === "ent-clinical"))
    .map((record) => localeInvariantTaxonomyKey(record.domain)));
  for (const group of data.indexGroupOrder) {
    if (!populatedGroups.has(localeInvariantTaxonomyKey(group))) addStructureFinding(findings, "empty-structure", "Empty Index heading", `“${group}” currently has no indexed records. Empty headings are preserved because they can be intentional scaffolding.`, "Index", group);
  }
}

function addPathFindings(findings: TaxonomyHealthFinding[], input: TaxonomyHealthInput): void {
  const { data, existingFolderPaths, existingMarkdownPaths } = input;
  const folders: Array<[string, string]> = [
    ["Primary folder", data.settings.primaryFolder],
    ["Inbox folder", data.settings.proposalFolder],
    ["Default note folder", data.settings.defaultNoteFolder],
    ["Templates folder", data.settings.templatesFolder],
  ];
  for (const [label, path] of folders) {
    if (!path || existingFolderPaths.has(path)) continue;
    findings.push({
      id: findingId("unavailable-path", "folder", label, path), kind: "unavailable-path", severity: "warning",
      title: `${label} is unavailable`, scope: "Settings",
      detail: `The configured vault-relative folder “${path}” is not currently available. It may still be arriving through Sync, so the health center will not clear it automatically.`,
    });
  }
  const template = data.settings.defaultTemplatePath;
  if (template) {
    const underConfiguredRoot = !data.settings.templatesFolder || pathIsInsideFolder(template, data.settings.templatesFolder);
    const restricted = pathIsInsideFolder(template, input.configDir);
    if (!existingMarkdownPaths.has(template) || !underConfiguredRoot || restricted) findings.push({
      id: findingId("unavailable-path", "template", template), kind: "unavailable-path", severity: "warning",
      title: "Default template is unavailable", scope: "Settings",
      detail: !existingMarkdownPaths.has(template)
        ? `The default template “${template}” is not currently available. It may still be arriving through Sync.`
        : !underConfiguredRoot
          ? `The default template “${template}” is outside the configured Templates folder.`
          : `The default template “${template}” is inside Obsidian's configuration directory and cannot be used safely.`,
    });
  } else if (data.settings.defaultNewNoteMode === "template") findings.push({
    id: findingId("unavailable-path", "template", "missing-default"), kind: "unavailable-path", severity: "warning",
    title: "Template mode has no default template", scope: "Settings",
    detail: "New-note defaults request a template, but no template path is configured. Choose a template or switch the default to Empty note.",
  });

  if (data.settings.attachmentStorageMode === "fixed-folder") {
    const folder = data.settings.attachmentFolder;
    const validation = validateWritableFolderPath(folder, input.configDir);
    if (validation || (folder && !existingFolderPaths.has(folder))) findings.push({
      id: findingId("unavailable-path", "attachment-folder", folder || "vault-root"),
      kind: "unavailable-path",
      severity: validation ? "warning" : "info",
      title: validation ? "Fixed attachment folder cannot be used" : "Fixed attachment folder is not created yet",
      scope: "Attachments",
      detail: validation
        ? `The fixed attachment folder “${folder || "Vault root"}” is unsafe: ${validation}`
        : `The fixed attachment folder “${folder}” is not currently available. The explicit Attach file command will create it when first used; ordinary paste and drag-and-drop are unaffected.`,
    });
  }

  const libraryById = new Map(data.portableIndex.libraries.map((library) => [library.id, library]));
  for (const [libraryId, profile] of Object.entries(data.settings.libraryNoteProfiles)) {
    const libraryName = libraryById.get(libraryId)?.name ?? libraryId;
    const scope = `Library profile: ${libraryName}`;
    if (profile.folder !== undefined) {
      const validation = validateWritableFolderPath(profile.folder, input.configDir);
      if (validation || (profile.folder && !existingFolderPaths.has(profile.folder))) findings.push({
        id: findingId("unavailable-path", "library-folder", libraryId, profile.folder || "vault-root"),
        kind: "unavailable-path", severity: "warning", title: "Library note folder is unavailable", scope,
        detail: validation
          ? `The Library creation profile folder “${profile.folder || "Vault root"}” cannot be used: ${validation}`
          : `The Library creation profile folder “${profile.folder}” is not currently available. It may still be arriving through Sync.`,
      });
    }
    const effective = resolveLibraryNoteProfile(data.settings, libraryId);
    const configuredTemplate = profile.templatePath;
    if (!configuredTemplate && !(profile.mode === "template" && effective.templatePath !== data.settings.defaultTemplatePath)) continue;
    const template = configuredTemplate ?? effective.templatePath;
    const validation = validateTemplateFilePath(template, data.settings.templatesFolder, input.configDir);
    if (!template || validation || !existingMarkdownPaths.has(template)) findings.push({
      id: findingId("unavailable-path", "library-template", libraryId, template || "missing"),
      kind: "unavailable-path", severity: "warning", title: "Library template is unavailable", scope,
      detail: !template
        ? "The Library creation profile requests Template mode without a template."
        : validation
          ? `The Library template “${template}” cannot be used: ${validation}`
          : `The Library template “${template}” is not currently available. It may still be arriving through Sync.`,
    });
  }
}

function addBindingFindings(findings: TaxonomyHealthFinding[], data: PluginData, records: VaultRecord[]): void {
  const idsByPath = new Map<string, string[]>();
  for (const [subjectId, path] of Object.entries(data.portableIndex.resolvedPathBySubjectId)) {
    const ids = idsByPath.get(path) ?? [];
    ids.push(subjectId);
    idsByPath.set(path, ids);
  }
  const subjectById = new Map(data.portableIndex.subjects.map((subject) => [subject.id, subject]));
  for (const [path, ids] of idsByPath) {
    if (ids.length < 2) continue;
    findings.push({
      id: findingId("duplicate-binding", path, String(ids.length)), kind: "duplicate-binding", severity: "warning",
      title: "Duplicate note binding", scope: "Portable identities", path,
      detail: `${ids.length} portable subjects (${boundedList(ids.map((id) => `“${subjectById.get(id)?.title ?? id}”`))}) resolve to the same note. Identity merging is ambiguous and must be reviewed manually.`,
    });
  }

  const localRecords = records.filter((record) => !record.isPlaceholder && !isPortablePlaceholderPath(record.path));
  const byTitle = new Map<string, VaultRecord[]>();
  const byConfiguredId = new Map<string, VaultRecord[]>();
  for (const record of localRecords) {
    const titleKey = localeInvariantTaxonomyKey(record.title);
    const titleMatches = byTitle.get(titleKey) ?? [];
    titleMatches.push(record);
    byTitle.set(titleKey, titleMatches);
    if (record.curriculumId) {
      const idKey = localeInvariantTaxonomyKey(record.curriculumId);
      const idMatches = byConfiguredId.get(idKey) ?? [];
      idMatches.push(record);
      byConfiguredId.set(idKey, idMatches);
    }
  }
  for (const subject of data.portableIndex.subjects) {
    if (data.portableIndex.resolvedPathBySubjectId[subject.id]) continue;
    const candidates = new Map<string, VaultRecord>();
    for (const record of byTitle.get(localeInvariantTaxonomyKey(subject.title)) ?? []) candidates.set(record.path, record);
    if (subject.configuredId) for (const record of byConfiguredId.get(localeInvariantTaxonomyKey(subject.configuredId)) ?? []) candidates.set(record.path, record);
    if (candidates.size === 0) continue;
    const paths = [...candidates.keys()];
    findings.push({
      id: findingId("placeholder-match", subject.id, String(paths.length)), kind: "placeholder-match", severity: "info",
      title: "Placeholder may match a local note", scope: "Portable identities", path: paths.length === 1 ? paths[0] : undefined,
      detail: `“${subject.title}” is unresolved and matches ${paths.length} local note${paths.length === 1 ? "" : "s"} by title or configured ID: ${boundedList(paths)}. Linking is never automatic; use the existing Link to note action after verifying identity.`,
    });
  }
}

export function buildTaxonomyHealthFindings(input: TaxonomyHealthInput): TaxonomyHealthFinding[] {
  const findings: TaxonomyHealthFinding[] = [];
  addNameFindings(findings, collectNamedEntities(input.data, input.records));
  addParentFindings(findings, input.data, input.records);
  addStructureFindings(findings, input.data, input.records);
  addPathFindings(findings, input);
  addBindingFindings(findings, input.data, input.records);
  return [
    ...findings.filter((finding) => finding.severity === "warning"),
    ...findings.filter((finding) => finding.severity === "info"),
  ];
}

/** Apply only the exact state edge described by an already-previewed repair. */
export function applyTaxonomyRepairToData(data: PluginData, repair: TaxonomyRepairPlan): boolean {
  if (repair.kind === "clear-visual-parent") {
    if (data.curriculumVisual.parentByPath[repair.path] !== repair.expectedParentPath) return false;
    resetCurriculumVisualPath(data.curriculumVisual, repair.path);
    return true;
  }
  const subject = data.portableIndex.subjects.find((candidate) => candidate.id === repair.subjectId);
  if (!subject || subject.parentId !== repair.expectedParentId) return false;
  subject.parentId = null;
  return true;
}
