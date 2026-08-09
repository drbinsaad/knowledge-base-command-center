import assert from "node:assert/strict";
import test from "node:test";
import { Notice, Platform } from "obsidian";
import { migrateData, type PluginData, type VaultRecord } from "../src/model.ts";
import { EntVaultCommandCenterView, prepareKnowledgeBaseSearchResults } from "../src/view.ts";
import { asHtmlElement, createFakeDom, type FakeWindow } from "./support/fake-dom.ts";

interface MobileViewHarness {
  contentEl: HTMLElement;
  workspaceEl: HTMLElement | null;
  treeEl: HTMLElement | null;
  query: string;
  renderGlobalSearchResults(parent: HTMLElement): number;
  renderRecordRow(parent: HTMLElement, record: VaultRecord, level: number, membership?: { headingId: string }): void;
  renderSearch(parent: HTMLElement): void;
  reload(): Promise<void>;
}

interface ClipboardViewHarness extends MobileViewHarness {
  copyAction(parent: HTMLElement, icon: string, label: string, command: string): void;
}

interface SearchSource {
  baseId: string;
  baseName: string;
  data: PluginData;
  records: VaultRecord[];
}

function record(path: string, title: string): VaultRecord {
  return {
    path,
    title,
    kind: "topic",
    role: "supporting",
    curriculumId: "",
    domain: "Research",
    topicKind: "Note",
    priority: "",
    reviewStatus: "unverified",
    synthesisStatus: "",
    autoresearchStatus: "",
    safetyCritical: false,
    sourceCount: 0,
    aliases: [],
    relatedTopics: [],
    parentTopic: "",
    imageStatus: "",
    doseStatus: "",
    sourceCoverage: "",
    folderOrder: "Research",
    mtime: 0,
    aiLock: false,
  };
}

function installWindow(window: FakeWindow): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: window, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

function searchSource(baseId: string, baseName: string, records: VaultRecord[]): SearchSource {
  const data = migrateData(null);
  data.settings.workspaceMode = "generic";
  data.settings.enableHoverPreview = false;
  data.settings.workspaceName = baseName;
  return { baseId, baseName, data, records };
}

function createView(window: FakeWindow, inputSources: SearchSource[] = []): EntVaultCommandCenterView {
  const sources = inputSources.length > 0
    ? inputSources
    : [searchSource("base-mobile", "Mobile base", [])];
  const data = sources[0].data;
  const plugin = {
    data,
    getActiveKnowledgeBaseId: () => sources[0].baseId,
    getDataEpoch: () => 0,
    getSearchGeneration: () => 0,
    getRecords: () => sources[0].records,
    reconcileRecords: async () => false,
    isDataReadOnly: () => false,
    savePluginData: async () => undefined,
    getIndexRecords: () => sources[0].records,
    getIndexCandidateFiles: () => [],
    searchKnowledgeBases: async (query: string, options?: { limit?: number }) => prepareKnowledgeBaseSearchResults(
      sources,
      query,
      options?.limit,
    ),
    isClinicalMode: () => false,
  };
  const ViewConstructor = EntVaultCommandCenterView as unknown as new (
    leaf: { app: Record<string, never> },
    plugin: typeof plugin,
  ) => EntVaultCommandCenterView;
  const restoreWindow = installWindow(window);
  try {
    return new ViewConstructor({ app: {} }, plugin);
  } finally {
    restoreWindow();
  }
}

