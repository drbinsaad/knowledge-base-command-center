import { childSubheadings, isSafeObjectKey, MAX_LAYOUT_DEPTH, MAX_TRANSFER_COLLECTIONS, normalizedNameKey, type LayoutHeading, type LayoutSubheading, type PluginData } from "./model";

/** UI-only staged structures. They are never persisted until the guarded organizer commit. */
export interface OrganizerCollectionCreation {
  baseId: string;
  id: string;
  title: string;
  headingId: string | null;
  parentSubheadingId: string | null;
}

export const MAX_ORGANIZER_COLLECTION_CREATIONS = 100;

export function hasOrganizerControlCharacters(value: string): boolean {
  return /[\p{Cc}\p{Cf}]/u.test(value);
}

/** Existing layout IDs may be legacy, long, or non-Latin; preserve their exact persisted identity. */
export function organizerCollectionStructureId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || hasOrganizerControlCharacters(value) || !isSafeObjectKey(value)) throw new Error("A Collection heading has an invalid stable ID.");
  return value;
}

export function validateOrganizerCollectionCreations(value: unknown): readonly OrganizerCollectionCreation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ORGANIZER_COLLECTION_CREATIONS) throw new Error("Create at most 100 Collection headings in one review.");
  const seen = new Set<string>();
  for (const candidate of value as unknown[]) {
    if (!candidate || typeof candidate !== "object") throw new Error("A new Collection draft is invalid.");
    const item = candidate as OrganizerCollectionCreation;
    const identifier = (id: unknown): boolean => typeof id === "string" && id.length > 0 && id.length <= 128 && /^[a-z0-9][a-z0-9._:@+-]*$/iu.test(id) && isSafeObjectKey(id);
    if (!identifier(item.baseId) || !identifier(item.id)
      || (!item.headingId && item.parentSubheadingId)
      || typeof item.title !== "string" || !item.title.trim() || item.title.length > 100
      || hasOrganizerControlCharacters(item.title)) throw new Error("A new Collection needs a valid name and exact parent.");
    const key = `${item.baseId}\0${item.id}`;
    if (item.headingId !== null) organizerCollectionStructureId(item.headingId);
    if (item.parentSubheadingId !== null) organizerCollectionStructureId(item.parentSubheadingId);
    if (seen.has(key)) throw new Error("A new Collection heading is listed twice.");
    seen.add(key);
  }
  return value as OrganizerCollectionCreation[];
}

/** Mutates only the caller's clone; persisted store and source Undo snapshots stay untouched. */
export function stageOrganizerCollectionCreations(data: PluginData, creations: readonly OrganizerCollectionCreation[]): void {
  if (creations.length === 0) return;
  const nodes = new Map<string, { node: LayoutHeading | LayoutSubheading; headingId: string; depth: number }>();
  const visit = (node: LayoutHeading | LayoutSubheading, headingId: string, depth: number): void => {
    if (nodes.has(node.id)) throw new Error("Collection identities are ambiguous. Repair the collection layout before creating headings.");
    nodes.set(node.id, { node, headingId, depth });
    for (const child of childSubheadings(node)) visit(child, headingId, depth + 1);
  };
  for (const heading of data.collections) visit(heading, heading.id, 1);
  for (const item of creations) {
    if (nodes.has(item.id)) throw new Error("A new Collection identity already exists. Refresh the review.");
    const parent = item.headingId ? nodes.get(item.parentSubheadingId ?? item.headingId) : null;
    if (item.headingId && (!parent || parent.headingId !== item.headingId)) throw new Error("The parent of a new Collection subheading is unavailable. Refresh the review.");
    const depth = parent ? parent.depth + 1 : 1;
    if (depth > MAX_LAYOUT_DEPTH || nodes.size >= MAX_TRANSFER_COLLECTIONS) throw new Error("The new Collection exceeds the layout size or nesting limit.");
    const siblings = parent ? childSubheadings(parent.node) : data.collections;
    const title = item.title.normalize("NFC").trim();
    if (siblings.some((node) => normalizedNameKey(node.title) === normalizedNameKey(title))) throw new Error(`“${title}” already exists here. Choose it or use another name.`);
    const node: LayoutSubheading = { id: item.id, title, subjects: [], ...(parent ? {} : { subheadings: [] }), collapsed: false };
    if (parent) {
      parent.node.subheadings ??= [];
      parent.node.subheadings.push(node);
    } else data.collections.push(node as LayoutHeading);
    nodes.set(item.id, { node, headingId: item.headingId ?? item.id, depth });
  }
}
