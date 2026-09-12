import { MAX_CURRICULUM_DEPTH, type CurriculumTreeResult, type PluginData } from "./model";
import type { NoteOrganizerIndexPlacementFact } from "./note-organizer";

/** Use the same effective hierarchy as the Index; never infer nesting from a label. */
export function organizerIndexTrail(tree: CurriculumTreeResult, path: string): { paths: string[]; label: string } {
  const paths: string[] = [];
  const labels: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = path;
  while (cursor) {
    const node = tree.nodeByPath.get(cursor);
    if (!node || seen.has(cursor) || paths.length >= MAX_CURRICULUM_DEPTH || tree.depthLimitedPaths.includes(cursor)) {
      throw new Error("This Index hierarchy is unavailable or exceeds its depth limit. Repair it before choosing a parent.");
    }
    seen.add(cursor);
    paths.unshift(cursor);
    labels.unshift(node.record.title);
    cursor = tree.parentByPath.get(cursor) ?? null;
  }
  return { paths, label: labels.join(" / ") };
}

export function organizerIndexPlacement(
  data: PluginData,
  tree: CurriculumTreeResult,
  path: string,
  targetPath: string | null,
): NoteOrganizerIndexPlacementFact {
  const currentParentPath = tree.parentByPath.get(path) ?? null;
  const currentTrail = currentParentPath ? organizerIndexTrail(tree, currentParentPath) : null;
  const targetTrail = targetPath ? organizerIndexTrail(tree, targetPath) : null;
  const relevant = new Set([path, ...(currentTrail?.paths ?? []), ...(targetTrail?.paths ?? [])]);
  for (const candidate of relevant) {
    if (tree.depthLimitedPaths.includes(candidate)
      || (Object.prototype.hasOwnProperty.call(data.curriculumVisual.parentByPath, candidate)
        && data.curriculumVisual.parentByPath[candidate] !== (tree.parentByPath.get(candidate) ?? null))) {
      throw new Error("This Index placement has an invalid parent override. Repair it before organizing this note.");
    }
  }
  return {
    currentParentPath,
    currentParentLabel: currentTrail?.label ?? "",
    hasChildren: (tree.childrenByPath.get(path)?.length ?? 0) > 0,
    target: targetPath && targetTrail ? {
      path: targetPath,
      label: targetTrail.label,
      groupTitle: tree.nodeByPath.get(targetPath)!.record.domain,
      ancestorPaths: targetTrail.paths.slice(0, -1),
    } : null,
  };
}
