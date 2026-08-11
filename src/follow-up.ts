import { parseYaml } from "obsidian";

export const FOLLOW_UP_START_MARKER = "<!-- kbcc-follow-up:start:v1 -->";
export const FOLLOW_UP_END_MARKER = "<!-- kbcc-follow-up:end -->";
export const FOLLOW_UP_HEADING = "Follow-up notes";
export const MAX_FOLLOW_UP_CONTENT_BYTES = 10 * 1024 * 1024;
export const MAX_FOLLOW_UP_ENTRIES = 10_000;
export const MAX_FOLLOW_UP_CATEGORIES = 30;

const CATEGORY_MARKER_PREFIX = "<!-- kbcc-follow-up:category:";
const CATEGORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CATEGORY_MARKER_PATTERN = /^<!-- kbcc-follow-up:category:([A-Za-z0-9][A-Za-z0-9._-]{0,63}) -->$/;
const RESERVED_CATEGORY_IDS = new Set(["__proto__", "constructor", "prototype"]);
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069]/u;

export type FollowUpEntryStyle = "bullet" | "checkbox";

export interface FollowUpCategoryInput {
  /** Stable identity stored in the Markdown marker. Labels may be renamed. */
  id: string;
  label: string;
  style: FollowUpEntryStyle;
  includeDate: boolean;
}

export interface FollowUpCategoryDefinition extends FollowUpCategoryInput {
  /** Archived categories remain identifiable in existing notes but are hidden from entry pickers. */
  archived: boolean;
}

export const DEFAULT_FOLLOW_UP_CATEGORIES: readonly FollowUpCategoryDefinition[] = [
  { id: "questions", label: "Questions", style: "checkbox", includeDate: false, archived: false },
  { id: "lectures-to-watch", label: "Lectures to watch", style: "checkbox", includeDate: false, archived: false },
  { id: "sources", label: "Sources", style: "bullet", includeDate: false, archived: false },
  { id: "thoughts", label: "Thoughts", style: "bullet", includeDate: false, archived: false },
  { id: "to-read", label: "To read", style: "checkbox", includeDate: false, archived: false },
  { id: "other", label: "Other", style: "bullet", includeDate: false, archived: false },
];

export function followUpCategoryLabelKey(value: string): string {
  return value.normalize("NFC").trim().replace(/[ \t]+/gu, " ").toLocaleLowerCase("en-US");
}

export interface AppendFollowUpInput {
  content: string;
  category: FollowUpCategoryInput;
  text: string;
  /** Resolved by the caller so this transformer remains deterministic. */
  date?: string;
}

export interface FollowUpSpan {
  /** UTF-16 string offsets, matching JavaScript slice(). */
  start: number;
  end: number;
}

export interface FollowUpTextEdit extends FollowUpSpan {
  text: string;
}

export interface FollowUpReverseEdit extends FollowUpSpan {
  /** Compact fingerprint of the inserted span that must still be present. */
  expectedFingerprint: string;
  /** Original text restored into the span. Empty for an insertion-only append. */
  text: string;
}

export interface FollowUpUndoMetadata {
  version: 1;
  beforeLength: number;
  afterLength: number;
  /** Non-secret integrity fingerprint; exact span checks provide the second guard. */
  postFingerprint: string;
  reverseEdits: FollowUpReverseEdit[];
}

export type FollowUpTransformOperation = "created-block" | "created-category" | "appended-entry";

export interface AppendFollowUpResult {
  content: string;
  operation: FollowUpTransformOperation;
  edits: FollowUpTextEdit[];
  undo: FollowUpUndoMetadata;
  changedSpan: FollowUpSpan;
  blockSpan: FollowUpSpan;
  categorySpan: FollowUpSpan;
  entrySpan: FollowUpSpan;
}

interface MarkdownLine extends FollowUpSpan {
  contentEnd: number;
  text: string;
  eol: string;
  ignored: boolean;
}

interface ParsedHeading {
  level: 2 | 3;
  label: string;
}

