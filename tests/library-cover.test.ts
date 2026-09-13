import assert from "node:assert/strict";
import test from "node:test";
import { TFile, type App } from "obsidian";
import { libraryPropertyText, ownLibraryProperty, renderLibraryCover, resolveLibraryCover } from "../src/library-cover.ts";
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
  for (const value of [undefined, null, {}, ["Covers/Book.png"], ""]) {
    assert.equal(resolveLibraryCover(app, value, "Books/Book.md").state, "empty");
  }
  assert.equal(calls.length, 0, "invalid sources never reach a file resolver");
});

test("all external cover URLs are blocked without consulting the vault resolver", () => {
  const { app, calls } = resolver();
  for (const reference of ["https://example.com/cover.png", "HTTPS://example.com/cover.png", "http://example.com/cover.png", "ftp://example.com/cover.png", "blob:https://example.com/synthetic", "[[https://example.com/cover.png|cover]]", "![[https://example.com/cover.png]]"]) {
    assert.deepEqual(resolveLibraryCover(app, reference, "Book.md"), { state: "blocked" });
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
    assert.deepEqual(resolveLibraryCover(app, source, "Book.md"), { state: "blocked" });
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
  assert.match(parent.textContent, /Cover unavailable/);
  assert.doesNotMatch(parent.textContent, /Book.png|app:\/\//);
});

test("blocked URLs never create an image element while local covers retain landscape dimensions", () => {
  const dom = createFakeDom();
  const { app } = resolver();
  const profile = normalizeLibraryDisplayProfile({ layout: "cards", imageRatio: "landscape" });
  renderLibraryCover(asHtmlElement(dom.document.body), resolveLibraryCover(app, "https://example.com/book.png", "Book.md"), profile);
  assert.equal(dom.document.body.querySelector("img"), null);
  assert.match(dom.document.body.textContent, /Cover unavailable/);
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
  assert.equal(ownLibraryProperty({}, "toString"), undefined);
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
