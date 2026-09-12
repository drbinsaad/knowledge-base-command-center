import {
  childSubheadings,
  isImmutableSourcePath,
  makeId,
  subjectLibraryId,
  type LayoutHeading,
  type LayoutSubheading,
  type PluginData,
  type VaultRecord,
} from "./model";

export interface LibraryVisualMembership {
  headingId: string;
  subheadingId?: string;
}

export interface LibraryVisualMoveRequest {
  path: string;
  libraryId: string;
  source: LibraryVisualMembership | null;
  destination: LibraryVisualMembership;
  anchorSubjectId: string | null;
  position: "before" | "inside" | "after";
}

type LibraryNode = LayoutHeading | LayoutSubheading;

function layoutNodes(layout: readonly LayoutHeading[]): LibraryNode[] {
  const result: LibraryNode[] = [];
  const pending: LibraryNode[] = [...layout];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    result.push(node);
    pending.push(...childSubheadings(node));
  }
  return result;
}

function locateMembership(layout: readonly LayoutHeading[], target: LibraryVisualMembership): {
  heading: LayoutHeading;
  node: LibraryNode;
  chain: LibraryNode[];
} | null {
  const heading = layout.find((candidate) => candidate.id === target.headingId);
  if (!heading) return null;
  if (!target.subheadingId) return { heading, node: heading, chain: [heading] };
  const pending: Array<{ node: LibraryNode; chain: LibraryNode[] }> = [{ node: heading, chain: [heading] }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const node of childSubheadings(current.node)) {
      const chain = [...current.chain, node];
      if (node.id === target.subheadingId) return { heading, node, chain };
      pending.push({ node, chain });
    }
  }
  return null;
}

/** Shared with normal catalog placement: groups never cross library ownership. */
export function ensureLibraryCatalogGroup(data: PluginData, libraryId: string, title: string): string {
  const library = data.portableIndex.libraries.find((candidate) => candidate.id === libraryId);
  if (!library) throw new Error("That library is no longer available.");
  const normalize = (value: string): string => value.normalize("NFC").trim().toLowerCase();
  const normalized = normalize(title);
  const otherGroupIds = new Set(data.portableIndex.subjects
    .filter((subject) => subjectLibraryId(subject) !== libraryId).map((subject) => subject.groupId));
  const libraryGroupIds = new Set(data.portableIndex.subjects
    .filter((subject) => subjectLibraryId(subject) === libraryId).map((subject) => subject.groupId));
  const existing = data.portableIndex.groups.find((group) => libraryGroupIds.has(group.id)
    && !otherGroupIds.has(group.id) && normalize(group.title) === normalized);
  if (existing) return existing.id;
  let id = makeId(`${libraryId}-group`);
  while (data.portableIndex.groups.some((group) => group.id === id)) id = makeId(`${libraryId}-group`);
  data.portableIndex.groups.push({ id, title: title.trim() || library.name, order: data.portableIndex.groups.length });
  return id;
}

/**
 * One visual move within an existing Library. Call only inside an Undo-safe
 * transaction after its caller's stale-drag guard. Every source/destination
 * lookup completes before any organization changes; Markdown is never touched.
 */
export function applyLibraryVisualMove(
  data: PluginData,
  record: VaultRecord | null,
  request: LibraryVisualMoveRequest,
): void {
  const { libraryId, source, destination, anchorSubjectId, position } = request;
  const library = data.portableIndex.libraries.find((candidate) => candidate.id === libraryId);
  if (!library || library.archivedAt !== null) throw new Error("That library is no longer available for organization.");
  const subject = record?.portableId
    ? data.portableIndex.subjects.find((candidate) => candidate.id === record.portableId)
    : null;
  if (!record || record.path !== request.path || record.libraryId !== libraryId
    || !subject || subjectLibraryId(subject) !== libraryId || subject.indexed) {
    throw new Error("That record is no longer in this library. Start the move again.");
  }
  if (!record.isPlaceholder && isImmutableSourcePath(record.path)) {
    throw new Error("Immutable source-book files cannot be assigned to a knowledge catalog.");
  }
  if (!record.isPlaceholder) {
    const owners = Object.entries(data.portableIndex.resolvedPathBySubjectId)
      .filter(([, path]) => path === record.path).map(([id]) => id);
    if (owners.length !== 1 || owners[0] !== subject.id) {
      throw new Error("That Markdown note's portable identity changed. Start the move again.");
    }
  }
  const layout = data.portableIndex.libraryLayouts[libraryId] ?? [];
  const nodes = layoutNodes(layout);
  const sourceNode = source ? locateMembership(layout, source) : null;
  if (source ? !sourceNode?.node.subjects.includes(subject.id) : nodes.some((node) => node.subjects.includes(subject.id))) {
    throw new Error("That record's library placement changed. Start the move again.");
  }
  const target = locateMembership(layout, destination);
  if (!target) throw new Error("That library destination is no longer available. Start the move again.");
  if (position === "inside") {
    if (anchorSubjectId !== null) throw new Error("Choose a heading or subheading for this move.");
  } else if ((position !== "before" && position !== "after") || !anchorSubjectId
    || anchorSubjectId === subject.id || !target.node.subjects.includes(anchorSubjectId)
    || !data.portableIndex.subjects.some((candidate) => candidate.id === anchorSubjectId
      && subjectLibraryId(candidate) === libraryId && !candidate.indexed)) {
    throw new Error("That neighboring record is no longer available. Start the move again.");
  }

  const groupId = ensureLibraryCatalogGroup(data, libraryId, target.heading.title);
  // A Library record has one visual placement. Remove duplicate occurrences
  // only within this Library; memberships elsewhere are outside this action.
  for (const node of nodes) node.subjects = node.subjects.filter((id) => id !== subject.id);
  const subjects = target.node.subjects;
  const index = position === "inside" ? subjects.length : subjects.indexOf(anchorSubjectId ?? "") + Number(position === "after");
  subjects.splice(index, 0, subject.id);
  subject.groupId = groupId;
  for (const node of target.chain) node.collapsed = false;
}