test("real mobile search focus applies the keyboard viewport and resets every scroll owner", () => {
  const dom = createFakeDom();
  dom.window.innerHeight = 844;
  dom.window.visualViewport.height = 430;
  dom.window.visualViewport.offsetTop = 20;
  const view = createView(dom.window) as unknown as MobileViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.clientHeight = 780;
  content.scrollTop = 480;
  content.setBoundingClientRect({ bottom: 844, top: 64 });
  const shell = content.createDiv({ cls: "ent-cc-shell" });
  shell.setBoundingClientRect({ bottom: 844, top: 64 });
  const workspace = content.createDiv({ cls: "ent-cc-workspace" });
  workspace.scrollTop = 320;
  const tree = workspace.createDiv({ cls: "ent-cc-tree-panel" });
  tree.scrollTop = 210;
  view.contentEl = asHtmlElement(content);
  view.workspaceEl = asHtmlElement(workspace);
  view.treeEl = asHtmlElement(tree);

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    view.renderSearch(asHtmlElement(shell));
    const input = shell.querySelector('input[type="search"]');
    assert.ok(input, "the production search renderer should create a search input");
    input.focus({ preventScroll: true });

    assert.equal(shell.hasClass("is-search-focused"), true);
    assert.equal(shell.hasClass("is-virtual-keyboard-open"), true);
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-height"), "386px");
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-shift"), "0px");
    assert.equal(content.scrollTop, 0);
    assert.equal(workspace.scrollTop, 0);
    assert.equal(tree.scrollTop, 0);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real mobile search follows iOS visual-viewport panning below the shell top", () => {
  const dom = createFakeDom();
  dom.window.innerHeight = 844;
  dom.window.visualViewport.height = 430;
  dom.window.visualViewport.offsetTop = 120;
  const view = createView(dom.window) as unknown as MobileViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.clientHeight = 780;
  content.setBoundingClientRect({ bottom: 844, top: 64 });
  const shell = content.createDiv({ cls: "ent-cc-shell" });
  shell.setBoundingClientRect({ bottom: 844, top: 64 });
  view.contentEl = asHtmlElement(content);

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    view.renderSearch(asHtmlElement(shell));
    const input = shell.querySelector('input[type="search"]');
    assert.ok(input);
    input.focus({ preventScroll: true });

    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-height"), "430px");
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-shift"), "56px");

    input.blur();
    assert.equal(shell.hasClass("is-search-focused"), false);
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-height"), "");
    assert.equal(shell.style.getPropertyValue("--ent-cc-search-visual-shift"), "");
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real mobile reload renders a non-empty global search route end to end", async () => {
  const dom = createFakeDom();
  const result = record("Knowledge Base/Laryngomalacia.md", "Laryngomalacia");
  const source = searchSource("base-mobile", "Mobile base", [result]);
  source.data.settings.setupComplete = true;
  const view = createView(dom.window, [source]) as unknown as MobileViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  content.clientHeight = 780;
  content.setBoundingClientRect({ bottom: 844, top: 64 });
  view.contentEl = asHtmlElement(content);
  view.query = "laryn";

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    await view.reload();
    await Promise.resolve();
    await Promise.resolve();

    const shell = content.querySelector(".ent-cc-shell");
    const input = content.querySelector('input[type="search"]');
    assert.ok(shell, "reload should build the production command-center shell");
    assert.ok(input, "reload should build the production search input");
    assert.equal(input.value, "laryn");
    assert.equal(content.querySelectorAll(".ent-cc-search-base-group").length, 1);
    assert.equal(content.querySelectorAll(".ent-cc-subject-row").length, 1);
    assert.match(content.textContent, /Laryngomalacia/);
    assert.doesNotMatch(content.textContent, /No records match this search/);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real record rendering suppresses desktop drag controls when Platform.isMobile is true", () => {
  const dom = createFakeDom();
  const view = createView(dom.window) as unknown as MobileViewHarness & { editMode: boolean };
  const parent = dom.document.body.createDiv();
  view.editMode = true;

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    view.renderRecordRow(asHtmlElement(parent), record("Knowledge Base/Mobile.md", "Mobile note"), 1, { headingId: "heading-a" });

    assert.equal(parent.querySelectorAll(".ent-cc-subject-row").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-subject-title").length, 1);
    assert.equal(parent.querySelectorAll(".ent-cc-drag-handle").length, 0);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("real cross-base search rendering caps mobile DOM rows while preserving the full match count", async () => {
  const dom = createFakeDom();
  const firstRecords = Array.from({ length: 240 }, (_, index) => record(
    `First/Result ${index.toString().padStart(3, "0")}.md`,
    `Result first ${index.toString().padStart(3, "0")}`,
  ));
  const secondRecords = Array.from({ length: 210 }, (_, index) => record(
    `Second/Result ${index.toString().padStart(3, "0")}.md`,
    `Result second ${index.toString().padStart(3, "0")}`,
  ));
  const view = createView(dom.window, [
    searchSource("base-first", "First base", firstRecords),
    searchSource("base-second", "Second base", secondRecords),
  ]) as unknown as MobileViewHarness;
  const parent = dom.document.body.createDiv();
  view.query = "result";

  const mobilePlatform = Platform as unknown as { isMobile: boolean };
  const previousMobile = mobilePlatform.isMobile;
  mobilePlatform.isMobile = true;
  try {
    assert.equal(view.renderGlobalSearchResults(asHtmlElement(parent)), 0, "the async route does not publish a partial result");
    await Promise.resolve();
    parent.empty();
    const total = view.renderGlobalSearchResults(asHtmlElement(parent));

    assert.equal(total, 450, "the view should report every match, including rows beyond the DOM cap");
    assert.equal(parent.querySelectorAll(".ent-cc-subject-row").length, 300);
    assert.equal(parent.querySelectorAll(".ent-cc-search-base-group").length, 2);
    assert.match(parent.querySelector(".ent-cc-search-limit")?.textContent ?? "", /first 300 of 450 results/i);
    assert.match(parent.textContent, /First base/);
    assert.match(parent.textContent, /Second base/);
  } finally {
    mobilePlatform.isMobile = previousMobile;
  }
});

test("the production copy action writes to the clipboard only after its button is clicked", async () => {
  Notice.messages.length = 0;
  const dom = createFakeDom();
  const writes: string[] = [];
  Object.assign(dom.window, {
    navigator: {
      clipboard: {
        writeText: async (value: string): Promise<void> => { writes.push(value); },
      },
    },
  });
  const view = createView(dom.window) as unknown as ClipboardViewHarness;
  const content = dom.document.body.createDiv({ cls: "view-content" });
  const actions = content.createDiv();
  view.contentEl = asHtmlElement(content);

  view.copyAction(asHtmlElement(actions), "copy", "Copy path", "Knowledge Base/Topic.md");

  assert.deepEqual(writes, [], "rendering the action must not touch the clipboard");
  const button = actions.querySelector("button.ent-cc-study-action");
  assert.ok(button);
  button.click();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(writes, ["Knowledge Base/Topic.md"]);
  assert.equal(Notice.messages.includes("Copy path copied."), true);
});