interface ParsedCategory {
  id: string;
  markerLineIndex: number;
  headingLineIndex: number;
  label: string;
  boundaryLineIndex: number;
}

interface ParsedManagedBlock {
  startLineIndex: number;
  headingLineIndex: number;
  endLineIndex: number;
  categories: ParsedCategory[];
}

interface MarkdownAnalysis {
  lines: MarkdownLine[];
  block: ParsedManagedBlock | null;
  headings: Map<number, ParsedHeading>;
  eol: string;
}

interface PlannedEdit extends FollowUpTextEdit {
  entryRelativeStart?: number;
  entryRelativeEnd?: number;
}

interface AppliedEdits {
  content: string;
  edits: FollowUpTextEdit[];
  reverseEdits: FollowUpReverseEdit[];
  finalSpans: FollowUpSpan[];
}

function fail(message: string): never {
  throw new Error(`Cannot append follow-up: ${message}`);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertContentSize(value: string, phase: "input" | "output"): void {
  if (utf8ByteLength(value) > MAX_FOLLOW_UP_CONTENT_BYTES) {
    fail(`${phase} note content exceeds the 10 MiB safety limit.`);
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function hasUnsafeControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 8) || code === 11 || code === 12
      || (code >= 14 && code <= 31) || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function assertSafeUserText(value: string, label: string, multiline: boolean): string {
  if (hasUnpairedSurrogate(value)) fail(`${label} contains invalid Unicode.`);
  if (BIDI_CONTROL_PATTERN.test(value)) fail(`${label} contains unsupported bidirectional controls.`);
  if (hasUnsafeControl(value)) fail(`${label} contains unsupported control characters.`);
  if (!multiline && /[\r\n]/u.test(value)) fail(`${label} must be one line.`);
  return value.normalize("NFC");
}

function cleanCategory(input: FollowUpCategoryInput): FollowUpCategoryInput {
  const id = input.id;
  if (!CATEGORY_ID_PATTERN.test(id) || RESERVED_CATEGORY_IDS.has(id.toLowerCase())) {
    fail("the category ID must be 1-64 ASCII letters, digits, dots, underscores, or hyphens.");
  }
  const label = assertSafeUserText(input.label, "the category label", false).trim();
  if (!label || label.length > 100) fail("the category label must contain 1-100 characters.");
  if (/[ \t]#+[ \t]*$/u.test(label)) fail("the category label cannot end with Markdown closing hashes.");
  if (label.includes("<!--") || label.includes("-->")) fail("the category label cannot contain an HTML comment.");
  if (input.style !== "bullet" && input.style !== "checkbox") fail("the category style is unsupported.");
  return { id, label, style: input.style, includeDate: input.includeDate === true };
}

/** Recover the bounded, base-local category configuration from synced plugin data. */
export function cleanFollowUpCategoryDefinitions(input: unknown): FollowUpCategoryDefinition[] {
  if (input === undefined) return DEFAULT_FOLLOW_UP_CATEGORIES.map((category) => ({ ...category }));
  if (!Array.isArray(input)) return DEFAULT_FOLLOW_UP_CATEGORIES.map((category) => ({ ...category }));
  const categories: FollowUpCategoryDefinition[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const raw of input.slice(0, MAX_FOLLOW_UP_CATEGORIES)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const label = typeof value.label === "string" ? value.label.normalize("NFC").trim() : "";
    const labelKey = followUpCategoryLabelKey(label);
    if (!CATEGORY_ID_PATTERN.test(id) || RESERVED_CATEGORY_IDS.has(id.toLowerCase()) || ids.has(id) || labels.has(labelKey)) continue;
    if (!label || label.length > 100 || /[\r\n]/u.test(label) || hasUnsafeControl(label)
      || hasUnpairedSurrogate(label) || BIDI_CONTROL_PATTERN.test(label)
      || label.includes("<!--") || label.includes("-->") || /[ \t]#+[ \t]*$/u.test(label)) continue;
    ids.add(id);
    labels.add(labelKey);
    categories.push({
      id,
      label,
      style: value.style === "checkbox" ? "checkbox" : "bullet",
      includeDate: value.includeDate === true,
      archived: value.archived === true,
    });
  }
  return categories;
}

export function allocateFollowUpCategoryId(label: string, existingIds: ReadonlySet<string>): string {
  const normalized = label.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en-US");
  const stem = normalized.replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || "category";
  let candidate = RESERVED_CATEGORY_IDS.has(stem) ? `follow-up-${stem}` : stem;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    const suffixText = `-${String(suffix)}`;
    candidate = `${stem.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Fail closed on a top-level ai_lock property inside the leading YAML block.
 * Only an explicit unquoted false/null value is writable; ambiguous YAML is
 * treated as locked without needing a second non-atomic metadata read.
 */
export function assertFollowUpNoteWritable(content: string): void {
  const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = normalized.split(/\r\n|\n|\r/u);
  if (lines[0] !== "---") return;
  let closed = false;
  let closingIndex = -1;
  let lockOccurrences = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "---" || line === "...") {
      closed = true;
      closingIndex = index;
      break;
    }
    if (!line.includes("ai_lock")) continue;
    const match = /^(?:ai_lock|'ai_lock'|"ai_lock")[ \t]*:[ \t]*(.*)$/u.exec(line);
    if (!match) fail("the YAML contains an ambiguous ai_lock declaration.");
    lockOccurrences += 1;
    const value = (match[1] ?? "").trim();
    if (!/^(?:false|null|~)(?:[ \t]+#.*)?$/iu.test(value)) {
      fail("this note has ai_lock enabled and cannot be changed.");
    }
  }
  if (!closed) fail("the YAML frontmatter is not closed.");
  let parsed: unknown;
  try {
    parsed = parseYaml(lines.slice(1, closingIndex).join("\n")) as unknown;
  } catch {
    fail("the YAML frontmatter could not be parsed safely.");
  }
  if (parsed !== null && parsed !== undefined
    && (typeof parsed !== "object" || Array.isArray(parsed))) {
    fail("the YAML frontmatter must be a property mapping.");
  }
  const parsedProperties = (parsed ?? {}) as Record<string, unknown>;
  const hasParsedLock = Object.prototype.hasOwnProperty.call(parsedProperties, "ai_lock");
  if (hasParsedLock) {
    const value = parsedProperties.ai_lock;
    if (value !== false && value !== null) {
      fail("this note has ai_lock enabled and cannot be changed.");
    }
    // An escaped, merged, flow-style, or otherwise non-canonical key may parse
    // as ai_lock even though the conservative line audit cannot prove that it
    // is one unambiguous top-level declaration. Refuse it rather than guessing.
    if (lockOccurrences !== 1) fail("the YAML contains an ambiguous ai_lock declaration.");
  } else if (lockOccurrences > 0) {
    fail("the YAML contains an ambiguous ai_lock declaration.");
  }
  // Duplicate explicit-false keys are still malformed/ambiguous YAML. The
  // standard single key remains writable.
  if (lockOccurrences > 1) fail("the YAML contains duplicate ai_lock declarations.");
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function cleanEntryText(value: string): string[] {
  const normalized = assertSafeUserText(value, "the follow-up text", true)
    .replace(/\r\n|\r/gu, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0 || lines.every((line) => line.trim() === "")) fail("the follow-up text is empty.");
  return lines.map((line) => line.trimEnd());
}

function renderEntry(
  category: FollowUpCategoryInput,
  textLines: string[],
  date: string | undefined,
  eol: string,
): string {
  let datePrefix = "";
  if (category.includeDate) {
    const cleanDate = date?.trim() ?? "";
    if (!validIsoDate(cleanDate)) fail("a real ISO date (YYYY-MM-DD) is required for this category.");
    datePrefix = `${cleanDate} — `;
  }
  const prefix = category.style === "checkbox" ? "- [ ] " : "- ";
  const first = `${prefix}${datePrefix}${textLines[0] ?? ""}`;
  // Continuation indentation keeps a user-supplied marker or heading inside the
  // list item instead of allowing it to become managed Markdown structure.
  const continuation = textLines.slice(1).map((line) => `  ${line}`);
  return [first, ...continuation].join(eol);
}

function splitMarkdownLines(content: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  while (start < content.length) {
    let cursor = start;
    while (cursor < content.length && content[cursor] !== "\n" && content[cursor] !== "\r") cursor += 1;
    const contentEnd = cursor;
    let eol = "";
    if (cursor < content.length) {
      if (content[cursor] === "\r" && content[cursor + 1] === "\n") {
        eol = "\r\n";
        cursor += 2;
      } else {
        eol = content[cursor] ?? "";
        cursor += 1;
      }
    }
    lines.push({
      start,
      contentEnd,
      end: cursor,
      text: content.slice(start, contentEnd),
      eol,
      ignored: false,
    });
    start = cursor;
  }
  if (content.length === 0 || /[\r\n]$/u.test(content)) {
    lines.push({ start: content.length, contentEnd: content.length, end: content.length, text: "", eol: "", ignored: false });
  }
  return lines;
}

function markIgnoredMarkdown(lines: MarkdownLine[], hasBom: boolean): void {
  let firstContentLine = 0;
  if (hasBom && lines[0]) {
    lines[0].text = lines[0].text.slice(1);
    lines[0].start += 1;
    firstContentLine = 0;
  }
  if (lines[firstContentLine]?.text === "---") {
    let closing = -1;
    for (let index = firstContentLine + 1; index < lines.length; index += 1) {
      if (lines[index]?.text === "---" || lines[index]?.text === "...") {
        closing = index;
        break;
      }
    }
    if (closing < 0) fail("the YAML frontmatter is not closed.");
    for (let index = firstContentLine; index <= closing; index += 1) {
      const line = lines[index];
      if (line) line.ignored = true;
    }
  }

  let fenceCharacter = "";
  let fenceLength = 0;
  for (const line of lines) {
    if (line.ignored) continue;
    if (fenceCharacter) {
      line.ignored = true;
      const closing = /^( {0,3})(`+|~+)[ \t]*$/u.exec(line.text);
      if (closing && closing[2]?.[0] === fenceCharacter && closing[2].length >= fenceLength) {
        fenceCharacter = "";
      }
      continue;
    }
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(line.text);
    if (!opening) continue;
    const fence = opening[2] ?? "";
    if (fence.startsWith("`") && (opening[3] ?? "").includes("`")) continue;
    fenceCharacter = fence[0] ?? "";
    fenceLength = fence.length;
    line.ignored = true;
  }
  if (fenceCharacter) {
    // An unclosed ordinary code fence is valid Markdown. It remains ignored to
    // EOF, and a new managed block is appended only after the fence is closed.
    fail("the Markdown code fence is not closed.");
  }
}

function headingFromLine(line: MarkdownLine): ParsedHeading | null {
  if (line.ignored) return null;
  const match = /^(##|###)[ \t]+(.+?)[ \t]*$/u.exec(line.text);
  if (!match) return null;
  let label = match[2] ?? "";
  label = label.replace(/[ \t]+#+[ \t]*$/u, "").trim();
  if (!label) return null;
  return { level: match[1] === "##" ? 2 : 3, label };
}

function normalizedHeadingLabel(value: string): string {
  return value.normalize("NFC").trim().replace(/[ \t]+/gu, " ").toLocaleLowerCase("en-US");
}

function firstNonblankLine(lines: MarkdownLine[], start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (line && !line.ignored && line.text.trim() !== "") return index;
  }
  return -1;
}

function detectEol(lines: MarkdownLine[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.eol) continue;
    counts.set(line.eol, (counts.get(line.eol) ?? 0) + 1);
  }
  const candidates = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? "\n";
}

function analyzeMarkdown(content: string): MarkdownAnalysis {
  const hasBom = content.startsWith("\uFEFF");
  const lines = splitMarkdownLines(content);
  markIgnoredMarkdown(lines, hasBom);
  const headings = new Map<number, ParsedHeading>();
  const startLines: number[] = [];
  const endLines: number[] = [];
  const categoryMarkers: Array<{ id: string; lineIndex: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.ignored) continue;
    const heading = headingFromLine(line);
    if (heading) headings.set(index, heading);
    if (line.text === FOLLOW_UP_START_MARKER) {
      startLines.push(index);
    } else if (line.text === FOLLOW_UP_END_MARKER) {
      endLines.push(index);
    } else {
      const category = CATEGORY_MARKER_PATTERN.exec(line.text);
      if (category) {
        const id = category[1] ?? "";
        if (RESERVED_CATEGORY_IDS.has(id.toLowerCase())) {
          fail(`line ${index + 1} contains a reserved managed category ID.`);
        }
        categoryMarkers.push({ id, lineIndex: index });
      } else if (line.text.startsWith("<!-- kbcc-follow-up:")) {
        fail(`line ${index + 1} contains an unknown or malformed managed marker.`);
      }
    }
  }

  if (startLines.length > 1) fail("the note contains duplicate or nested start markers.");
  if (endLines.length > 1) fail("the note contains duplicate end markers.");
  if (startLines.length !== endLines.length) fail("the managed block markers are unbalanced.");
  if (startLines.length === 0) {
    if (categoryMarkers.length > 0) fail("a managed category marker exists outside a managed block.");
    return { lines, block: null, headings, eol: detectEol(lines) };
  }

  const startLineIndex = startLines[0] ?? -1;
  const endLineIndex = endLines[0] ?? -1;
  if (startLineIndex >= endLineIndex) fail("the managed block end marker occurs before its start marker.");
  for (const marker of categoryMarkers) {
    if (marker.lineIndex <= startLineIndex || marker.lineIndex >= endLineIndex) {
      fail("a managed category marker exists outside the managed block.");
    }
  }

  const headingLineIndex = firstNonblankLine(lines, startLineIndex + 1, endLineIndex);
  const blockHeading = headings.get(headingLineIndex);
  if (!blockHeading || blockHeading.level !== 2 || blockHeading.label !== FOLLOW_UP_HEADING) {
    fail(`the v1 block must begin with "## ${FOLLOW_UP_HEADING}".`);
  }
  const extraH2 = [...headings.entries()].find(([lineIndex, heading]) => (
    lineIndex > startLineIndex && lineIndex < endLineIndex
      && lineIndex !== headingLineIndex && heading.level === 2
  ));
  if (extraH2) fail("the managed block contains an unexpected second-level heading.");

  const ids = new Set<string>();
  const categories: ParsedCategory[] = [];
  const sortedMarkers = [...categoryMarkers].sort((left, right) => left.lineIndex - right.lineIndex);
  for (let index = 0; index < sortedMarkers.length; index += 1) {
    const marker = sortedMarkers[index];
    if (!marker) continue;
    if (ids.has(marker.id)) fail(`the managed category ID "${marker.id}" is duplicated.`);
    ids.add(marker.id);
    const boundaryLineIndex = sortedMarkers[index + 1]?.lineIndex ?? endLineIndex;
    const categoryHeadingLine = firstNonblankLine(lines, marker.lineIndex + 1, boundaryLineIndex);
    const categoryHeading = headings.get(categoryHeadingLine);
    if (!categoryHeading || categoryHeading.level !== 3) {
      fail(`managed category "${marker.id}" is missing its third-level heading.`);
    }
    assertSafeUserText(categoryHeading.label, `managed category "${marker.id}"`, false);
    categories.push({
      id: marker.id,
      markerLineIndex: marker.lineIndex,
      headingLineIndex: categoryHeadingLine,
      label: categoryHeading.label,
      boundaryLineIndex,
    });
  }

  const ownedH3Lines = new Set(categories.map((category) => category.headingLineIndex));
  for (const [lineIndex, heading] of headings) {
    if (heading.level === 3 && lineIndex > startLineIndex && lineIndex < endLineIndex && !ownedH3Lines.has(lineIndex)) {
      fail("the managed block contains an unmanaged third-level heading.");
    }
  }
  const categoryLabels = new Set<string>();
  for (const category of categories) {
    const key = normalizedHeadingLabel(category.label);
    if (categoryLabels.has(key)) fail(`the managed category heading "${category.label}" is duplicated.`);
    categoryLabels.add(key);
  }

  return {
    lines,
    headings,
    eol: lines[startLineIndex]?.eol || detectEol(lines),
    block: { startLineIndex, headingLineIndex, endLineIndex, categories },
  };
}

