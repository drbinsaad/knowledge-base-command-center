import {
  childSubheadings,
  clonePersonalOrganization,
  cloneJsonValue,
  subjectLibraryId,
  pathIsInIndexFolderSources,
  pathIsInsideFolder,
  portablePlaceholderPath,
  rewriteActivePluginDataPathPrefix,
} from "./model";
import type { LayoutSubheading, PluginData } from "./model";

/** What the organization data keys to one path (a note or a placeholder). */
export interface PlacementFacts {
  direct: boolean;
  hidden: boolean;
  pinned: boolean;
  next: boolean;
  collections: string[];
  /** The Index group label keyed to this path ("" when none). */
  group: string;
}

export interface PlaceholderLinkEffects {
  kind: "link" | "unlink";
  subjectId: string;
  /** Where the organization is keyed now, and where it will be keyed after confirming. */
  from: string;
  to: string;
  before: PlacementFacts;
  toBefore: PlacementFacts;
  after: PlacementFacts;
  folderSupplies: boolean;
  mergesOwnerId: string;
  /** Equal keys mean the reviewed effects are still exactly the effects a confirm would apply. */
  key: string;
  lines: string[];
}

function collectionLabels(data: Pick<PluginData, "collections">, path: string): string[] {
  const labels: string[] = [];
  const walk = (node: LayoutSubheading, trail: string[]): void => {
    const here = [...trail, node.title];
    for (const subject of node.subjects) if (subject === path) labels.push(here.join(" › "));
    for (const child of childSubheadings(node)) walk(child, here);
  };
  for (const heading of data.collections) walk(heading, []);
  return labels;
}

export function placementFactsAt(data: PluginData, path: string): PlacementFacts {
  return {
    direct: data.directIndexPaths.includes(path) || data.manualIndexPaths.includes(path),
    hidden: data.excludedIndexPaths.includes(path),
    pinned: data.pinnedPaths.includes(path),
    next: data.nextStudyPaths.includes(path),
    collections: collectionLabels(data, path),
    group: data.indexGroupByPath[path] ?? "",
  };
}

/** Same rule as the service's pathHasAutomaticIndexSource. */
function hasAutomaticSource(data: PluginData, path: string): boolean {
  return data.settings.workspaceMode === "ent-clinical"
    ? pathIsInsideFolder(path, data.settings.primaryFolder)
    : pathIsInIndexFolderSources(path, data.indexFolderSources ?? []);
}

interface Placement { id: string; label: string }

function libraryPlacements(layouts: PluginData["portableIndex"]["libraryLayouts"], ids: string[]): Placement[] {
  const out: Placement[] = [];
  // The id carries every ancestor node id, so moving a heading under another one changes it.
  const walk = (libraryId: string, node: LayoutSubheading, trail: string[], trailIds: string[]): void => {
    const here = [...trail, node.title];
    const hereIds = [...trailIds, node.id];
    for (const id of ids) if (node.subjects.includes(id)) out.push({ id: `${libraryId}/${hereIds.join("/")}/${id}`, label: `${libraryId} › ${here.join(" › ")}` });
    for (const child of childSubheadings(node)) walk(libraryId, child, here, hereIds);
  };
  for (const [libraryId, layout] of Object.entries(layouts ?? {})) for (const heading of layout) walk(libraryId, heading, [], []);
  return out;
}

/** Mirrors the service's replacePortableSubjectInLibraryLayouts on a cloned layout. */
function mergeLibraryLayouts(layouts: PluginData["portableIndex"]["libraryLayouts"], ownerId: string, subjectId: string, targetLibraryId: string | null): void {
  const targetHasSurvivor = targetLibraryId !== null && libraryPlacements({ [targetLibraryId]: layouts[targetLibraryId] ?? [] }, [subjectId]).length > 0;
  for (const [libraryId, layout] of Object.entries(layouts)) {
    let placed = false;
    const replace = (subjects: string[]): string[] => {
      const next: string[] = [];
      for (const candidate of subjects) {
        if (libraryId !== targetLibraryId) {
          if (candidate !== ownerId && candidate !== subjectId) next.push(candidate);
          continue;
        }
        if (targetHasSurvivor && candidate === ownerId) continue;
        if (candidate !== ownerId && candidate !== subjectId) { next.push(candidate); continue; }
        if (placed) continue;
        placed = true;
        next.push(subjectId);
      }
      return next;
    };
    const visit = (node: LayoutSubheading): void => {
      node.subjects = replace(node.subjects);
      for (const child of childSubheadings(node)) visit(child);
    };
    for (const heading of layout) visit(heading);
  }
}

