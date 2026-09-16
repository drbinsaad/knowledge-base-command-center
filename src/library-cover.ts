import { TFile, setIcon, type App } from "obsidian";
import type { LibraryDisplayProfile } from "./library-display-profile";

const MAX_COVER_REFERENCE_LENGTH = 2048;
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const MAX_PROPERTY_TEXT_LENGTH = 160;

export type LibraryCover =
  | { state: "ready"; source: string }
  | { state: "empty" | "missing" | "blocked"; reason?: LibraryCoverReason };

export type LibraryCoverReason =
  | "note-unlinked" | "note-unavailable" | "metadata-unavailable" | "missing-property" | "empty-property" | "invalid-property"
  | "multiple-values" | "ambiguous-property" | "missing-file" | "unsupported-file"
  | "unsupported-link" | "external-url" | "image-load-error";

const COVER_DIAGNOSTICS: Record<LibraryCoverReason, { label: string; help: string }> = {
  "note-unlinked": { label: "Link a note first", help: "Create or link a note, then add its cover property." },
  "note-unavailable": { label: "Note not on this device", help: "Check that the linked note is available in this vault on this device." },
  "metadata-unavailable": { label: "Waiting for note properties", help: "Open the linked note or wait for Obsidian to finish reading its properties, then refresh." },
  "missing-property": { label: "Add a cover property", help: "Add the image property selected in Library settings to this note." },
  "empty-property": { label: "Cover property is empty", help: "Set the image property to one image link or path inside this vault." },
  "invalid-property": { label: "Use a text image link", help: "Use text or a one-item list containing one local image link." },
  "multiple-values": { label: "Choose one cover image", help: "The image property contains several values. Keep just one local image link." },
  "ambiguous-property": { label: "Choose an exact property", help: "Several property names differ only by capitalization. Select the exact name in Library settings." },
  "missing-file": { label: "Image not found in vault", help: "Check that the linked image exists in this vault and that its filename or path is correct." },
  "unsupported-file": { label: "Unsupported image type", help: "Choose an AVIF, BMP, GIF, JPEG, PNG, or WebP image stored in this vault." },
  "unsupported-link": { label: "Use a vault image link", help: "Use a local image path, wikilink, or simple Markdown image link." },
  "external-url": { label: "Online covers unsupported", help: "Save the image inside this vault, then use its local link. Online images are never loaded." },
  "image-load-error": { label: "Image could not load", help: "Try opening the image in Obsidian to check that it is available and readable on this device." },
};

/** Exact names always win; case fallback is only safe when exactly one own key matches. */
export function resolveLibraryCoverFromProperty(
  app: Pick<App, "metadataCache" | "vault">,
  frontmatter: Record<string, unknown> | undefined,
  property: string,
  sourcePath: string,
): LibraryCover {
  if (!frontmatter) return { state: "empty", reason: "missing-property" };
  if (Object.prototype.hasOwnProperty.call(frontmatter, property)) {
    return resolveLibraryCover(app, frontmatter[property], sourcePath);
  }
  const folded = property.toLowerCase();
  let matched: string | undefined;
  for (const name of Object.keys(frontmatter)) {
    if (name.toLowerCase() !== folded) continue;
    if (matched !== undefined) return { state: "blocked", reason: "ambiguous-property" };
    matched = name;
  }
  return matched === undefined ? { state: "empty", reason: "missing-property" }
    : resolveLibraryCover(app, frontmatter[matched], sourcePath);
}