function assertHeadingOwnership(
  analysis: MarkdownAnalysis,
  category: FollowUpCategoryInput,
  selected: ParsedCategory | undefined,
): void {
  const labels = new Set([normalizedHeadingLabel(category.label)]);
  if (selected) labels.add(normalizedHeadingLabel(selected.label));
  const ownedLine = selected?.headingLineIndex ?? -1;
  for (const [lineIndex, heading] of analysis.headings) {
    if (heading.level !== 3 || lineIndex === ownedLine) continue;
    if (labels.has(normalizedHeadingLabel(heading.label))) {
      fail(`the third-level heading "${heading.label}" is not owned by the selected category marker.`);
    }
  }

  const followUpHeadingKey = normalizedHeadingLabel(FOLLOW_UP_HEADING);
  const ownedH2 = analysis.block?.headingLineIndex ?? -1;
  for (const [lineIndex, heading] of analysis.headings) {
    if (heading.level === 2 && lineIndex !== ownedH2
      && normalizedHeadingLabel(heading.label) === followUpHeadingKey) {
      fail(`an unmanaged "## ${FOLLOW_UP_HEADING}" heading already exists.`);
    }
  }
}

function countManagedEntries(analysis: MarkdownAnalysis): number {
  const block = analysis.block;
  if (!block) return 0;
  let count = 0;
  for (let index = block.headingLineIndex + 1; index < block.endLineIndex; index += 1) {
    const line = analysis.lines[index];
    if (line && !line.ignored && /^- (?:\[[ xX]\] )?/u.test(line.text)) count += 1;
  }
  return count;
}