/** Bounded clone: only the fields the service's prefix rewrite and membership step touch. */
function cloneForPreview(data: PluginData): PluginData {
  return {
    ...clonePersonalOrganization(data),
    portableIndex: { resolvedPathBySubjectId: { ...data.portableIndex.resolvedPathBySubjectId } },
    selectedPath: data.selectedPath,
    collapsed: { curriculumNodes: [...data.collapsed.curriculumNodes] },
    settings: data.settings,
  } as unknown as PluginData;
}

function describe(facts: PlacementFacts): string[] {
  const parts: string[] = [];
  if (facts.direct) parts.push("Direct Index membership");
  if (facts.hidden) parts.push("a hidden-from-Index entry");
  if (facts.group) parts.push(`the group “${facts.group}”`);
  if (facts.pinned) parts.push("a pin");
  if (facts.next) parts.push("a Next list entry");
  if (facts.collections.length > 0) {
    parts.push(`${facts.collections.length} Collection placement${facts.collections.length === 1 ? "" : "s"} (${facts.collections.join("; ")})`);
  }
  return parts;
}

const list = (facts: PlacementFacts): string => {
  const parts = describe(facts);
  return parts.length > 0 ? parts.join(", ") : "nothing";
};

/**
 * Pure projection of resolvePortableSubject / unlinkPortableSubject on a bounded
 * clone. It reads `data` and never writes to it; the service remains the only writer.
 */