/** Resolve only a selected cover property; no downloads or vault-wide scans. */
export function resolveLibraryCover(
  app: Pick<App, "metadataCache" | "vault">,
  value: unknown,
  sourcePath: string,
): LibraryCover {
  // Obsidian list properties are usable only when they name exactly one image;
  // never pick an arbitrary first value or recursively coerce imported data.
  if (Array.isArray(value)) {
    if (value.length === 0) return { state: "empty", reason: "empty-property" };
    if (value.length > 1) return { state: "blocked", reason: "multiple-values" };
    value = value[0];
  }
  if (value === undefined || value === null) return { state: "empty", reason: "empty-property" };
  if (typeof value !== "string") return { state: "blocked", reason: "invalid-property" };
  if (value.length > MAX_COVER_REFERENCE_LENGTH) return { state: "blocked", reason: "unsupported-link" };
  let reference = value.trim();
  if (!reference) return { state: "empty", reason: "empty-property" };
  if (reference.startsWith("![[") && reference.endsWith("]]")) reference = reference.slice(3, -2);
  else if (reference.startsWith("[[") && reference.endsWith("]]")) reference = reference.slice(2, -2);
  else if (/^!?\[/u.test(reference)) {
    // Deliberately accept only a complete, simple inline Markdown wrapper.
    // Decoding happens before the same URL/path checks as plain vault links.
    const markdown = /^!?\[[^\]\r\n]*\]\((?:<([^<>\r\n]+)>|([^()<>\r\n]+))\)$/u.exec(reference);
    if (!markdown) return { state: "blocked", reason: "unsupported-link" };
    try { reference = decodeURIComponent(markdown[1] ?? markdown[2]); }
    catch { return { state: "blocked", reason: "unsupported-link" }; }
  }
  reference = reference.split("|", 1)[0].trim();
  if (!reference || /[<>\\\p{Cc}]/u.test(reference)) return { state: "blocked", reason: "unsupported-link" };
  if (reference.startsWith("//")) return { state: "blocked", reason: "external-url" };

  // No URL from note content can become an image source, even if an older
  // private build left behind an external-image permission on this device.
  if (/^[a-z][a-z\d+.-]*:/iu.test(reference)) return { state: "blocked", reason: /^(?:https?|ftps?|wss?):/iu.test(reference) ? "external-url" : "unsupported-link" };
  // A local cover must resolve to an actual image file inside this vault.
  // Resource URLs are produced by Obsidian, never accepted from note content.
  if (reference.startsWith("/") || reference.includes("?") || reference.includes("[") || reference.includes("]")) return { state: "blocked", reason: "unsupported-link" };
  reference = reference.split("#", 1)[0];
  if (!reference) return { state: "blocked", reason: "unsupported-link" };
  try {
    const image = app.metadataCache.getFirstLinkpathDest(reference, sourcePath);
    if (!(image instanceof TFile)) return { state: "missing", reason: "missing-file" };
    if (!IMAGE_EXTENSIONS.has(image.extension.toLocaleLowerCase())) return { state: "blocked", reason: "unsupported-file" };
    return { state: "ready", source: app.vault.getResourcePath(image) };
  } catch {
    // Metadata/resource errors can contain private paths. Show only a safe hint.
    return { state: "missing", reason: "image-load-error" };
  }
}

/** Property values remain short plain text, including malformed imported values. */
export function libraryPropertyText(value: unknown): string {
  const scalar = (candidate: unknown): string => typeof candidate === "string"
    ? candidate.slice(0, MAX_PROPERTY_TEXT_LENGTH + 1).trim()
    : typeof candidate === "number" && Number.isFinite(candidate) || typeof candidate === "boolean" ? String(candidate) : "";
  const text = Array.isArray(value)
    ? value.slice(0, 8).map(scalar).filter(Boolean).join(", ") + (value.length > 8 ? "…" : "")
    : scalar(value);
  return text.length > MAX_PROPERTY_TEXT_LENGTH ? `${text.slice(0, MAX_PROPERTY_TEXT_LENGTH - 1)}…` : text;
}

export function ownLibraryProperty(frontmatter: Record<string, unknown> | undefined, property: string): unknown {
  return frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, property) ? frontmatter[property] : undefined;
}

interface LibraryCoverActivation {
  label: string;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  keyShortcuts: string;
  current: boolean;
}

export function renderLibraryCover(parent: HTMLElement, cover: LibraryCover, profile: LibraryDisplayProfile, activation?: LibraryCoverActivation): void {
  const cls = `ent-cc-library-cover ent-cc-library-cover-${profile.imageRatio} ent-cc-library-cover-${profile.imageFit}`;
  const frame: HTMLElement = activation
    ? parent.createEl("button", { type: "button", cls: `${cls} ent-cc-library-cover-button`, attr: {
      "aria-label": activation.label, "aria-keyshortcuts": activation.keyShortcuts,
      ...(activation.current ? { "aria-current": "true" } : {}),
    } })
    : parent.createDiv({ cls });
  if (activation) {
    frame.addEventListener("click", activation.onActivate);
    frame.addEventListener("keydown", activation.onKeyDown);
  }
  const placeholder = (reason?: LibraryCoverReason): void => {
    frame.empty();
    frame.addClass("is-placeholder");
    const diagnostic = reason ? COVER_DIAGNOSTICS[reason] : null;
    if (reason) frame.setAttribute("data-cover-reason", reason);
    if (diagnostic) {
      frame.setAttribute("title", diagnostic.help);
      frame.setAttribute("aria-description", diagnostic.help);
    }
    setIcon(frame.createSpan({ attr: { "aria-hidden": "true" } }), "image");
    frame.createSpan({ text: diagnostic?.label ?? (cover.state === "empty" ? "No cover" : "Cover unavailable") });
  };
  if (cover.state !== "ready") {
    placeholder(cover.reason);
    return;
  }
  const [width, height] = profile.imageRatio === "portrait" ? [400, 600]
    : profile.imageRatio === "landscape" ? [600, 400] : [400, 400];
  const image = frame.createEl("img", { attr: {
    alt: "", width: String(width), height: String(height), loading: "lazy", decoding: "async",
    referrerpolicy: "no-referrer", draggable: "false",
  } });
  image.addEventListener("error", () => placeholder("image-load-error"), { once: true });
  image.setAttribute("src", cover.source);
}
