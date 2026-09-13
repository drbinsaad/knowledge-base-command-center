import assert from "node:assert/strict";
import test from "node:test";
import { TFile, type App } from "obsidian";
import { clearExternalLibraryCovers, libraryPropertyText, ownLibraryProperty, renderLibraryCover, resolveLibraryCover } from "../src/library-cover.ts";
import { normalizeLibraryDisplayProfile } from "../src/library-display-profile.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function resolver() {
  const calls: string[][] = [];
  const files = new Map(["Covers/Book.png", "../Covers/Book.png", "Covers/Unsafe.svg", "Notes/Book.md"].map((path) => [path, new TFile(path)]));
  const app = {
    metadataCache: { getFirstLinkpathDest: (path: string, sourcePath: string) => { calls.push([path, sourcePath]); return files.get(path) ?? null; } },
    vault: { getResourcePath: (file: TFile) => `app://vault/${file.path}` },
  } as unknown as Pick<App, "vault" | "metadataCache">;
  return { app, calls };
}

test("local cover links resolve through Obsidian with the owning note as the source", () => {
  const { app, calls } = resolver();
  for (const value of ["Covers/Book.png", "[[Covers/Book.png]]", "![[Covers/Book.png|Cover]]", "[[Covers/Book.png#cover]]"]) {
    assert.deepEqual(resolveLibraryCover(app, value, "Books/Book.md", false), { state: "ready", source: "app://vault/Covers/Book.png" });
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([path, source]) => path === "Covers/Book.png" && source === "Books/Book.md"));
  assert.equal(resolveLibraryCover(app, "../Covers/Book.png", "Books/Book.md", false).state, "ready");
  assert.equal(resolveLibraryCover(app, "Covers/Missing.png", "Books/Book.md", false).state, "missing");
  assert.equal(resolveLibraryCover(app, "Covers/Unsafe.svg", "Books/Book.md", false).state, "blocked");
  assert.equal(resolveLibraryCover(app, "Notes/Book.md", "Books/Book.md", false).state, "blocked");
});

test("untrusted cover values cannot become executable URLs or raw markup", () => {
  const { app, calls } = resolver();
  for (const value of [
    "javascript:alert(1)", "data:image/png;base64,a", "file:///private/image.png", "app://vault/image.png",
    "http://example.com/cover.png", "//example.com/cover.png", "<img src=x onerror=alert(1)>",
    "https://user:password@example.com/cover.png", "https://example.com/cover.svg", "https://example.com/a\\b.png",
    "https://example.com/\ncover.png", "[cover](https://example.com/cover.png)", "/private/image.png", "x".repeat(2049),
  ]) {
    assert.equal(resolveLibraryCover(app, value, "Books/Book.md", true).state, "blocked", value);
  }
  for (const value of [undefined, null, {}, ["Covers/Book.png"], ""]) {
    assert.equal(resolveLibraryCover(app, value, "Books/Book.md", true).state, "empty");
  }
  assert.equal(calls.length, 0, "invalid sources never reach a file resolver");
});

test("external HTTPS covers need explicit device permission and bypass the vault resolver", () => {
  const { app, calls } = resolver();
  assert.deepEqual(resolveLibraryCover(app, "https://example.com/cover.png", "Book.md", false), { state: "external-blocked" });
  assert.deepEqual(resolveLibraryCover(app, "https://example.com/cover.png", "Book.md", true), {
    state: "ready", source: "https://example.com/cover.png", external: true,
  });
  assert.equal(calls.length, 0);
});

test("external cover suffix checks reject percent-encoded SVG paths and malformed path escapes", () => {
  const { app, calls } = resolver();
  for (const suffix of [
    "cover.%73vg", "cover.s%76g", "cover.sv%67z", "cover%2Esvg", "cover.%53VGZ?size=small#preview",
    "cover%", "cover%2", "cover%GG.png", "cover%FF.png",
  ]) {
    for (const allowed of [false, true]) {
      assert.equal(resolveLibraryCover(app, `https://example.com/${suffix}`, "Book.md", allowed).state, "blocked", suffix);
    }
  }
  assert.equal(calls.length, 0, "invalid remote paths never reach the vault resolver");
});

