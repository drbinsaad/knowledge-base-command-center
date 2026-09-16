import assert from "node:assert/strict";
import test from "node:test";
import { TFile, type App } from "obsidian";
import { libraryPropertyText, ownLibraryProperty, renderLibraryCover, resolveLibraryCover, resolveLibraryCoverFromProperty, type LibraryCoverReason } from "../src/library-cover.ts";
import { normalizeLibraryDisplayProfile } from "../src/library-display-profile.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function resolver() {
  const calls: string[][] = [];
  const files = new Map(["Covers/Book.png", "../Covers/Book.png", "Covers/My book.png", "Covers/كتاب.png", "Covers/Unsafe.svg", "Notes/Book.md"].map((path) => [path, new TFile(path)]));
  const app = {
    metadataCache: { getFirstLinkpathDest: (path: string, sourcePath: string) => { calls.push([path, sourcePath]); return files.get(path) ?? null; } },
    vault: { getResourcePath: (file: TFile) => `app://vault/${file.path}` },
  } as unknown as Pick<App, "vault" | "metadataCache">;
  return { app, calls };
}

test("local cover links resolve through Obsidian with the owning note as the source", () => {
  const { app, calls } = resolver();
  for (const value of ["Covers/Book.png", "[[Covers/Book.png]]", "![[Covers/Book.png|Cover]]", "[[Covers/Book.png#cover]]"]) {
    assert.deepEqual(resolveLibraryCover(app, value, "Books/Book.md"), { state: "ready", source: "app://vault/Covers/Book.png" });
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([path, source]) => path === "Covers/Book.png" && source === "Books/Book.md"));
  assert.equal(resolveLibraryCover(app, "../Covers/Book.png", "Books/Book.md").state, "ready");
  assert.equal(resolveLibraryCover(app, "Covers/Missing.png", "Books/Book.md").state, "missing");
  assert.equal(resolveLibraryCover(app, "Covers/Unsafe.svg", "Books/Book.md").state, "blocked");
  assert.equal(resolveLibraryCover(app, "Notes/Book.md", "Books/Book.md").state, "blocked");
});

test("untrusted cover values cannot become executable URLs or raw markup", () => {
  const { app, calls } = resolver();
  for (const value of [
    "javascript:alert(1)", "data:image/png;base64,a", "file:///private/image.png", "app://vault/image.png",
    "http://example.com/cover.png", "//example.com/cover.png", "<img src=x onerror=alert(1)>",
    "https://user:password@example.com/cover.png", "https://example.com/cover.svg", "https://example.com/a\\b.png",
    "https://example.com/\ncover.png", "[cover](https://example.com/cover.png)", "/private/image.png", "x".repeat(2049),
  ]) {
    assert.equal(resolveLibraryCover(app, value, "Books/Book.md").state, "blocked", value);
  }
  for (const value of [undefined, null, ""]) {
    assert.equal(resolveLibraryCover(app, value, "Books/Book.md").state, "empty");
  }
  assert.equal(calls.length, 0, "invalid sources never reach a file resolver");
});

test("all external cover URLs are blocked without consulting the vault resolver", () => {
  const { app, calls } = resolver();
  for (const reference of ["https://example.com/cover.png", "HTTPS://example.com/cover.png", "http://example.com/cover.png", "ftp://example.com/cover.png", "blob:https://example.com/synthetic", "[[https://example.com/cover.png|cover]]", "![[https://example.com/cover.png]]"]) {
    assert.equal(resolveLibraryCover(app, reference, "Book.md").state, "blocked");
  }
  assert.equal(calls.length, 0);
});

test("encoded and malformed external paths cannot bypass the local-only boundary", () => {
  const { app, calls } = resolver();
  for (const suffix of [
    "cover.%73vg", "cover.s%76g", "cover.sv%67z", "cover%2Esvg", "cover.%53VGZ?size=small#preview",
    "cover%", "cover%2", "cover%GG.png", "cover%FF.png",
  ]) {
    assert.equal(resolveLibraryCover(app, `https://example.com/${suffix}`, "Book.md").state, "blocked", suffix);
  }
  assert.equal(calls.length, 0, "invalid remote paths never reach the vault resolver");
});

test("valid encoded HTTPS image URLs are also unavailable in the local-only release", () => {
  const { app } = resolver();
  for (const source of [
    "https://example.com/My%20book.png?token=synthetic%2Fvalue#preview",
    "https://example.com/%D9%83%D8%AA%D8%A7%D8%A8.jpg", "https://example.com/cover%2Epng",
    "https://example.com/cover.png?label=.svg", "https://example.com/image?id=synthetic",
  ]) {
    assert.deepEqual(resolveLibraryCover(app, source, "Book.md"), { state: "blocked", reason: "external-url" });
  }
});