function separatorBeforeAppendedBlock(content: string, eol: string): string {
  if (!content) return "";
  if (content.endsWith(`${eol}${eol}`)) return "";
  if (content.endsWith(eol)) return eol;
  return `${eol}${eol}`;
}

function planAppend(
  content: string,
  analysis: MarkdownAnalysis,
  category: FollowUpCategoryInput,
  entry: string,
): { operation: FollowUpTransformOperation; edits: PlannedEdit[] } {
  const eol = analysis.eol;
  const block = analysis.block;
  if (!block) {
    const separator = separatorBeforeAppendedBlock(content, eol);
    const inserted = [
      separator,
      FOLLOW_UP_START_MARKER,
      eol,
      `## ${FOLLOW_UP_HEADING}`,
      eol,
      `${CATEGORY_MARKER_PREFIX}${category.id} -->`,
      eol,
      `### ${category.label}`,
      eol,
      entry,
      eol,
      FOLLOW_UP_END_MARKER,
    ].join("");
    const entryRelativeStart = inserted.indexOf(entry, separator.length);
    return {
      operation: "created-block",
      edits: [{
        start: content.length,
        end: content.length,
        text: inserted,
        entryRelativeStart,
        entryRelativeEnd: entryRelativeStart + entry.length,
      }],
    };
  }

  const selected = block.categories.find((item) => item.id === category.id);
  if (!selected) {
    const endLine = analysis.lines[block.endLineIndex];
    if (!endLine) fail("the managed block end marker is unavailable.");
    const inserted = [
      `${CATEGORY_MARKER_PREFIX}${category.id} -->`,
      eol,
      `### ${category.label}`,
      eol,
      entry,
      eol,
    ].join("");
    const entryRelativeStart = inserted.indexOf(entry);
    return {
      operation: "created-category",
      edits: [{
        start: endLine.start,
        end: endLine.start,
        text: inserted,
        entryRelativeStart,
        entryRelativeEnd: entryRelativeStart + entry.length,
      }],
    };
  }

  const edits: PlannedEdit[] = [];
  const headingLine = analysis.lines[selected.headingLineIndex];
  if (!headingLine) fail("the selected category heading is unavailable.");
  const nextHeadingText = `### ${category.label}`;
  if (headingLine.text !== nextHeadingText) {
    edits.push({ start: headingLine.start, end: headingLine.contentEnd, text: nextHeadingText });
  }

  let lastContentLineIndex = -1;
  for (let index = selected.boundaryLineIndex - 1; index > selected.headingLineIndex; index -= 1) {
    const line = analysis.lines[index];
    if (line && line.text.trim() !== "") {
      lastContentLineIndex = index;
      break;
    }
  }
  const insertionOffset = lastContentLineIndex >= 0
    ? analysis.lines[lastContentLineIndex]?.end
    : headingLine.end;
  if (insertionOffset === undefined) fail("the selected category insertion point is unavailable.");
  edits.push({
    start: insertionOffset,
    end: insertionOffset,
    text: `${entry}${eol}`,
    entryRelativeStart: 0,
    entryRelativeEnd: entry.length,
  });
  return { operation: "appended-entry", edits };
}