test("external path inspection preserves accepted encoded image URLs and still requires consent", () => {
  const { app } = resolver();
  for (const source of [
    "https://example.com/My%20book.png?token=synthetic%2Fvalue#preview",
    "https://example.com/%D9%83%D8%AA%D8%A7%D8%A8.jpg", "https://example.com/cover%2Epng",
    "https://example.com/cover.png?label=.svg", "https://example.com/image?id=synthetic",
  ]) {
    assert.deepEqual(resolveLibraryCover(app, source, "Book.md", false), { state: "external-blocked" });
    assert.deepEqual(resolveLibraryCover(app, source, "Book.md", true), { state: "ready", source, external: true });
  }
});

test("covers reserve dimensions, load lazily without a referrer, and replace failures with a generic placeholder", () => {
  const dom = createFakeDom();
  const parent = dom.document.body;
  renderLibraryCover(asHtmlElement(parent), { state: "ready", source: "https://example.com/secret.png", external: true }, normalizeLibraryDisplayProfile({ layout: "cards" }));
  const image = parent.querySelector("img");
  assert.ok(image);
  for (const [attribute, value] of Object.entries({ loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", width: "400", height: "600", alt: "" })) {
    assert.equal(image.getAttribute(attribute), value);
  }
  image.dispatch("error");
  assert.equal(parent.querySelector("img"), null);
  assert.match(parent.textContent, /Cover unavailable/);
  assert.doesNotMatch(parent.textContent, /secret|https/);
});

test("revocation strips existing remote image sources while retaining local covers", () => {
  const dom = createFakeDom();
  const profile = normalizeLibraryDisplayProfile({ layout: "cards", imageRatio: "landscape" });
  renderLibraryCover(asHtmlElement(dom.document.body), { state: "ready", source: "https://example.com/book.png", external: true }, profile);
  renderLibraryCover(asHtmlElement(dom.document.body), { state: "ready", source: "app://vault/book.png" }, profile);
  const remote = dom.document.body.querySelector('[data-kbcc-external-cover="true"]');
  assert.ok(remote);
  clearExternalLibraryCovers(asHtmlElement(dom.document.body));
  assert.equal(remote.getAttribute("src"), null);
  assert.equal(dom.document.body.querySelectorAll("img").length, 1);
  assert.equal(dom.document.body.querySelector("img")?.getAttribute("src"), "app://vault/book.png");
  assert.match(dom.document.body.textContent, /External cover blocked/);
});

test("card properties remain bounded plain scalar text and ignore prototype keys", () => {
  assert.equal(libraryPropertyText(["Ali", "Smith", { private: "never shown" }]), "Ali, Smith");
  assert.equal(libraryPropertyText({ private: "never shown" }), "");
  assert.equal(libraryPropertyText(false), "false");
  assert.equal(libraryPropertyText(Number.POSITIVE_INFINITY), "");
  assert.equal(libraryPropertyText("a".repeat(1000)).length, 160);
  assert.equal(libraryPropertyText(Array(50).fill("a")).split(",").length, 8);
  assert.equal(ownLibraryProperty({ author: "Ali" }, "author"), "Ali");
  assert.equal(ownLibraryProperty({}, "toString"), undefined);
});

test("interactive covers remain native labelled buttons after image failure and privacy revocation", () => {
  const dom = createFakeDom();
  const events: string[] = [];
  const activation = {
    label: "Select Example book", keyShortcuts: "Enter Space p m", current: true,
    onActivate: () => { events.push("activate"); },
    onKeyDown: (event: KeyboardEvent) => { events.push(event.key); },
  };
  const profile = normalizeLibraryDisplayProfile({ layout: "cards" });
  for (const state of ["failed", "revoked", "empty"] as const) {
    const parent = dom.document.body.createDiv();
    renderLibraryCover(asHtmlElement(parent), state === "empty" ? { state: "empty" }
      : { state: "ready", source: "https://example.com/book.png", external: true }, profile, activation);
    const button = parent.querySelector("button");
    assert.ok(button);
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-label"), "Select Example book");
    assert.equal(button.getAttribute("aria-current"), "true");
    assert.equal(button.querySelector("button"), null);
    if (state === "failed") parent.querySelector("img")?.dispatch("error");
    if (state === "revoked") clearExternalLibraryCovers(asHtmlElement(parent));
    assert.equal(parent.querySelector("button"), button, "placeholder updates retain the same focusable action");
    button.click();
    button.dispatch("keydown", { key: "Enter" });
  }
  assert.deepEqual(events, ["activate", "Enter", "activate", "Enter", "activate", "Enter"]);
});