test("covers reserve dimensions, load lazily without a referrer, and replace failures with a generic placeholder", () => {
  const dom = createFakeDom();
  const parent = dom.document.body;
  renderLibraryCover(asHtmlElement(parent), { state: "ready", source: "app://vault/Covers/Book.png" }, normalizeLibraryDisplayProfile({ layout: "cards" }));
  const image = parent.querySelector("img");
  assert.ok(image);
  for (const [attribute, value] of Object.entries({ loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", width: "400", height: "600", alt: "" })) {
    assert.equal(image.getAttribute(attribute), value);
  }
  image.dispatch("error");
  assert.equal(parent.querySelector("img"), null);
  assert.match(parent.textContent, /Image could not load/);
  assert.doesNotMatch(parent.textContent, /Book.png|app:\/\//);
});

test("blocked URLs never create an image element while local covers retain landscape dimensions", () => {
  const dom = createFakeDom();
  const { app } = resolver();
  const profile = normalizeLibraryDisplayProfile({ layout: "cards", imageRatio: "landscape" });
  renderLibraryCover(asHtmlElement(dom.document.body), resolveLibraryCover(app, "https://example.com/book.png", "Book.md"), profile);
  assert.equal(dom.document.body.querySelector("img"), null);
  assert.match(dom.document.body.textContent, /Online covers unsupported/);
  assert.doesNotMatch(dom.document.body.textContent, /example.com/);
  renderLibraryCover(asHtmlElement(dom.document.body), resolveLibraryCover(app, "Covers/Book.png", "Book.md"), profile);
  assert.equal(dom.document.body.querySelectorAll("img").length, 1);
  assert.equal(dom.document.body.querySelector("img")?.getAttribute("src"), "app://vault/Covers/Book.png");
  assert.equal(dom.document.body.querySelector("img")?.getAttribute("width"), "600");
  assert.equal(dom.document.body.querySelector("img")?.getAttribute("height"), "400");
});

test("card properties remain bounded plain scalar text and ignore prototype keys", () => {
  assert.equal(libraryPropertyText(["Ali", "Smith", { private: "never shown" }]), "Ali, Smith");
  assert.equal(libraryPropertyText({ private: "never shown" }), "");
  assert.equal(libraryPropertyText(false), "false");
  assert.equal(libraryPropertyText(Number.POSITIVE_INFINITY), "");
  assert.equal(libraryPropertyText("a".repeat(1000)).length, 160);
  assert.equal(libraryPropertyText(Array(50).fill("a")).split(",").length, 8);
  assert.equal(ownLibraryProperty({ author: "Ali" }, "author"), "Ali");
  assert.equal(ownLibraryProperty({ Cover: "private" }, "cover"), undefined, "other displayed metadata keeps exact-name semantics");
  assert.equal(ownLibraryProperty({}, "toString"), undefined);
});

test("cover lookup accepts a unique case-insensitive own key without rewriting frontmatter", () => {
  const { app } = resolver();
  const frontmatter = Object.freeze({ Cover: "[[Covers/Book.png]]", author: "Synthetic author" });
  for (const property of ["cover", "Cover", "COVER", "cOvEr"]) {
    assert.deepEqual(resolveLibraryCoverFromProperty(app, frontmatter, property, "Book.md"), {
      state: "ready", source: "app://vault/Covers/Book.png",
    });
  }
  assert.deepEqual(frontmatter, { Cover: "[[Covers/Book.png]]", author: "Synthetic author" });
  assert.equal(ownLibraryProperty(frontmatter, "cover"), undefined, "visible-property lookup is not broadened");
});

test("an exact cover key wins over variants even when its value is empty or invalid", () => {
  const { app, calls } = resolver();
  for (const [value, expected] of [
    ["", { state: "empty", reason: "empty-property" }],
    [null, { state: "empty", reason: "empty-property" }],
    [undefined, { state: "empty", reason: "empty-property" }],
    [{ private: "never rendered" }, { state: "blocked", reason: "invalid-property" }],
  ] as const) {
    assert.deepEqual(resolveLibraryCoverFromProperty(app, { cover: value, Cover: "[[Covers/Book.png]]" }, "cover", "Book.md"), expected);
  }
  assert.equal(calls.length, 0, "an unusable exact value does not silently switch to another key");
  assert.deepEqual(resolveLibraryCoverFromProperty(app, { cover: "[[Covers/Book.png]]", Cover: "[[Covers/Missing.png]]" }, "cover", "Book.md"), {
    state: "ready", source: "app://vault/Covers/Book.png",
  });
});

test("ambiguous case variants fail visibly while an exact choice remains usable", () => {
  const { app, calls } = resolver();
  const frontmatter = { Cover: "[[Covers/Book.png]]", COVER: "[[Covers/Missing.png]]" };
  assert.deepEqual(resolveLibraryCoverFromProperty(app, frontmatter, "cover", "Book.md"), { state: "blocked", reason: "ambiguous-property" });
  assert.equal(calls.length, 0);
  assert.deepEqual(resolveLibraryCoverFromProperty(app, frontmatter, "Cover", "Book.md"), { state: "ready", source: "app://vault/Covers/Book.png" });
});

test("missing properties are distinct from blank values and inherited keys never match", () => {
  const { app, calls } = resolver();
  const inherited = Object.create({ cover: "[[Covers/Book.png]]", Cover: "[[Covers/Book.png]]" }) as Record<string, unknown>;
  for (const frontmatter of [undefined, {}, { CoverOther: "[[Covers/Book.png]]" }, inherited]) {
    assert.deepEqual(resolveLibraryCoverFromProperty(app, frontmatter, "cover", "Book.md"), { state: "empty", reason: "missing-property" });
  }
  assert.equal(calls.length, 0);
  inherited.COVER = "[[Covers/Book.png]]";
  assert.deepEqual(resolveLibraryCoverFromProperty(app, inherited, "cover", "Book.md"), { state: "ready", source: "app://vault/Covers/Book.png" });
  assert.deepEqual(resolveLibraryCoverFromProperty(app, { Cover: "  " }, "cover", "Book.md"), { state: "empty", reason: "empty-property" });
});

test("a one-item string list is accepted without permitting multiple, nested or non-string values", () => {
  const { app, calls } = resolver();
  const value = Object.freeze(["[[Covers/Book.png]]"]);
  assert.deepEqual(resolveLibraryCover(app, value, "Book.md"), { state: "ready", source: "app://vault/Covers/Book.png" });
  assert.deepEqual(value, ["[[Covers/Book.png]]"]);
  assert.deepEqual(resolveLibraryCover(app, ["https://example.com/secret.png"], "Book.md"), { state: "blocked", reason: "external-url" });
  for (const invalid of [{}, true, 12, Number.NaN, [["Covers/Book.png"]], [{ cover: "Covers/Book.png" }]]) {
    assert.deepEqual(resolveLibraryCover(app, invalid, "Book.md"), { state: "blocked", reason: "invalid-property" });
  }
  for (const multiple of [["Covers/Book.png", "Covers/Missing.png"], ["", "Covers/Book.png"]]) {
    assert.deepEqual(resolveLibraryCover(app, multiple, "Book.md"), { state: "blocked", reason: "multiple-values" });
  }
  assert.deepEqual(resolveLibraryCover(app, [], "Book.md"), { state: "empty", reason: "empty-property" });
  assert.deepEqual(resolveLibraryCover(app, ["  "], "Book.md"), { state: "empty", reason: "empty-property" });
  assert.equal(calls.length, 1, "only the single usable local link reaches the vault resolver");
});

test("simple local Markdown links and images resolve decoded paths through the vault", () => {
  const { app, calls } = resolver();
  for (const [value, path] of [
    ["[Book](Covers/Book.png)", "Covers/Book.png"],
    ["![Book](Covers/Book.png)", "Covers/Book.png"],
    ["![Book](<Covers/My book.png>)", "Covers/My book.png"],
    ["[Book](Covers/My%20book.png)", "Covers/My book.png"],
    ["[Book](Covers%2FBook.png)", "Covers/Book.png"],
    ["![Book](../Covers/Book.png)", "../Covers/Book.png"],
    ["[Book](Covers/%D9%83%D8%AA%D8%A7%D8%A8.png)", "Covers/كتاب.png"],
  ]) {
    assert.deepEqual(resolveLibraryCover(app, value, "Books/Book.md"), { state: "ready", source: `app://vault/${path}` });
  }
  assert.ok(calls.every(([, source]) => source === "Books/Book.md"));
});

test("Markdown wrappers never bypass protocol, traversal boundary, control or malformed-encoding checks", () => {
  const { app, calls } = resolver();
  for (const value of [
    "![Book](https://example.com/cover.png)", "[Book](<https://example.com/cover.png>)",
    "[Book](https%3A%2F%2Fexample.com%2Fcover.png)", "![Book](%2F%2Fexample.com%2Fcover.png)",
    "[Book](data:image/png;base64,a)", "[Book](javascript%3Aalert%281%29)", "[Book](file%3A%2F%2F%2Fprivate%2Fcover.png)",
    "[Book](app://vault/image.png)", "[Book](%2Fprivate%2Fcover.png)", "[Book](%5C%5Cserver%5Ccover.png)",
    "[Book](Covers/%00Book.png)", "[Book](Covers/Book%.png)", "[Book](Covers/%FF.png)",
    "[Book][reference]", "![Book](Covers/Book.png) trailing", "[Book](Covers/(Book).png)",
  ]) {
    assert.equal(resolveLibraryCover(app, value, "Book.md").state, "blocked", value);
  }
  assert.equal(calls.length, 0, "unsafe wrapped values never reach the vault resolver");
});

test("missing files, unsupported types and host resource errors have safe distinct reasons", () => {
  const { app } = resolver();
  assert.deepEqual(resolveLibraryCover(app, "[[Covers/Missing.png]]", "Book.md"), { state: "missing", reason: "missing-file" });
  assert.deepEqual(resolveLibraryCover(app, "[[Covers/Unsafe.svg]]", "Book.md"), { state: "blocked", reason: "unsupported-file" });
  assert.deepEqual(resolveLibraryCover(app, "[[Notes/Book.md]]", "Book.md"), { state: "blocked", reason: "unsupported-file" });
  const resourceFailure = { ...app, vault: { getResourcePath: () => { throw new Error("private-token-and-path"); } } } as unknown as Pick<App, "metadataCache" | "vault">;
  assert.deepEqual(resolveLibraryCover(resourceFailure, "Covers/Book.png", "Book.md"), { state: "missing", reason: "image-load-error" });
  const metadataFailure = { ...app, metadataCache: { getFirstLinkpathDest: () => { throw new Error("private-token-and-path"); } } } as unknown as Pick<App, "metadataCache" | "vault">;
  assert.deepEqual(resolveLibraryCover(metadataFailure, "Covers/Book.png", "Book.md"), { state: "missing", reason: "image-load-error" });
});

test("compact diagnostics explain each failure without rendering private property values or URLs", () => {
  const labels: Record<LibraryCoverReason, string> = {
    "note-unlinked": "Link a note first", "note-unavailable": "Note not on this device", "metadata-unavailable": "Waiting for note properties",
    "missing-property": "Add a cover property", "empty-property": "Cover property is empty",
    "invalid-property": "Use a text image link", "multiple-values": "Choose one cover image", "ambiguous-property": "Choose an exact property",
    "missing-file": "Image not found in vault", "unsupported-file": "Unsupported image type", "unsupported-link": "Use a vault image link",
    "external-url": "Online covers unsupported", "image-load-error": "Image could not load",
  };
  for (const [reason, label] of Object.entries(labels)) {
    const dom = createFakeDom();
    renderLibraryCover(asHtmlElement(dom.document.body), { state: "blocked", reason: reason as LibraryCoverReason }, normalizeLibraryDisplayProfile({ layout: "cards" }));
    assert.equal(dom.document.body.textContent, label);
    const frame = dom.document.body.children[0];
    assert.equal(frame.getAttribute("data-cover-reason"), reason);
    assert.ok(frame.getAttribute("title"));
    assert.equal(frame.getAttribute("aria-description"), frame.getAttribute("title"));
    assert.equal(frame.querySelector("img"), null);
  }
  const dom = createFakeDom();
  const { app } = resolver();
  renderLibraryCover(asHtmlElement(dom.document.body), resolveLibraryCoverFromProperty(app,
    { Cover: "https://private.invalid/secret-value?token=sensitive" }, "cover", "Private note.md"), normalizeLibraryDisplayProfile({ layout: "cards" }));
  assert.doesNotMatch(dom.document.body.textContent, /private|secret-value|sensitive|token|https:/iu);
  assert.doesNotMatch(dom.document.body.children[0].getAttribute("title") ?? "", /private|secret-value|sensitive|token|https:/iu);
});

test("interactive covers remain native labelled buttons for failed, blocked and empty images", () => {
  const dom = createFakeDom();
  const events: string[] = [];
  const activation = {
    label: "Select Example book", keyShortcuts: "Enter Space p m", current: true,
    onActivate: () => { events.push("activate"); },
    onKeyDown: (event: KeyboardEvent) => { events.push(event.key); },
  };
  const profile = normalizeLibraryDisplayProfile({ layout: "cards" });
  for (const state of ["failed", "blocked", "empty"] as const) {
    const parent = dom.document.body.createDiv();
    renderLibraryCover(asHtmlElement(parent), state === "failed"
      ? { state: "ready", source: "app://vault/Covers/Book.png" } : { state }, profile, activation);
    const button = parent.querySelector("button");
    assert.ok(button);
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-label"), "Select Example book");
    assert.equal(button.getAttribute("aria-current"), "true");
    assert.equal(button.querySelector("button"), null);
    if (state === "failed") parent.querySelector("img")?.dispatch("error");
    assert.equal(parent.querySelector("button"), button, "placeholder updates retain the same focusable action");
    button.click();
    button.dispatch("keydown", { key: "Enter" });
  }
  assert.deepEqual(events, ["activate", "Enter", "activate", "Enter", "activate", "Enter"]);
});
