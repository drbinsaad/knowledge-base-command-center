import {
  matchesParsedQuery,
  normalizeSearchText,
  type ParsedQuery,
  type PluginData,
  type VaultRecord,
} from "./model";

export const DEFAULT_CROSS_BASE_SEARCH_LIMIT = 300;

export interface KnowledgeBaseSearchSource {
  baseId: string;
  baseName: string;
  data: PluginData;
}

export interface KnowledgeBaseSearchSourceIdentity {
  baseId: string;
  baseName: string;
}

export interface KnowledgeBaseSearchGroup<TSource extends KnowledgeBaseSearchSourceIdentity> {
  source: TSource;
  records: VaultRecord[];
  total: number;
}

export interface KnowledgeBaseSearchCount<TSource extends KnowledgeBaseSearchSourceIdentity> {
  source: TSource;
  total: number;
}

export interface KnowledgeBaseSearchStats {
  examinedRecords: number;
  matchedRecords: number;
  peakRetainedCandidates: number;
  sortedCandidates: number;
}

export interface KnowledgeBaseSearchResultSet<TSource extends KnowledgeBaseSearchSourceIdentity> {
  groups: Array<KnowledgeBaseSearchGroup<TSource>>;
  counts: Array<KnowledgeBaseSearchCount<TSource>>;
  total: number;
  rendered: number;
  stats: KnowledgeBaseSearchStats;
}

interface RankedCandidate {
  baseIndex: number;
  rank: number;
  record: VaultRecord;
}

function fuzzyContainsForRank(haystack: string, needle: string): boolean {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return needle.length === 0;
}

function fieldRank(value: string, term: string, base: number): number | null {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  if (normalized === term) return base;
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Within the same match class, prefer a concise single-subject title over a
  // long phrase. This keeps an exact subject above broad domain matches.
  const specificity = Math.min(words.length, 9) / 100 + Math.min(normalized.length, 999) / 100_000;
  if (normalized.startsWith(term)) return base + 1 + specificity;
  if (words.some((word) => word.startsWith(term))) return base + 2 + specificity;
  if (normalized.includes(term)) return base + 3;
  if (words.some((word) => word[0] === term[0] && fuzzyContainsForRank(word, term))) return base + 4;
  return null;
}

export function knowledgeBaseSearchRank(record: VaultRecord, parsedQuery: ParsedQuery): number {
  if (parsedQuery.terms.length === 0) return 0;
  let total = 0;
  for (const term of parsedQuery.terms) {
    const titleRank = fieldRank(record.title, term, 0);
    if (titleRank !== null) { total += titleRank; continue; }
    let bestAliasRank: number | null = null;
    for (const alias of record.aliases) {
      const aliasRank = fieldRank(alias, term, 10);
      if (aliasRank !== null && (bestAliasRank === null || aliasRank < bestAliasRank)) bestAliasRank = aliasRank;
    }
    if (bestAliasRank !== null) { total += bestAliasRank; continue; }
    const idRank = fieldRank(record.curriculumId, term, 20);
    if (idRank !== null) { total += idRank; continue; }
    const pathRank = fieldRank(record.path, term, 30);
    if (pathRank !== null) { total += pathRank; continue; }
    const domainRank = fieldRank(record.domain, term, 40);
    if (domainRank !== null) { total += domainRank; continue; }
    total += 100;
  }
  return total;
}

function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return a.rank - b.rank
    || a.baseIndex - b.baseIndex
    || a.record.title.localeCompare(b.record.title)
    || a.record.path.localeCompare(b.record.path);
}

/**
 * Incremental exact-count/top-K collector. Its max-heap retains only the K
 * strongest matches; `finish()` sorts that bounded heap, never the full match
 * population.
 */
export class BoundedKnowledgeBaseSearchCollector<TSource extends KnowledgeBaseSearchSourceIdentity> {
  private readonly heap: RankedCandidate[] = [];
  private readonly totals: number[];
  private readonly limit: number;
  private examinedRecords = 0;
  private matchedRecords = 0;
  private peakRetainedCandidates = 0;

