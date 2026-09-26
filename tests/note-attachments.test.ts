import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFile, TFolder, type App, type CachedMetadata } from "obsidian";
import { ATTACHMENT_PAGE_SIZE, collectNoteAttachments, renderNoteAttachments } from "../src/note-attachments.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom, FakeEvent } from "./support/fake-dom.ts";
import { migrateData, type VaultRecord } from "../src/model.ts";

const references = (paths: string[]) => paths.map((link) => ({ link, original: `[[${link}]]` }));
function harness(cache: Partial<CachedMetadata> | null = {}, paths: string[] = []) {
  const source = new TFile("Notes/Selected.md");
  const files = new Map([source, ...paths.map((path) => new TFile(path))].map((file) => [file.path, file]));
  const calls: string[][] = [];
  const app = {
    vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
    metadataCache: {
      getFileCache: (file: TFile) => { assert.equal(file, source); return cache; },
      getFirstLinkpathDest: (path: string, owner: string) => {
        calls.push([path, owner]);
        return files.get(path) ?? files.get(path.replace(/^\.\.\//u, "")) ?? null;
      },
    },
  } as unknown as Pick<App, "vault" | "metadataCache">;
  return { app, source, files, calls };
}

test("attachments use only selected-note link metadata, across embeds, links and properties", () => {
  const h = harness({
    links: references(["Files/Paper.pdf", "Notes/Other.md"]) as CachedMetadata["links"],
    embeds: references(["Files/Photo.png"]) as CachedMetadata["embeds"],
    frontmatterLinks: [{ ...references(["Files/Workbook.xlsx"])[0], key: "file" }],
  }, ["Files/Paper.pdf", "Notes/Other.md", "Files/Photo.png", "Files/Workbook.xlsx"]);
  assert.deepEqual(collectNoteAttachments(h.app, h.source.path).items.map((item) => item.path), ["Files/Paper.pdf", "Files/Photo.png", "Files/Workbook.xlsx"]);
  assert.ok(h.calls.every(([, owner]) => owner === h.source.path));
  assert.equal(h.calls.length, 4);
});

test("any existing non-Markdown file type can be listed, not only embeddable media", () => {
  const paths = ["scan.svg", "paper.PDF", "photo.jpg", "audio.mp3", "video.mp4", "book.docx", "slides.pptx", "sheet.xlsx", "archive.zip", "canvas.canvas", "library.base", "unknown.custom", "LICENSE"];
  const h = harness({ links: references(paths) as CachedMetadata["links"] }, paths);
  const result = collectNoteAttachments(h.app, h.source.path);
  assert.equal(result.items.length, paths.length);
  assert.ok(result.items.every((item) => item.available));
  assert.equal(result.items.find((item) => item.path === "paper.PDF")?.extension, "pdf");
});

test("same attachment deduplicates across reference kinds, aliases and page fragments", () => {
  const h = harness({
    links: references(["Files/Paper.pdf#page=2", "Files/Paper.pdf#page=3"]) as CachedMetadata["links"],
    embeds: references(["Files/Paper.pdf"]) as CachedMetadata["embeds"],
    frontmatterLinks: [{ ...references(["Files/Paper.pdf"])[0], key: "file", displayText: "Reading" }],
  }, ["Files/Paper.pdf"]);
  assert.deepEqual(collectNoteAttachments(h.app, h.source.path).items, [{ path: "Files/Paper.pdf", name: "Paper.pdf", extension: "pdf", available: true }]);
});

test("relative paths, encoded spaces and hash characters resolve using the source note", () => {
  const h = harness({ links: references(["../Files/My%20paper.pdf#page=4", "Files/chapter%23one.pdf", "Files/كتاب.pdf"]) as CachedMetadata["links"] }, ["Files/My paper.pdf", "Files/chapter#one.pdf", "Files/كتاب.pdf"]);
  assert.ok(collectNoteAttachments(h.app, h.source.path).items.every((item) => item.available));
  assert.deepEqual(h.calls, [["../Files/My%20paper.pdf", h.source.path], ["../Files/My paper.pdf", h.source.path], ["Files/chapter%23one.pdf", h.source.path], ["Files/chapter#one.pdf", h.source.path], ["Files/كتاب.pdf", h.source.path]]);
});

test("literal percent filenames are not rewritten into different attachment paths", () => {
  const paths = ["Files/100%.pdf", "Files/100%GG.pdf", "Files/scan%20one.pdf", "Files/scan one.pdf"];
  const h = harness({ links: references(paths) as CachedMetadata["links"] }, paths);
  assert.deepEqual(collectNoteAttachments(h.app, h.source.path).items.map((item) => item.path), paths);
  assert.equal(h.calls.length, paths.length);
});

test("only configured cover raw paths are inspected, with unambiguous case fallback", () => {
  const h = harness({ frontmatter: { Cover: "Files/Cover.png", secret: "private-value.txt", arbitrary: "Files/Hidden.pdf" } }, ["Files/Cover.png", "Files/Hidden.pdf"]);
  assert.equal(collectNoteAttachments(h.app, h.source.path).items.length, 0);
  assert.deepEqual(collectNoteAttachments(h.app, h.source.path, "cover").items.map((item) => item.path), ["Files/Cover.png"]);
  assert.ok(h.calls.every(([path]) => path === "Files/Cover.png"));
  for (const value of ["![[Files/Cover.png|100]]", "[[Files/Cover.png]]", "[cover](Files/Cover.png)", ["Files/Cover.png"]]) {
    const linked = harness({ frontmatter: { cover: value } }, ["Files/Cover.png"]);
    assert.equal(collectNoteAttachments(linked.app, linked.source.path, "cover").items.length, 1);
  }
  const ambiguous = harness({ frontmatter: { Cover: "Files/First.png", COVER: "Files/Second.png" } });
  assert.equal(collectNoteAttachments(ambiguous.app, ambiguous.source.path, "cover").items.length, 0);
  assert.equal(ambiguous.calls.length, 0);
});

test("malformed or multi-value cover properties and inherited properties are ignored", () => {
  for (const value of [[], ["a.png", "b.png"], { private: "a.png" }, 12, true]) {
    const h = harness({ frontmatter: { cover: value } });
    assert.equal(collectNoteAttachments(h.app, h.source.path, "cover").items.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ frontmatter: Object.create({ cover: "a.png" }) as Record<string, unknown> });
  assert.equal(collectNoteAttachments(h.app, h.source.path, "cover").items.length, 0);
});

test("remote, executable, absolute and malformed destinations never reach a resolver or UI", () => {
  const inputs = ["https://example.invalid/x.png", "HTTP://example.invalid/a.pdf", "//example.invalid/x.png", "javascript:alert(1)", "data:image/png;base64,x", "file:///private/x.pdf", "app://vault/x.pdf", "obsidian://open", "/private/x.pdf", "\\server\\x.pdf", "<img src=x>", "file%3A%2F%2F%2Fprivate%2Fx.pdf", "https%3A%2F%2Fexample.invalid/x.pdf", "file\u0000.pdf", "x".repeat(2049)];
  const h = harness({ links: references(inputs) as CachedMetadata["links"] });
  assert.deepEqual(collectNoteAttachments(h.app, h.source.path).items, []);
  assert.equal(h.calls.length, 0);
  for (const input of inputs) {
    const property = harness({ frontmatter: { cover: input } });
    assert.deepEqual(collectNoteAttachments(property.app, property.source.path, "cover").items, []);
    assert.equal(property.calls.length, 0);
  }
});

test("missing files are explicit and cannot become an accidental new note", () => {
  const h = harness({ links: references(["Files/Missing.pdf", "Files/Missing.pdf#page=2", "Missing note", "Missing.md", "Heading#section"]) as CachedMetadata["links"] });
  const result = collectNoteAttachments(h.app, h.source.path);
  assert.deepEqual(result.items, [{ path: "Files/Missing.pdf", name: "Missing.pdf", extension: "pdf", available: false }]);
  const dom = createFakeDom();
  const opened: string[] = [];
  renderNoteAttachments(asHtmlElement(dom.document.body), result, (path) => opened.push(path));
  assert.equal(dom.document.body.querySelectorAll(".ent-cc-attachment-link").length, 0);
  assert.match(dom.document.body.textContent, /Not available on this device/u);
  assert.deepEqual(opened, []);
});

test("a newly synced file resolves on the next projection without a saved attachment registry", () => {
  const h = harness({ embeds: references(["Files/Late.pdf"]) as CachedMetadata["embeds"] });
  assert.equal(collectNoteAttachments(h.app, h.source.path).items[0].available, false);
  h.files.set("Files/Late.pdf", new TFile("Files/Late.pdf"));
  assert.equal(collectNoteAttachments(h.app, h.source.path).items[0].available, true);
  h.files.delete("Files/Late.pdf");
  assert.equal(collectNoteAttachments(h.app, h.source.path).items[0].available, false);
});

test("no-cache and unavailable-note states are distinct from an empty attachment list", () => {
  const loading = harness(null);
  assert.equal(collectNoteAttachments(loading.app, loading.source.path).state, "waiting");
  loading.files.clear();
  assert.equal(collectNoteAttachments(loading.app, loading.source.path).state, "note-unavailable");
  const empty = harness({});
  assert.deepEqual(collectNoteAttachments(empty.app, empty.source.path), { state: "ready", items: [] });
});

test("resolver errors are path-free and do not stop other references", () => {
  const h = harness({ links: references(["Files/Bad.pdf", "Files/Good.pdf"]) as CachedMetadata["links"] }, ["Files/Good.pdf"]);
  const resolve = h.app.metadataCache.getFirstLinkpathDest.bind(h.app.metadataCache);
  h.app.metadataCache.getFirstLinkpathDest = (path, source) => { if (path === "Files/Bad.pdf") throw new Error("PRIVATE_SENTINEL"); return resolve(path, source); };
  assert.deepEqual(collectNoteAttachments(h.app, h.source.path).items.map((item) => item.name), ["Good.pdf"]);
});

test("rendering exposes bounded pages, names as plain text and unambiguous duplicate filenames", () => {
  const paths = ["Folder A/Same.pdf", "Folder B/Same.pdf", ...Array.from({ length: 43 }, (_, index) => `Files/File ${index}.pdf`)];
  const h = harness({ links: references(paths) as CachedMetadata["links"] }, paths);
  const dom = createFakeDom();
  const opened: string[] = [];
  renderNoteAttachments(asHtmlElement(dom.document.body), collectNoteAttachments(h.app, h.source.path), (path) => opened.push(path));
  assert.equal(dom.document.body.querySelectorAll(".ent-cc-attachment-link").length, ATTACHMENT_PAGE_SIZE);
  assert.match(dom.document.body.textContent, /Folder A\/Same.pdf/u);
  assert.match(dom.document.body.textContent, /Folder B\/Same.pdf/u);
  dom.document.body.querySelector(".ent-cc-attachment-link")?.dispatch("click");
  assert.deepEqual(opened, ["Folder A/Same.pdf"]);
  const more = dom.document.body.querySelector(".ent-cc-attachments-more");
  more?.dispatch("click");
  assert.equal(dom.document.body.querySelectorAll(".ent-cc-attachment-link").length, 40);
  more?.dispatch("click");
  assert.equal(dom.document.body.querySelectorAll(".ent-cc-attachment-link").length, 45);
  assert.equal(more?.hidden, true);
  assert.equal(dom.document.body.querySelectorAll("img").length, 0);
  assert.equal(dom.document.body.querySelectorAll("a").length, 0);
});

test("attachment activation rechecks the file and delegates to the existing opener", async () => {
  const h = harness({ links: references(["Files/Paper.pdf"]) as CachedMetadata["links"] }, ["Files/Paper.pdf"]);
  const dom = createFakeDom();
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as { renderInspectorAttachments(parent: HTMLElement, record: VaultRecord): void };
  const opened: TFile[] = [];
  const operations: Promise<unknown>[] = [];
  Object.assign(view, { app: h.app, plugin: { openFile: async (file: TFile, origin: unknown) => { assert.equal(origin, view); opened.push(file); } }, run: (action: () => Promise<unknown>) => { operations.push(action()); } });
  view.renderInspectorAttachments(asHtmlElement(dom.document.body), { path: h.source.path } as VaultRecord);
  const button = dom.document.body.querySelector(".ent-cc-attachment-link");
  button?.dispatch("click");
  await Promise.all(operations);
  assert.equal(opened[0]?.path, "Files/Paper.pdf");
  h.files.delete("Files/Paper.pdf");
  button?.dispatch("click");
  await Promise.all(operations);
  assert.equal(opened.length, 1);
  assert.match((Notice as unknown as { messages: string[] }).messages.at(-1) ?? "", /not available on this device/u);
  (h.app.vault.getAbstractFileByPath as unknown) = () => new TFolder("Files/Paper.pdf");
  button?.dispatch("click");
  await Promise.all(operations);
  assert.equal(opened.length, 1);
});

test("ordinary metadata is collapsible while clinical safety and AI lock stay visible", () => {
  const dom = createFakeDom();
  const data = migrateData(null);
  const record = { path: "Notes/Selected.md", title: "Synthetic topic", kind: "topic", role: "canonical", curriculumId: "TOPIC-1", domain: "General", topicKind: "topic", priority: "P1", reviewStatus: "unverified", synthesisStatus: "", safetyCritical: true, sourceCount: 0, mtime: 0, aiLock: true } as VaultRecord;
  data.selectedPath = record.path;
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as { renderInspector(): void };
  const inspector = dom.document.body.createEl("aside");
  Object.assign(view, {
    app: {}, plugin: { data, isClinicalMode: () => true, isDataReadOnly: () => false, canVisuallyMoveAcrossGroups: () => false },
    inspectorEl: asHtmlElement(inspector), contentEl: asHtmlElement(dom.document.body), recordByPath: new Map([[record.path, record]]),
    isCompactInspectorLayout: () => false, renderInspectorAttachments: () => {}, renderStudyActions: () => {}, renderRelatedKnowledge: () => {},
  });
  view.renderInspector();
  const details = inspector.querySelector(".ent-cc-note-details");
  assert.match(details?.textContent ?? "", /Curriculum IDTOPIC-1/u);
  assert.match(details?.textContent ?? "", /PathNotes\/Selected.md/u);
  assert.doesNotMatch(details?.textContent ?? "", /Priority|AI lock|Safety-critical|Sources/u);
  assert.match(inspector.textContent, /Safety-critical/u);
  assert.match(inspector.textContent, /Locked — structural editing disabled/u);
});

function bareNoteInspector() {
  const dom = createFakeDom();
  const data = migrateData(null);
  const record = { path: "Notes/Selected.md", title: "Synthetic note", kind: "topic", role: "vault-note", curriculumId: "", domain: "General", topicKind: "note", priority: "", reviewStatus: "", synthesisStatus: "", safetyCritical: false, sourceCount: 0, mtime: 0, aiLock: false } as VaultRecord;
  data.selectedPath = record.path;
  const view = Object.create(EntVaultCommandCenterView.prototype) as unknown as {
    renderInspector(): void;
    handleMobileInspectorKeydown(event: KeyboardEvent): void;
    noteDetailsOpen: boolean;
  };
  const inspector = dom.document.body.createEl("aside");
  Object.assign(view, {
    app: {}, plugin: { data, isClinicalMode: () => false, isDataReadOnly: () => false, canVisuallyMoveAcrossGroups: () => false },
    inspectorEl: asHtmlElement(inspector), contentEl: asHtmlElement(dom.document.body), recordByPath: new Map([[record.path, record]]),
    mobileInspectorOpen: true, mobileInspectorNeedsFocus: false, noteDetailsOpen: false,
    timerWindow: { setTimeout: () => 1 }, isCompactInspectorLayout: () => true,
    renderInspectorAttachments: () => {}, renderRelatedKnowledge: () => {},
  });
  view.renderInspector();
  return { dom, inspector, view };
}

test("compact vault-note focus trap includes the final Note details summary without related links", () => {
  const h = bareNoteInspector();
  const summary = h.inspector.querySelector(".ent-cc-note-details summary");
  const back = h.inspector.querySelector(".ent-cc-inspector-close");
  const lastAction = h.inspector.querySelectorAll(".ent-cc-inspector-actions button").at(-1);
  assert.ok(summary && back && lastAction);
  assert.equal(h.inspector.querySelectorAll(".ent-cc-study-action").length, 0);
  // The shared fake DOM handles simple selectors only. Supply this host's real
  // document-order focus candidates while keeping summary selection conditional.
  const query = h.inspector.querySelectorAll.bind(h.inspector);
  h.inspector.querySelectorAll = (selector: string) => selector.includes(",")
    ? [...query("button").filter((button) => !button.disabled), ...(selector.split(",").some((part) => part.trim() === "summary") ? query("summary") : [])]
    : query(selector);
  lastAction.focus();
  const next = new FakeEvent("keydown", { key: "Tab" });
  h.view.handleMobileInspectorKeydown(next as unknown as KeyboardEvent);
  assert.equal(next.defaultPrevented, false, "normal forward Tab must reach Note details rather than wrap early");
  summary.focus();
  const wrap = new FakeEvent("keydown", { key: "Tab" });
  h.view.handleMobileInspectorKeydown(wrap as unknown as KeyboardEvent);
  assert.equal(wrap.defaultPrevented, true);
  assert.equal(h.dom.document.activeElement, back);
  h.view.handleMobileInspectorKeydown(new FakeEvent("keydown", { key: "Tab", shiftKey: true }) as unknown as KeyboardEvent);
  assert.equal(h.dom.document.activeElement, summary, "reverse wrapping reaches the real final control");
});

test("inspector refresh samples live Note details state and ignores a detached queued toggle", () => {
  const h = bareNoteInspector();
  const original = h.inspector.querySelector(".ent-cc-note-details");
  assert.ok(original);
  Object.defineProperty(original, "isConnected", { configurable: true, get: () => h.dom.document.body.contains(original) });
  const originalDetails = original as unknown as HTMLDetailsElement;
  originalDetails.open = true;
  // A native toggle event is queued, so no handler has updated the view field yet.
  assert.equal(h.view.noteDetailsOpen, false);
  h.view.renderInspector();
  const replacement = h.inspector.querySelector(".ent-cc-note-details");
  assert.ok(replacement);
  const replacementDetails = replacement as unknown as HTMLDetailsElement;
  assert.equal(replacementDetails.open, true, "refresh retains an immediately opened disclosure");
  originalDetails.open = false;
  original.dispatch("toggle");
  assert.equal(h.view.noteDetailsOpen, true, "late toggle from detached DOM cannot overwrite the replacement");
  replacementDetails.open = false;
  h.view.renderInspector();
  assert.equal((h.inspector.querySelector(".ent-cc-note-details") as unknown as HTMLDetailsElement).open, false, "an immediately closed disclosure also survives refresh");
});