function assertNonOverlappingEdits(content: string, edits: PlannedEdit[]): PlannedEdit[] {
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  let previousEnd = -1;
  for (const edit of sorted) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < 0 || edit.end < edit.start || edit.end > content.length) {
      fail("an internal text edit has an invalid span.");
    }
    if (edit.start < previousEnd) fail("internal text edits overlap.");
    previousEnd = edit.end;
  }
  return sorted;
}

function applyPlannedEdits(content: string, planned: PlannedEdit[]): AppliedEdits {
  const edits = assertNonOverlappingEdits(content, planned);
  let output = content;
  for (const edit of [...edits].reverse()) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }

  let delta = 0;
  const reverseEdits: FollowUpReverseEdit[] = [];
  const finalSpans: FollowUpSpan[] = [];
  for (const edit of edits) {
    const finalStart = edit.start + delta;
    const finalEnd = finalStart + edit.text.length;
    reverseEdits.push({
      start: finalStart,
      end: finalEnd,
      expectedFingerprint: contentFingerprint(edit.text),
      text: content.slice(edit.start, edit.end),
    });
    const relativeStart = edit.entryRelativeStart;
    const relativeEnd = edit.entryRelativeEnd;
    if (relativeStart !== undefined && relativeEnd !== undefined) {
      finalSpans.push({ start: finalStart + relativeStart, end: finalStart + relativeEnd });
    } else {
      finalSpans.push({ start: finalStart, end: finalEnd });
    }
    delta += edit.text.length - (edit.end - edit.start);
  }
  return { content: output, edits, reverseEdits, finalSpans };
}

