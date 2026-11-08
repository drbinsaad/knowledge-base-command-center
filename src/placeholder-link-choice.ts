import { localeInvariantTaxonomyKey } from "./taxonomy-health";

/** An unresolved imported subject, with the context a person needs to tell duplicates apart. */
export interface PlaceholderChoiceSubject {
  id: string;
  title: string;
  configuredId: string;
  /** Library, group and parent names, outermost first. */
  context: readonly string[];
}

export interface PlaceholderChoiceNote {
  title: string;
  curriculumId: string;
}

const MATCHES = ["title + ID", "ID", "title"] as const;

export interface PlaceholderCandidate extends PlaceholderChoiceSubject {
  match: typeof MATCHES[number];
}

/**
 * Exact, locale-invariant title or configured-ID matches only. A title match is a prompt for the user to
 * decide, never an identity proof; ordering is deterministic and never selects a candidate.
 */
export function projectPlaceholderCandidates(note: PlaceholderChoiceNote, subjects: readonly PlaceholderChoiceSubject[]): PlaceholderCandidate[] {
  const noteTitle = localeInvariantTaxonomyKey(note.title);
  const noteId = note.curriculumId ? localeInvariantTaxonomyKey(note.curriculumId) : "";
  const found: PlaceholderCandidate[] = [];
  for (const subject of subjects) {
    const titleMatches = noteTitle !== "" && localeInvariantTaxonomyKey(subject.title) === noteTitle;
    const idMatches = noteId !== "" && subject.configuredId !== "" && localeInvariantTaxonomyKey(subject.configuredId) === noteId;
    if (!titleMatches && !idMatches) continue;
    found.push({ ...subject, match: titleMatches && idMatches ? "title + ID" : idMatches ? "ID" : "title" });
  }
  return found.sort((left, right) => MATCHES.indexOf(left.match) - MATCHES.indexOf(right.match) || left.title.localeCompare(right.title));
}

/** One unique, human-readable label per candidate: title, configured ID, hierarchy/Library context and match kind. */
export function placeholderChoiceLabels(candidates: readonly PlaceholderCandidate[]): string[] {
  const seen = new Map<string, number>();
  return candidates.map((candidate) => {
    const base = `Link to “${candidate.title}”${candidate.configuredId ? ` · ID ${candidate.configuredId}` : ""}`
      + ` · ${candidate.context.join(" › ")} · ${candidate.match} match`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    // Identical context is rare; keep the choice distinct without exposing internal identifiers.
    return count === 1 ? base : `${base} · duplicate ${count}`;
  });
}

interface ChoiceIndex {
  groups: ReadonlyArray<{ id: string; title: string }>;
  subjects: ReadonlyArray<{ id: string; title: string; configuredId: string; groupId: string; parentId: string | null; libraryId?: string | null }>;
  resolvedPathBySubjectId: Readonly<Record<string, string>>;
}

/** Unresolved subjects with Library, group and (bounded, cycle-safe) parent context. */
export function unresolvedChoiceSubjects(index: ChoiceIndex, indexLabel: string, libraryName: (id: string) => string | undefined): PlaceholderChoiceSubject[] {
  const byId = new Map(index.subjects.map((subject) => [subject.id, subject]));
  return index.subjects.filter((subject) => !index.resolvedPathBySubjectId[subject.id]).map((subject) => {
    const parents: string[] = [];
    for (let parent = byId.get(subject.parentId ?? ""); parent && parents.length < 8; parent = byId.get(parent.parentId ?? "")) parents.unshift(parent.title);
    return {
      id: subject.id, title: subject.title, configuredId: subject.configuredId,
      context: [(subject.libraryId && libraryName(subject.libraryId)) || indexLabel,
        index.groups.find((group) => group.id === subject.groupId)?.title ?? "Ungrouped", ...parents],
    };
  });
}