  constructor(
    private readonly sources: readonly TSource[],
    private readonly parsedQuery: ParsedQuery,
    limit = DEFAULT_CROSS_BASE_SEARCH_LIMIT,
  ) {
    this.limit = Math.max(0, Math.floor(limit));
    this.totals = sources.map(() => 0);
  }

  consider(baseIndex: number, record: VaultRecord, matchedPaths?: Set<string>): void {
    this.examinedRecords += 1;
    if (!matchesParsedQuery(record, this.parsedQuery)) return;
    if (matchedPaths?.has(record.path)) return;
    matchedPaths?.add(record.path);
    this.matchedRecords += 1;
    this.totals[baseIndex] = (this.totals[baseIndex] ?? 0) + 1;
    if (this.limit === 0) return;
    const candidate = { baseIndex, record, rank: knowledgeBaseSearchRank(record, this.parsedQuery) };
    if (this.heap.length < this.limit) {
      this.heap.push(candidate);
      this.siftUp(this.heap.length - 1);
      this.peakRetainedCandidates = Math.max(this.peakRetainedCandidates, this.heap.length);
      return;
    }
    const worst = this.heap[0];
    if (!worst || compareCandidates(candidate, worst) >= 0) return;
    this.heap[0] = candidate;
    this.siftDown(0);
  }

  finish(): KnowledgeBaseSearchResultSet<TSource> {
    const selected = [...this.heap].sort(compareCandidates);
    const selectedByBase = new Map<number, VaultRecord[]>();
    for (const candidate of selected) {
      const records = selectedByBase.get(candidate.baseIndex);
      if (records) records.push(candidate.record);
      else selectedByBase.set(candidate.baseIndex, [candidate.record]);
    }
    const groups: Array<KnowledgeBaseSearchGroup<TSource>> = [];
    const counts: Array<KnowledgeBaseSearchCount<TSource>> = [];
    for (let baseIndex = 0; baseIndex < this.sources.length; baseIndex += 1) {
      const source = this.sources[baseIndex];
      if (!source) continue;
      const total = this.totals[baseIndex] ?? 0;
      counts.push({ source, total });
      const records = selectedByBase.get(baseIndex);
      if (records && records.length > 0) groups.push({ source, records, total });
    }
    return {
      groups,
      counts,
      total: this.matchedRecords,
      rendered: selected.length,
      stats: {
        examinedRecords: this.examinedRecords,
        matchedRecords: this.matchedRecords,
        peakRetainedCandidates: this.peakRetainedCandidates,
        sortedCandidates: selected.length,
      },
    };
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentCandidate = this.heap[parent];
      const candidate = this.heap[index];
      if (!parentCandidate || !candidate || compareCandidates(parentCandidate, candidate) >= 0) return;
      this.heap[parent] = candidate;
      this.heap[index] = parentCandidate;
      index = parent;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worst = index;
      if (left < this.heap.length && compareCandidates(this.heap[left], this.heap[worst]) > 0) worst = left;
      if (right < this.heap.length && compareCandidates(this.heap[right], this.heap[worst]) > 0) worst = right;
      if (worst === index) return;
      const candidate = this.heap[index];
      this.heap[index] = this.heap[worst];
      this.heap[worst] = candidate;
      index = worst;
    }
  }
}

export function collectKnowledgeBaseSearchResults<TSource extends KnowledgeBaseSearchSourceIdentity>(
  sources: ReadonlyArray<{ source: TSource; records: Iterable<VaultRecord> }>,
  parsedQuery: ParsedQuery,
  limit = DEFAULT_CROSS_BASE_SEARCH_LIMIT,
): KnowledgeBaseSearchResultSet<TSource> {
  const collector = new BoundedKnowledgeBaseSearchCollector(sources.map(({ source }) => source), parsedQuery, limit);
  for (let baseIndex = 0; baseIndex < sources.length; baseIndex += 1) {
    const input = sources[baseIndex];
    if (!input) continue;
    const matchedPaths = new Set<string>();
    for (const record of input.records) {
      collector.consider(baseIndex, record, matchedPaths);
    }
  }
  return collector.finish();
}
