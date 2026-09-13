import { TFile, setIcon, type App } from "obsidian";
import type { LibraryDisplayProfile } from "./library-display-profile";

const MAX_COVER_REFERENCE_LENGTH = 2048;
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const MAX_PROPERTY_TEXT_LENGTH = 160;

export type LibraryCover =
  | { state: "ready"; source: string; external?: boolean }
  | { state: "empty" | "missing" | "blocked" | "external-blocked" };

/** Resolve only a selected cover property; no downloads or vault-wide scans. */
export function resolveLibraryCover(
  app: Pick<App, "metadataCache" | "vault">,
  value: unknown,
  sourcePath: string,
  allowExternal: boolean,
): LibraryCover {
  if (typeof value !== "string") return { state: "empty" };
  if (value.length > MAX_COVER_REFERENCE_LENGTH) return { state: "blocked" };
  let reference = value.trim();
  if (!reference) return { state: "empty" };
  if (reference.startsWith("![[") && reference.endsWith("]]")) reference = reference.slice(3, -2);
  else if (reference.startsWith("[[") && reference.endsWith("]]")) reference = reference.slice(2, -2);
  reference = reference.split("|", 1)[0].trim();
  if (!reference || /[<>\\\p{Cc}]/u.test(reference) || reference.startsWith("//")) return { state: "blocked" };

  if (/^[a-z][a-z\d+.-]*:/iu.test(reference)) {
    try {
      const url = new URL(reference);
      // Inspect one decoded path without rewriting the requested URL. Malformed
      // escapes fail closed; a suffix check cannot verify a server's MIME type.
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password
        || /\.svgz?$/iu.test(decodeURIComponent(url.pathname))) return { state: "blocked" };
      if (!allowExternal) return { state: "external-blocked" };
      return { state: "ready", source: url.href, external: true };
    } catch {
      return { state: "blocked" };
    }
  }
  // A local cover must resolve to an actual image file inside this vault.
  // Resource URLs are produced by Obsidian, never accepted from note content.
  if (reference.startsWith("/") || reference.includes("?") || reference.includes("[") || reference.includes("]")) return { state: "blocked" };
  reference = reference.split("#", 1)[0];
  const image = app.metadataCache.getFirstLinkpathDest(reference, sourcePath);
  if (!(image instanceof TFile)) return { state: "missing" };
  if (!IMAGE_EXTENSIONS.has(image.extension.toLocaleLowerCase())) return { state: "blocked" };
  return { state: "ready", source: app.vault.getResourcePath(image) };
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
  const placeholder = (): void => {
    frame.empty();
    frame.addClass("is-placeholder");
    setIcon(frame.createSpan({ attr: { "aria-hidden": "true" } }), "image");
    frame.createSpan({ text: cover.state === "external-blocked" ? "External cover blocked" : cover.state === "empty" ? "No cover" : "Cover unavailable" });
  };
  if (cover.state !== "ready") {
    placeholder();
    return;
  }
  const [width, height] = profile.imageRatio === "portrait" ? [400, 600]
    : profile.imageRatio === "landscape" ? [600, 400] : [400, 400];
  const image = frame.createEl("img", { attr: {
    alt: "", width: String(width), height: String(height), loading: "lazy", decoding: "async",
    referrerpolicy: "no-referrer", draggable: "false",
  } });
  if (cover.external) image.setAttribute("data-kbcc-external-cover", "true");
  image.addEventListener("error", placeholder, { once: true });
  image.setAttribute("src", cover.source);
}

/** Revoking this device's permission cancels existing remote images immediately. */
export function clearExternalLibraryCovers(parent: HTMLElement): void {
  for (const image of parent.querySelectorAll<HTMLImageElement>('img[data-kbcc-external-cover="true"]')) {
    image.removeAttribute("src");
    const frame = image.parentElement;
    if (!frame) continue;
    frame.empty();
    frame.addClass("is-placeholder");
    frame.createSpan({ text: "External cover blocked" });
  }
}
