import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { libraryTabId, migrateData, parseQuery, type LayoutHeading, type VaultRecord } from "../src/model.ts";
import { normalizeLibraryDisplayProfile, type LibraryDisplayProfile } from "../src/library-display-profile.ts";
import type { KnowledgeBaseSearchResultSet, KnowledgeBaseSearchSource } from "../src/search.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function book(id: string, placeholder = false): VaultRecord {
  return {
    path: placeholder ? `kbcc-placeholder:${id}` : `Books/${id}.md`, title: id, kind: "topic", role: "library",
    libraryId: "books", portableId: id, portableIndexed: false, curriculumId: "", domain: "",
    topicKind: "Note", priority: "", reviewStatus: "unverified", synthesisStatus: "", autoresearchStatus: "",
    safetyCritical: false, sourceCount: 0, aliases: [], relatedTopics: [], parentTopic: "", imageStatus: "",
    doseStatus: "", sourceCoverage: "", folderOrder: "", mtime: 1, aiLock: false, ...(placeholder ? { isPlaceholder: true } : {}),
  };
}

function harness(records: VaultRecord[], layout: LayoutHeading[] = []) {
  const dom = createFakeDom();
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.activeTab = libraryTabId("books");
  data.portableIndex.libraries.push({ id: "books", name: "Books", singularName: "Book", icon: "book-open", order: 0, archivedAt: null, sourceKind: null });
  data.portableIndex.libraryLayouts.books = layout;
  let profile = normalizeLibraryDisplayProfile({ layout: "cards" });
  let metadataReads = 0;
  const events: string[] = [];
  const plugin = {
    data, getLibrary: (id: string) => data.portableIndex.libraries.find((library) => library.id === id),
    getActiveKnowledgeBaseId: () => "base-a", getDataEpoch: () => 0, isClinicalMode: () => false, isDataReadOnly: () => false,
    getLibraryDisplayProfile: () => profile,
  };
  const view = Object.create(EntVaultCommandCenterView.prototype) as {
    renderLibrary(parent: HTMLElement, records: VaultRecord[]): number;
    renderGlobalSearchResultSet(parent: HTMLElement, results: KnowledgeBaseSearchResultSet<KnowledgeBaseSearchSource>, stale: boolean): number;
    editMode: boolean; browseRowLimit: number; browseRowsRendered: number; browseRowsOmitted: number;
    browseStructuresRendered: number; browseStructuresOmitted: number; searchScope: string;
  };
  Object.assign(view, {
    plugin, records, recordByPath: new Map(records.map((record) => [record.path, record])),
    app: {
      vault: { getAbstractFileByPath: (path: string) => new TFile(path), getResourcePath: (file: TFile) => `app://vault/${file.path}` },
      metadataCache: {
        getFirstLinkpathDest: () => new TFile("Covers/Book.png"),
        getFileCache: () => { metadataReads += 1; return { frontmatter: { cover: "[[Covers/Book.png]]", author: "Ali", reading_status: "Reading", unselected: "Do not show" } }; },
      },
    },
    contentEl: asHtmlElement(dom.document.body), query: "", parsedQuery: parseQuery(""), editMode: false,
    browseRowLimit: 300, browseStructureLimit: 300, browseRowsRendered: 0, browseRowsOmitted: 0,
    browseStructuresRendered: 0, browseStructuresOmitted: 0, loadedBaseId: "base-a", loadedDataEpoch: 0,
    viewInstanceId: "cards-test", staleViewNoticeShown: false,
    run: (action: () => void) => action(), selectRecord: (path: string) => events.push(`select:${path}`),
    openRecord: (path: string) => events.push(`open:${path}`), togglePin: (path: string) => events.push(`pin:${path}`),
    openCollectionPicker: (path: string) => events.push(`collect:${path}`),
    openPlaceholderActions: (record: VaultRecord) => events.push(`resolve:${record.path}`),
    showRecordMenu: (_event: unknown, record: VaultRecord) => events.push(`menu:${record.path}`),
  });
  const reset = (): void => {
    dom.document.body.empty(); view.browseRowsRendered = 0; view.browseRowsOmitted = 0;
    view.browseStructuresRendered = 0; view.browseStructuresOmitted = 0;
  };
  return { view, data, dom, events, reset, metadataReads: () => metadataReads,
    setProfile: (value: Partial<LibraryDisplayProfile>) => { profile = normalizeLibraryDisplayProfile(value); } };
}

test("Cards preserve direct record placement, nested headings, and Unplaced with selected properties", () => {
  const records = [book("Alpha"), book("Beta"), book("Gamma"), book("Unplaced")];
  const h = harness(records, [{ id: "head", title: "Fiction", collapsed: false, subjects: ["Alpha"], subheadings: [{
    id: "sub", title: "Classics", collapsed: false, subjects: ["Beta"], subheadings: [{ id: "deep", title: "Favorites", collapsed: false, subjects: ["Gamma"] }],
  }] }]);
  assert.equal(h.view.renderLibrary(asHtmlElement(h.dom.document.body), records), 4);
  const grids = h.dom.document.body.querySelectorAll(".ent-cc-library-card-grid");
  assert.equal(grids.length, 4);
  assert.ok(grids.every((grid) => grid.querySelectorAll(".ent-cc-library-card").length === 1));
  assert.ok(grids.every((grid) => !grid.querySelector(".ent-cc-subheading-row")), "nested headings never become grid cells");
  assert.match(h.dom.document.body.textContent, /Fiction.*Classics.*Favorites.*Unplaced Books/s);
  assert.equal(h.dom.document.body.querySelectorAll("img").length, 4);
  assert.match(h.dom.document.body.textContent, /authorAli.*reading_statusReading/s);
  assert.doesNotMatch(h.dom.document.body.textContent, /Do not show|unselected/);
  assert.equal(h.metadataReads(), 4);
});

