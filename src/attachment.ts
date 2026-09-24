import { normalizePath } from "obsidian";
import { sanitizeFileName } from "./model";
import { markdownBodyStartLine } from "./follow-up";

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
/** Files accepted by one Attach file submission; each file still has its own size limit. */
export const MAX_ATTACHMENT_FILES = 20;

export type AttachmentInsertTarget = "marker" | "heading" | "end";

/**
 * How a generated link is shown in the note. "auto" previews every type that
 * Obsidian can render inside a note and links everything else.
 */
export type AttachmentDisplayMode = "auto" | "embed" | "link";

/** Extensions Obsidian renders inline when embedded with `![[…]]`. */
const PREVIEWABLE_ATTACHMENT_EXTENSIONS = new Set([
  // Images
  "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp",
  // Audio
  "3gp", "flac", "m4a", "mp3", "ogg", "wav",
  // Video (webm may be audio or video; Obsidian embeds both)
  "mkv", "mov", "mp4", "ogv", "webm",
  // Documents
  "pdf",
]);

export function attachmentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLocaleLowerCase() : "";
}

export function attachmentCanPreview(fileName: string): boolean {
  return PREVIEWABLE_ATTACHMENT_EXTENSIONS.has(attachmentExtension(fileName));
}

/**
 * Turn Obsidian's generated link into the requested display form. Without a
 * display choice the generated link is returned unchanged.
 */