function contentFingerprint(content: string): string {
  let left = 0x811C9DC5;
  let right = 0x9E3779B9;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85EBCA6B) >>> 0;
  }
  return `v1:${content.length}:${left.toString(16).padStart(8, "0")}:${right.toString(16).padStart(8, "0")}`;
}

function spanForBlock(analysis: MarkdownAnalysis): FollowUpSpan {
  const block = analysis.block;
  if (!block) fail("the transformed managed block is missing.");
  const start = analysis.lines[block.startLineIndex];
  const end = analysis.lines[block.endLineIndex];
  if (!start || !end) fail("the transformed managed block span is unavailable.");
  return { start: start.start, end: end.end };
}

function spanForCategory(analysis: MarkdownAnalysis, id: string): FollowUpSpan {
  const block = analysis.block;
  const category = block?.categories.find((item) => item.id === id);
  if (!block || !category) fail("the transformed managed category is missing.");
  const start = analysis.lines[category.markerLineIndex];
  const boundary = analysis.lines[category.boundaryLineIndex];
  if (!start || !boundary) fail("the transformed managed category span is unavailable.");
  return { start: start.start, end: boundary.start };
}

/**
 * Append one user-confirmed follow-up entry to a strict, owned v1 Markdown
 * block. This function performs no file I/O and uses no clock or Obsidian API.
 */
