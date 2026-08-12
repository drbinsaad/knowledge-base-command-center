import { normalizePath } from "obsidian";
import { sanitizeFileName } from "./model";

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type AttachmentInsertTarget = "marker" | "heading" | "end";

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

function fenceState(lines: readonly string[]): { outside: boolean[]; unclosed: boolean } {
  const outside: boolean[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;
  for (const line of lines) {
    if (!fence) {
      const opening = /^\s*(`{3,}|~{3,})/u.exec(line);
      outside.push(opening === null);
      if (!opening) continue;
      const sequence = opening[1] ?? "";
      fence = { character: sequence[0] as "`" | "~", length: sequence.length };
      continue;
    }
    outside.push(false);
    const closing = /^\s*(`{3,}|~{3,})\s*$/u.exec(line);
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
  const lines = markdown.split(/\r?\n/u);
  const { outside: outsideFence, unclosed } = fenceState(lines);
  if (unclosed) throw new Error("The note contains an unclosed fenced code block. Close it before inserting an attachment link.");
  if (target === "end") return appendLine(markdown, cleanReference, eol);
  if (target === "marker") {
    const cleanMarker = marker.trim();
    if (!cleanMarker) return appendLine(markdown, cleanReference, eol);
    const markerIndex = lines.findIndex((line, index) => outsideFence[index] === true && line.trim() === cleanMarker);
    if (markerIndex < 0) {
      const block = `${cleanMarker}${eol}${cleanReference}`;
      return appendLine(markdown, block, eol);
    }
    let insertionIndex = markerIndex + 1;
    while (insertionIndex < lines.length
      && !(outsideFence[insertionIndex] === true && /^#{1,6}\s+/u.test(lines[insertionIndex] ?? ""))) insertionIndex += 1;
    while (insertionIndex > markerIndex + 1 && !(lines[insertionIndex - 1] ?? "").trim()) insertionIndex -= 1;
    lines.splice(insertionIndex, 0, cleanReference);
    return lines.join(eol);
  }

  const wanted = normalizedHeading(heading);
  if (!wanted) return appendLine(markdown, cleanReference, eol);
  const headingIndex = lines.findIndex((line, index) => {
    if (outsideFence[index] !== true) return false;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    return match ? normalizedHeading(match[2] ?? "") === wanted : false;
  });
  if (headingIndex < 0) {
    const cleanHeading = heading.trim().replace(/^#{1,6}\s+/u, "").replace(/\s+#+\s*$/u, "");
    const block = `## ${cleanHeading}${eol}${eol}${cleanReference}`;
    return appendLine(markdown, block, eol);
  }
  const currentLevel = /^(#{1,6})\s+/u.exec(lines[headingIndex] ?? "")?.[1]?.length ?? 2;
  let insertionIndex = headingIndex + 1;
  while (insertionIndex < lines.length) {
    const nextLevel = outsideFence[insertionIndex] === true
      ? /^(#{1,6})\s+/u.exec(lines[insertionIndex] ?? "")?.[1]?.length
      : undefined;
    if (nextLevel !== undefined && nextLevel <= currentLevel) break;
    insertionIndex += 1;
  }
  while (insertionIndex > headingIndex + 1 && !(lines[insertionIndex - 1] ?? "").trim()) insertionIndex -= 1;
  lines.splice(insertionIndex, 0, cleanReference);
  return lines.join(eol);
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