test("Cards share the existing record budget and never read collapsed or omitted notes", () => {
  const records = Array.from({ length: 450 }, (_, index) => book(`Book ${index}`));
  const h = harness(records);
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 300);
  assert.equal(h.view.browseRowsOmitted, 150);
  assert.equal(h.metadataReads(), 300);
  h.reset();
  h.data.portableIndex.libraryLayouts.books = [{ id: "closed", title: "Closed", collapsed: true, subjects: records.map((record) => record.portableId ?? ""), subheadings: [] }];
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 0);
  assert.equal(h.metadataReads(), 300, "collapsed books never reach metadata lookup");
});

test("List display and Arrange preserve original rows; Done restores Cards without changing the profile", () => {
  const records = [book("Alpha")];
  const h = harness(records);
  h.setProfile({ layout: "list" });
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 0);
  assert.equal(h.metadataReads(), 0);
  h.reset(); h.setProfile({ layout: "cards" }); h.view.editMode = true;
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 0);
  assert.match(h.dom.document.body.textContent, /temporarily shown as a list.*Done to restore Cards/);
  assert.equal(h.metadataReads(), 0);
  h.reset(); h.view.editMode = false;
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 1);
});

test("card titles preserve selection, open, pin, collection, menu, and placeholder controls", () => {
  const records = [book("Alpha"), book("Placeholder", true)];
  const h = harness(records);
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  const title = h.dom.document.body.querySelector(".ent-cc-library-card .ent-cc-subject-title");
  assert.ok(title);
  title.dispatch("click");
  for (const key of ["Enter", "p", "m"]) title.dispatch("keydown", { key });
  h.dom.document.body.querySelector(".ent-cc-library-card .ent-cc-row-more")?.dispatch("click");
  h.dom.document.body.querySelector(".ent-cc-placeholder-row .ent-cc-subject-title")?.dispatch("click");
  assert.deepEqual(h.events, ["select:Books/Alpha.md", "open:Books/Alpha.md", "pin:Books/Alpha.md", "collect:Books/Alpha.md", "menu:Books/Alpha.md", "resolve:kbcc-placeholder:Placeholder"]);
  assert.equal(h.metadataReads(), 1, "placeholders do not read vault files or frontmatter");
  assert.match(h.dom.document.body.querySelector(".ent-cc-placeholder-row")?.textContent ?? "", /No cover/);
});

test("cover taps and keyboard actions match the title and preserve separate card menus and placeholder actions", () => {
  const records = [book("Alpha"), book("Placeholder", true)];
  const h = harness(records);
  h.data.selectedPath = records[0].path;
  h.view.renderLibrary(asHtmlElement(h.dom.document.body), records);
  const card = h.dom.document.body.querySelector(".ent-cc-library-card");
  assert.ok(card);
  const cover = card.querySelector(".ent-cc-library-cover-button");
  const title = card.querySelector(".ent-cc-subject-title");
  assert.ok(cover && title);
  assert.equal(cover.tagName.toLowerCase(), "button");
  assert.equal(cover.getAttribute("aria-label"), "Select Alpha");
  assert.equal(cover.getAttribute("aria-current"), "true");
  assert.equal(cover.getAttribute("aria-keyshortcuts"), title.getAttribute("aria-keyshortcuts"));
  assert.equal(cover.querySelector("button"), null, "the title and actions button must be siblings of the cover button");
  assert.equal(cover.querySelector("img")?.getAttribute("alt"), "");
  for (const control of [cover, title]) {
    control.click();
    for (const key of ["Enter", " ", "p", "m"]) control.dispatch("keydown", { key });
  }
  const expected = ["select:Books/Alpha.md", "open:Books/Alpha.md", "select:Books/Alpha.md", "pin:Books/Alpha.md", "collect:Books/Alpha.md"];
  assert.deepEqual(h.events, [...expected, ...expected]);
  card.querySelector(".ent-cc-row-more")?.click();
  assert.equal(h.events.at(-1), "menu:Books/Alpha.md");
  const placeholder = h.dom.document.body.querySelector(".ent-cc-placeholder-row .ent-cc-library-cover-button");
  assert.ok(placeholder);
  assert.equal(placeholder.getAttribute("aria-label"), "Create or link Placeholder");
  placeholder.click();
  assert.equal(h.events.at(-1), "resolve:kbcc-placeholder:Placeholder");
});

test("This Library search keeps Cards and ranked result order; global search uses List", () => {
  const records = [book("Zulu"), book("Alpha")];
  const h = harness(records);
  const source = { baseId: "base-a", baseName: "Library test", data: h.data };
  const results = { groups: [{ source, records, total: 2 }], counts: [{ source, total: 2 }], total: 2, rendered: 2,
    stats: { examinedRecords: 2, matchedRecords: 2, peakRetainedCandidates: 2, sortedCandidates: 2 } };
  h.view.searchScope = "library";
  assert.equal(h.view.renderGlobalSearchResultSet(asHtmlElement(h.dom.document.body), results, false), 2);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 2);
  assert.deepEqual(h.dom.document.body.querySelectorAll(".ent-cc-subject-title").map((title) => title.textContent), ["Zulu", "Alpha"]);
  h.reset(); h.view.searchScope = "all";
  h.view.renderGlobalSearchResultSet(asHtmlElement(h.dom.document.body), results, false);
  assert.equal(h.dom.document.body.querySelectorAll(".ent-cc-library-card").length, 0);
  assert.equal(h.metadataReads(), 2, "global lists do not resolve cover properties");
});