export function appendFollowUpEntry(input: AppendFollowUpInput): AppendFollowUpResult {
  assertContentSize(input.content, "input");
  const category = cleanCategory(input.category);
  const analysis = analyzeMarkdown(input.content);
  const selected = analysis.block?.categories.find((item) => item.id === category.id);
  assertHeadingOwnership(analysis, category, selected);
  if (countManagedEntries(analysis) >= MAX_FOLLOW_UP_ENTRIES) {
    fail("the managed block already contains 10,000 entries.");
  }
  const entry = renderEntry(category, cleanEntryText(input.text), input.date, analysis.eol);
  const plan = planAppend(input.content, analysis, category, entry);
  const applied = applyPlannedEdits(input.content, plan.edits);
  assertContentSize(applied.content, "output");

  // Re-parse our own output before returning it. This proves that an entry did
  // not inject a marker/heading and that every returned span is structurally owned.
  const transformed = analyzeMarkdown(applied.content);
  if (countManagedEntries(transformed) > MAX_FOLLOW_UP_ENTRIES) {
    fail("the managed block exceeds 10,000 entries.");
  }
  const entrySpan = applied.finalSpans.find((span, index) => plan.edits[index]?.entryRelativeStart !== undefined);
  if (!entrySpan) fail("the appended entry span is unavailable.");
  const changedSpan = applied.reverseEdits.reduce<FollowUpSpan>((span, edit) => ({
    start: Math.min(span.start, edit.start),
    end: Math.max(span.end, edit.end),
  }), { start: applied.content.length, end: 0 });

  return {
    content: applied.content,
    operation: plan.operation,
    edits: applied.edits.map(({ start, end, text }) => ({ start, end, text })),
    undo: {
      version: 1,
      beforeLength: input.content.length,
      afterLength: applied.content.length,
      postFingerprint: contentFingerprint(applied.content),
      reverseEdits: applied.reverseEdits,
    },
    changedSpan,
    blockSpan: spanForBlock(transformed),
    categorySpan: spanForCategory(transformed, category.id),
    entrySpan,
  };
}

/**
 * Apply a transient reverse edit only while the note is still byte-for-byte in
 * the state produced by appendFollowUpEntry(). No whole-note snapshot is kept.
 */
export function reverseFollowUpAppend(content: string, undo: FollowUpUndoMetadata): string {
  if (undo.version !== 1 || content.length !== undo.afterLength
    || contentFingerprint(content) !== undo.postFingerprint) {
    fail("the note changed after the append, so transient undo is no longer safe.");
  }
  const edits = [...undo.reverseEdits].sort((left, right) => left.start - right.start || left.end - right.end);
  let previousEnd = -1;
  for (const edit of edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < 0 || edit.end < edit.start || edit.end > content.length || edit.start < previousEnd) {
      fail("the transient undo metadata is invalid.");
    }
    if (contentFingerprint(content.slice(edit.start, edit.end)) !== edit.expectedFingerprint) {
      fail("the appended span no longer matches the transient undo metadata.");
    }
    previousEnd = edit.end;
  }
  let output = content;
  for (const edit of [...edits].reverse()) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  if (output.length !== undo.beforeLength) fail("the transient undo result has an unexpected length.");
  return output;
}