export function previewPlaceholderLinkEffects(
  data: PluginData,
  kind: "link" | "unlink",
  subjectId: string,
  linkPath = "",
): PlaceholderLinkEffects | null {
  const subject = data.portableIndex.subjects.find((candidate) => candidate.id === subjectId);
  const resolved = data.portableIndex.resolvedPathBySubjectId[subjectId] ?? "";
  if (!subject) return null;
  const placeholder = portablePlaceholderPath(subjectId);
  const from = kind === "unlink" ? resolved : resolved || placeholder;
  const to = kind === "unlink" ? placeholder : linkPath;
  if (!from || !to) return null;
  const ownerId = kind === "link"
    ? Object.entries(data.portableIndex.resolvedPathBySubjectId).find(([id, path]) => id !== subjectId && path === to)?.[0] ?? ""
    : "";
  const owner = ownerId ? data.portableIndex.subjects.find((candidate) => candidate.id === ownerId) : undefined;
  let libraryBefore: Placement[] = [];
  let libraryAfter: Placement[] = [];
  let movedChildren: Array<{ id: string; title: string }> = [];
  let detaches = false;
  const clone = cloneForPreview(data);
  rewriteActivePluginDataPathPrefix(clone, from, to);
  if (kind === "link") {
    // Mirrors the service's dedupe and Direct-state steps.
    const unique = (paths: string[]): string[] => [...new Set(paths)];
    const forEach = (node: LayoutSubheading): void => {
      node.subjects = unique(node.subjects);
      for (const child of childSubheadings(node)) forEach(child);
    };
    for (const heading of clone.collections) forEach(heading);
    clone.pinnedPaths = unique(clone.pinnedPaths);
    clone.nextStudyPaths = unique(clone.nextStudyPaths);
    clone.directIndexPaths = unique([...clone.directIndexPaths, ...clone.manualIndexPaths]);
    clone.manualIndexPaths = [];
    clone.excludedIndexPaths = unique(clone.excludedIndexPaths).filter((path) => !clone.directIndexPaths.includes(path));
    if (ownerId) {
      // The survivor takes this subject's group when cross-group moves are allowed, and no group label otherwise.
      const target = data.indexGroupByPath[from]
        || data.portableIndex.groups.find((group) => group.id === subject.groupId)?.title
        || "Ungrouped";
      if (data.settings.workspaceMode !== "ent-clinical" || data.settings.allowClinicalVisualGroupMoves) clone.indexGroupByPath[to] = target;
      else delete clone.indexGroupByPath[to];
    }
    const indexed = subject.indexed || Boolean(owner?.indexed);
    if (ownerId) {
      const layouts = cloneJsonValue(data.portableIndex.libraryLayouts ?? {});
      libraryBefore = libraryPlacements(layouts, [subjectId, ownerId]);
      mergeLibraryLayouts(layouts, ownerId, subjectId, subjectLibraryId({ ...subject, indexed }));
      libraryAfter = libraryPlacements(layouts, [subjectId, ownerId]);
      movedChildren = data.portableIndex.subjects.filter((candidate) => candidate.parentId === ownerId && candidate.id !== subjectId);
      detaches = subject.parentId === ownerId;
    }
    if (indexed) {
      if (!clone.directIndexPaths.includes(to)) clone.directIndexPaths.push(to);
      clone.excludedIndexPaths = clone.excludedIndexPaths.filter((path) => path !== to);
    } else if (data.settings.workspaceMode !== "ent-clinical") {
      clone.directIndexPaths = clone.directIndexPaths.filter((path) => path !== to);
      if (hasAutomaticSource(data, to) && !clone.excludedIndexPaths.includes(to)) clone.excludedIndexPaths.push(to);
    }
  }
  const before = placementFactsAt(data, from);
  const toBefore = placementFactsAt(data, to);
  const after = placementFactsAt(clone, to);
  const notePath = kind === "unlink" ? from : to;
  const folderSupplies = hasAutomaticSource(data, notePath);
  const lines: string[] = [];
  if (kind === "unlink") {
    lines.push(`Moves back to the placeholder: ${list(before)}.`);
    if (describe(toBefore).length > 0) lines.push(`The placeholder already has ${list(toBefore)}; these are combined without duplicates.`);
    lines.push(`After unlinking, the placeholder has: ${list(after)}.`);
    lines.push(folderSupplies
      ? "This note is still supplied by an Index folder, so it can remain visible from that folder; only its Direct membership and placements move."
      : "No Index folder supplies this note, so it has no Index membership of its own after unlinking.");
  } else {
    lines.push(`Moves onto the note: ${list(before)}.`);
    if (describe(toBefore).length > 0) lines.push(`The note already has ${list(toBefore)}; these are combined without duplicates.`);
    lines.push(`After linking, the note has: ${list(after)}.`);
    // Worded from the projected transition, so the ENT profile (which keeps Direct state) is never misdescribed.
    lines.push(subject.indexed || owner?.indexed
      ? "This subject is indexed, so the note gets Direct Index membership."
      : after.direct
        ? "This subject is not indexed, and the note has Direct Index membership after linking."
        : `This subject is not indexed, so the note's Direct Index membership is cleared${after.hidden ? " and it is hidden from the Index folder that would otherwise supply it" : ""}.`);
    if (owner) {
      lines.push(`The note already belongs to the portable identity “${owner.title}”, which is merged into this subject.`);
      const names = (items: Placement[]): string => items.length > 0 ? items.map((item) => item.label).join("; ") : "none";
      lines.push(`Library placements: ${names(libraryBefore)} become ${names(libraryAfter)}.`);
      if (movedChildren.length > 0 || detaches) {
        lines.push(`${movedChildren.length > 0 ? `Child subjects move under this subject: ${movedChildren.map((child) => child.title).join("; ")}.` : ""}${detaches ? " This subject is no longer a child of the merged identity." : ""}`.trim());
      }
    }
  }
  lines.push(owner ? "The Markdown note is not changed." : "Library placements follow the subject and do not change. The Markdown note is not changed.");
  return {
    kind, subjectId, from, to, before, toBefore, after, folderSupplies, mergesOwnerId: ownerId, lines,
    key: JSON.stringify([
      kind, subjectId, subject.title, from, to, ownerId, before, toBefore, after, folderSupplies,
      libraryBefore, libraryAfter, movedChildren.map((child) => child.id), detaches,
    ]),
  };
}
