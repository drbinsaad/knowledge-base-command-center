import { parseLinktext, setIcon, TFile, type App, type CachedMetadata } from "obsidian";

const MAX_REFERENCE_LENGTH = 2048;
export const ATTACHMENT_PAGE_SIZE = 20;

export interface NoteAttachment {
  path: string;
  name: string;
  extension: string;
  available: boolean;
}

export interface NoteAttachments {
  state: "ready" | "waiting" | "note-unavailable";
  items: NoteAttachment[];
}

/** Accept internal references only; no value from note content becomes a URL. */
function localReference(value: unknown, property = false): { literal: string; decoded: string } | null {
  if (typeof value !== "string" || value.length > MAX_REFERENCE_LENGTH) return null;
  let reference = value.trim();
  if (property) {
    if (/^!?\[\[/u.test(reference) && reference.endsWith("]]")) reference = reference.replace(/^!?\[\[/u, "").slice(0, -2).split("|", 1)[0];
    else if (/^!?\[/u.test(reference)) {
      const markdown = /^!?\[[^\]\r\n]*\]\((?:<([^<>\r\n]+)>|([^()<>\r\n]+))\)$/u.exec(reference);
      if (!markdown) return null;
      reference = markdown[1] ?? markdown[2];
    }
  }
  const path = parseLinktext(reference).path.trim();
  let decoded: string;
  // A literal percent is a valid vault filename. Try that exact spelling first;
  // percent decoding is only an alternative for Markdown-style destinations.
  try { decoded = decodeURIComponent(path); } catch { decoded = path; }
  if (!decoded || /^[a-z][a-z\d+.-]*:/iu.test(decoded) || decoded.startsWith("/") || /[<>\\[\]\p{Cc}]/u.test(decoded)) return null;
  return { literal: path, decoded };
}

/** The selected, explicit cover property only; never guess from arbitrary YAML text. */
function coverValue(cache: CachedMetadata, property: string | undefined): unknown {
  if (!property || !cache.frontmatter) return undefined;
  const properties = cache.frontmatter as Record<string, unknown>;
  const keys = Object.keys(properties).filter((key) => key.toLowerCase() === property.toLowerCase());
  const key = Object.prototype.hasOwnProperty.call(properties, property) ? property : keys.length === 1 ? keys[0] : undefined;
  if (key === undefined) return undefined;
  const value = properties[key];
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

/** Build a local-only, read-only projection of one note's metadata, without scanning the vault or reading its body. */
export function collectNoteAttachments(app: Pick<App, "metadataCache" | "vault">, sourcePath: string, imageProperty?: string): NoteAttachments {
  const source = app.vault.getAbstractFileByPath(sourcePath);
  if (!(source instanceof TFile)) return { state: "note-unavailable", items: [] };
  const cache = app.metadataCache.getFileCache(source);
  if (!cache) return { state: "waiting", items: [] };
  const items: NoteAttachment[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, property = false): void => {
    const reference = localReference(value, property);
    if (!reference) return;
    let file: TFile | null;
    try {
      file = app.metadataCache.getFirstLinkpathDest(reference.literal, sourcePath);
      if (!(file instanceof TFile) && reference.literal !== reference.decoded) file = app.metadataCache.getFirstLinkpathDest(reference.decoded, sourcePath);
    }
    catch { return; } // Resolver failures may contain private paths; never log them.
    const available = file instanceof TFile;
    const path = file instanceof TFile ? file.path : reference.decoded;
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    const extension = file instanceof TFile ? file.extension.toLowerCase() : dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    // Unresolved extensionless links are indistinguishable from ordinary note links.
    if (extension === "md" || !available && (!extension || !/^[\p{L}\p{N}]{1,16}$/u.test(extension))) return;
    const identity = `${available ? "file" : "missing"}:${path}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    items.push({ path, name, extension, available });
  };
  for (const references of [cache.links, cache.embeds, cache.frontmatterLinks]) {
    for (const reference of references ?? []) add(reference.link);
  }
  add(coverValue(cache, imageProperty), true);
  return { state: "ready", items };
}

/** Lists links, never attachment payloads or previews. More reveals a bounded page at a time. */
export function renderNoteAttachments(parent: HTMLElement, result: NoteAttachments, onOpen: (path: string) => void): void {
  const section = parent.createDiv({ cls: "ent-cc-inspector-section ent-cc-note-attachments" });
  section.createEl("h4", { text: result.items.length ? `Attachments (${result.items.length})` : "Attachments" });
  if (result.state !== "ready" || result.items.length === 0) {
    section.createDiv({ cls: "ent-cc-attachments-empty", text: result.state === "waiting"
      ? "Waiting for Obsidian to read this note’s links."
      : result.state === "note-unavailable" ? "The note is not available on this device."
        : "No linked files in this note yet." });
    return;
  }
  const list = section.createDiv({ cls: "ent-cc-attachment-list", attr: { role: "list", "aria-label": "Note attachments" } });
  const nameCounts = new Map<string, number>();
  for (const item of result.items) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
  let shown = 0;
  const more = section.createEl("button", { cls: "ent-cc-button ent-cc-attachments-more", type: "button" });
  const appendPage = (focusNew = false): void => {
    const end = Math.min(shown + ATTACHMENT_PAGE_SIZE, result.items.length);
    let firstNew: HTMLElement | null = null;
    for (const item of result.items.slice(shown, end)) {
      const entry = list.createDiv({ attr: { role: "listitem" } });
      const row = item.available
        ? entry.createEl("button", { cls: "ent-cc-attachment-row ent-cc-attachment-link", type: "button", attr: { title: item.path, "aria-label": `Open attachment: ${item.name}` } })
        : entry.createDiv({ cls: "ent-cc-attachment-row is-missing" });
      if (!firstNew) firstNew = row;
      setIcon(row.createSpan({ attr: { "aria-hidden": "true" } }), item.available ? "paperclip" : "file-question");
      const copy = row.createSpan({ cls: "ent-cc-attachment-copy" });
      copy.createSpan({ cls: "ent-cc-attachment-name", text: item.name, attr: { dir: "auto" } });
      copy.createSpan({ cls: "ent-cc-attachment-meta", text: item.available
        ? `${item.extension ? item.extension.toUpperCase() : "File"}${(nameCounts.get(item.name) ?? 0) > 1 ? ` · ${item.path}` : ""}`
        : "Not available on this device", attr: { dir: "auto" } });
      if (item.available) row.addEventListener("click", () => onOpen(item.path));
    }
    shown = end;
    more.hidden = shown >= result.items.length;
    more.setText(`Show more attachments (${result.items.length - shown} remaining)`);
    if (focusNew && firstNew) {
      if (firstNew.tagName !== "BUTTON") firstNew.setAttribute("tabindex", "-1");
      firstNew.focus();
    }
  };
  more.addEventListener("click", () => appendPage(true));
  appendPage();
}