export function attachmentReference(link: string, fileName: string, display?: AttachmentDisplayMode): string {
  const clean = link.trim();
  if (!clean || display === undefined) return clean;
  const embed = display === "embed" || (display === "auto" && attachmentCanPreview(fileName));
  const bare = clean.startsWith("!") ? clean.slice(1) : clean;
  return embed ? `!${bare}` : bare;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function documentEol(markdown: string): "\r\n" | "\n" {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

function appendLine(markdown: string, reference: string, eol: string): string {
  const clean = markdown.replace(/[\r\n]+$/u, "");
  return `${clean}${clean ? `${eol}${eol}` : ""}${reference}${eol}`;
}

function normalizedHeading(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/\s+#+\s*$/u, "")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

interface DocumentLine {
  /** Line content without its terminator. */
  text: string;
  /** Character offset of the first character of the line. */
  start: number;
  /** Exact terminator of this line; empty for the final unterminated line. */
  eol: string;
}

/**
 * Split into lines while remembering each original offset and terminator, so an
 * insertion can be spliced into the source string without touching other bytes.
 */
function documentLines(markdown: string): DocumentLine[] {
  const lines: DocumentLine[] = [];
  const breaks = /\r\n|\n|\r/gu;
  let start = 0;
  for (let match = breaks.exec(markdown); match !== null; match = breaks.exec(markdown)) {
    lines.push({ text: markdown.slice(start, match.index), start, eol: match[0] });
    start = breaks.lastIndex;
  }
  lines.push({ text: markdown.slice(start), start, eol: "" });
  return lines;
}

function lineBreakBefore(markdown: string, lines: readonly DocumentLine[], index: number): string {
  for (let cursor = Math.min(index, lines.length) - 1; cursor >= 0; cursor -= 1) {
    const eol = lines[cursor]?.eol;
    if (eol) return eol;
  }
  return documentEol(markdown);
}

/** Insert one whole line before `index`, preserving every existing byte. */
function spliceLine(markdown: string, lines: readonly DocumentLine[], index: number, reference: string): string {
  const eol = lineBreakBefore(markdown, lines, index);
  if (index >= lines.length) return `${markdown}${eol}${reference}`;
  const offset = lines[index]?.start ?? markdown.length;
  return `${markdown.slice(0, offset)}${reference}${eol}${markdown.slice(offset)}`;
}

function fenceState(lines: readonly DocumentLine[], bodyStart: number): { outside: boolean[]; unclosed: boolean } {
  const outside: boolean[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;
  for (const [index, line] of lines.entries()) {
    if (index < bodyStart) {
      outside.push(false);
      continue;
    }
    if (!fence) {
      // CommonMark allows at most three spaces of indentation before a fence;
      // deeper indentation is indented-code content, and a backtick fence's
      // info string cannot contain a backtick, exactly as follow-up.ts parses
      // the same construct.
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line.text);
      const opening = match && !(match[1]?.startsWith("`") && (match[2] ?? "").includes("`")) ? match : null;
      outside.push(opening === null);
      if (!opening) continue;
      const sequence = opening[1] ?? "";
      fence = { character: sequence[0] as "`" | "~", length: sequence.length };
      continue;
    }
    outside.push(false);
    const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line.text);
    if (!closing) continue;
    const sequence = closing[1] ?? "";
    if (sequence[0] === fence.character && sequence.length >= fence.length) fence = null;
  }
  return { outside, unclosed: fence !== null };
}

/**
 * Insert one generated Markdown attachment reference without rewriting any
 * existing prose. Cursor insertion is handled by Obsidian's Editor; this pure
 * helper owns only durable note-body locations.
 */
export function insertAttachmentReference(
  markdown: string,
  reference: string,
  target: AttachmentInsertTarget,
  marker: string,
  heading: string,
): string {
  const cleanReference = reference.trim();
  if (!cleanReference) return markdown;
  const eol = documentEol(markdown);
  const lines = documentLines(markdown);
  const bodyStart = markdownBodyStartLine(lines.map((line) => line.text));
  const { outside: outsideFence, unclosed } = fenceState(lines, bodyStart);
  if (unclosed) throw new Error("The note contains an unclosed fenced code block. Close it before inserting an attachment link.");
  if (target === "end") return appendLine(markdown, cleanReference, eol);
  if (target === "marker") {
    const cleanMarker = marker.trim();
    if (!cleanMarker) return appendLine(markdown, cleanReference, eol);
    const markerIndex = lines.findIndex((line, index) => outsideFence[index] === true && line.text.trim() === cleanMarker);
    if (markerIndex < 0) {
      const block = `${cleanMarker}${eol}${cleanReference}`;
      return appendLine(markdown, block, eol);
    }
    let insertionIndex = markerIndex + 1;
    while (insertionIndex < lines.length
      && !(outsideFence[insertionIndex] === true && /^#{1,6}\s+/u.test(lines[insertionIndex]?.text ?? ""))) insertionIndex += 1;
    while (insertionIndex > markerIndex + 1 && !(lines[insertionIndex - 1]?.text ?? "").trim()) insertionIndex -= 1;
    return spliceLine(markdown, lines, insertionIndex, cleanReference);
  }

  const wanted = normalizedHeading(heading);
  if (!wanted) return appendLine(markdown, cleanReference, eol);
  const headingIndex = lines.findIndex((line, index) => {
    if (outsideFence[index] !== true) return false;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line.text);
    return match ? normalizedHeading(match[2] ?? "") === wanted : false;
  });
  if (headingIndex < 0) {
    const cleanHeading = heading.trim().replace(/^#{1,6}\s+/u, "").replace(/\s+#+\s*$/u, "");
    const block = `## ${cleanHeading}${eol}${eol}${cleanReference}`;
    return appendLine(markdown, block, eol);
  }
  const currentLevel = /^(#{1,6})\s+/u.exec(lines[headingIndex]?.text ?? "")?.[1]?.length ?? 2;
  let insertionIndex = headingIndex + 1;
  while (insertionIndex < lines.length) {
    const nextLevel = outsideFence[insertionIndex] === true
      ? /^(#{1,6})\s+/u.exec(lines[insertionIndex]?.text ?? "")?.[1]?.length
      : undefined;
    if (nextLevel !== undefined && nextLevel <= currentLevel) break;
    insertionIndex += 1;
  }
  while (insertionIndex > headingIndex + 1 && !(lines[insertionIndex - 1]?.text ?? "").trim()) insertionIndex -= 1;
  return spliceLine(markdown, lines, insertionIndex, cleanReference);
}

/**
 * Insert several references in order at one durable location. End-of-note
 * references stay together as one block instead of one block per file.
 */
export function insertAttachmentReferences(
  markdown: string,
  references: readonly string[],
  target: AttachmentInsertTarget,
  marker: string,
  heading: string,
): string {
  const clean = references.map((reference) => reference.trim()).filter(Boolean);
  if (target === "end") return insertAttachmentReference(markdown, clean.join(documentEol(markdown)), target, marker, heading);
  return clean.reduce((current, reference) => insertAttachmentReference(current, reference, target, marker, heading), markdown);
}

export function attachmentFileName(input: string): string {
  const clean = sanitizeFileName(input).replace(/^\.+/u, "");
  return clean || "attachment";
}

export function canonicalAttachmentFolder(input: string): string {
  return normalizePath(input.trim().replace(/^\/+|\/+$/gu, ""));
}

export function noteAttachmentFolder(notePath: string): string {
  const clean = normalizePath(notePath);
  const slash = clean.lastIndexOf("/");
  const parent = slash >= 0 ? clean.slice(0, slash) : "";
  const file = slash >= 0 ? clean.slice(slash + 1) : clean;
  const basename = file.replace(/\.md$/iu, "") || "note";
  return normalizePath(`${parent ? `${parent}/` : ""}${attachmentFileName(basename)} attachments`);
}

export function attachmentPathCandidate(folder: string, originalName: string, suffix = 0): string {
  const cleanName = attachmentFileName(originalName);
  const dot = cleanName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < cleanName.length - 1;
  const base = hasExtension ? cleanName.slice(0, dot) : cleanName;
  const extension = hasExtension ? cleanName.slice(dot) : "";
  const numbered = suffix > 0 ? `${base} ${suffix}${extension}` : cleanName;
  return normalizePath(`${folder ? `${folder}/` : ""}${numbered}`);
}
