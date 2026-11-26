import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { CreatedNoteRecoveryModal } from "../src/created-note-recovery-modal.ts";
import { TopicEditorModal } from "../src/modals.ts";
import { migrateData } from "../src/model.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";
import { Notice, TFile } from "./support/obsidian-stub.ts";

type Kind = "proposal" | "canonical";
type Stage = "validate" | "write" | "link" | "save" | "reload";

function fixture(context: TestContext, kind: Kind, failure?: Stage, replaceAfter?: "write" | "save" | "reload", linked = true) {
  Notice.messages.length = 0;
  const dom = createFakeDom();
  const file = new TFile(`Synthetic/${kind}/Example.md`);
  let liveFile: TFile | null = null;
  let activeBase = "base-a";
  let failing = failure;
  let writes = 0;
  let links = 0;
  let saves = 0;
  let reloads = 0;
  let mutations = 0;
  let editorCloses = 0;
  const opened: TFile[] = [];
  const organized: string[][] = [];
  const recoveryElements: FakeElement[] = [];
  const captured: { editor?: TopicEditorModal } = {};
  const error = dom.document.body.createDiv();
  const check = (stage: Stage): void => { if (failing === stage) throw new Error(`Synthetic ${stage} failure`); };
  const plugin = {
    data: migrateData(null),
    getActiveKnowledgeBaseId: () => activeBase,
    getDataEpoch: () => 0,
    getBaseSurfaceVersion: () => activeBase,
    isClinicalMode: () => true,
    getCanonicalTopics: () => [],
    validateProposal: () => failing === "validate" ? "Synthetic validation failure" : null,
    validateCanonical: () => failing === "validate" ? "Synthetic validation failure" : null,
    createProposal: async () => create(),
    createCanonical: async () => create(),
    saveViewState: async () => { saves += 1; check("save"); replace("save"); },
    mutate: async () => { mutations += 1; throw new Error("Clinical creation recovery must not add manual membership"); },
    openFile: async (target: TFile) => { opened.push(target); },
    openNoteOrganizer: (paths: string[]) => { organized.push(paths); },
  };
  plugin.data.settings.enableAdvancedCanonicalActions = true;
  const replace = (stage: string): void => {
    if (stage !== replaceAfter) return;
    activeBase = "base-b";
    plugin.data = migrateData(null);
    plugin.data.selectedPath = "Replacement/Untouched.md";
  };
  const create = (): TFile => {
    check("write");
    assert.equal(liveFile, null, "the same creation must never run again after its file was saved");
    writes += 1;
    liveFile = file;
    replace("write");
    return file;
  };
  const app = { vault: { getAbstractFileByPath: (path: string) => path === file.path ? liveFile : null } };
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView;
  Object.assign(view, {
    plugin, app, loadedBaseId: "base-a", loadedDataEpoch: 0,
    reload: async () => { reloads += 1; check("reload"); replace("reload"); },
  });
  context.mock.method(TopicEditorModal.prototype, "open", function (this: TopicEditorModal) {
    captured.editor = this;
    Object.assign(this, { errorEl: asHtmlElement(error), confirmed: true });
    this.close = () => { editorCloses += 1; };
  });
  context.mock.method(CreatedNoteRecoveryModal.prototype, "open", function (this: CreatedNoteRecoveryModal) {
    const content = dom.document.body.createDiv();
    recoveryElements.push(content);
    this.modalEl = asHtmlElement(content);
    this.contentEl = asHtmlElement(content.createDiv());
    this.titleEl = asHtmlElement(content.createEl("h2"));
    this.onOpen();
  });
  if (kind === "proposal") {
    view.startCreateProposal({ title: "Example", addToCollection: false }, linked ? async () => { links += 1; check("link"); } : undefined);
  } else view.startCreateCanonical({ title: "Example", addToCollection: false });
  assert.ok(captured.editor);
  const form = captured.editor as unknown as { submit(): Promise<void> };
  return {
    file, plugin, error, recoveryElements, opened, organized,
    submit: () => form.submit(),
    allowRetry: () => { failing = undefined; },
    counts: () => ({ writes, links, saves, reloads, mutations, editorCloses }),
  };
}

for (const failure of ["save", "reload", undefined] as const) {
  test(`standalone proposal: ${failure ?? "successful filing"} keeps the saved-file outcome clear`, async (context) => {
    const f = fixture(context, "proposal", failure, undefined, false);
    await f.submit();
    assert.equal(f.counts().writes, 1);
    assert.equal(f.counts().links, 0);
    assert.equal(f.counts().editorCloses, 1);
    assert.equal(f.recoveryElements.length, failure ? 1 : 0);
    if (failure) assert.ok(f.recoveryElements[0].textContent.includes(f.file.path));
    else assert.ok(Notice.messages.includes("Topic proposal created as unverified in the inbox."));
    assert.equal(f.counts().mutations, 0);
  });
}

for (const kind of ["proposal", "canonical"] as const) {
  for (const failure of ["save", "reload", ...(kind === "proposal" ? ["link" as const] : [])] as const) {
    test(`${kind}: ${failure} failure after creation closes the creation form and exposes the saved file`, async (context) => {
      const f = fixture(context, kind, failure);
      await f.submit();
      assert.equal(f.counts().writes, 1);
      assert.equal(f.counts().editorCloses, 1, "the saved note must not remain in a creation form that invites retry");
      assert.equal(f.error.textContent, "");
      assert.equal(Notice.messages.some(message => /^(?:Unverified topic proposal created|Canonical scaffold created)/u.test(message)), false);
      assert.equal(f.recoveryElements.length, 1);
      const recovery = f.recoveryElements[0];
      assert.match(recovery.textContent, /Your Markdown file is saved/);
      assert.ok(recovery.textContent.includes(f.file.path));
      assert.ok(recovery.textContent.includes(`Synthetic ${failure} failure`));
      recovery.querySelectorAll("button").find(button => button.textContent === "Open saved note")?.click();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(f.opened, [f.file]);
      assert.equal(f.counts().writes, 1);
      assert.equal(f.counts().mutations, 0, "clinical recovery must not create generic direct membership");
      assert.deepEqual(f.plugin.data.directIndexPaths, []);
    });
  }

  for (const stage of ["write", "save", "reload"] as const) {
    test(`${kind}: base replacement after ${stage} preserves the replacement and exposes the saved file`, async (context) => {
      const f = fixture(context, kind, undefined, stage);
      await f.submit();
      assert.equal(f.counts().writes, 1);
      assert.equal(f.counts().editorCloses, 1);
      assert.equal(f.plugin.data.selectedPath, "Replacement/Untouched.md");
      assert.equal(Notice.messages.some(message => /^(?:Unverified topic proposal created|Canonical scaffold created)/u.test(message)), false);
      assert.equal(f.recoveryElements.length, 1);
      assert.ok(f.recoveryElements[0].textContent.includes(f.file.path));
      assert.equal(f.counts().mutations, 0);
      if (stage === "write") assert.equal(f.counts().saves, 0, "the replacement base receives no filing write");
    });
  }

  for (const failure of ["validate", "write"] as const) {
    test(`${kind}: ${failure} failure before a saved file stays retryable without recovery`, async (context) => {
      const f = fixture(context, kind, failure);
      await f.submit();
      assert.equal(f.counts().writes, 0);
      assert.equal(f.counts().editorCloses, 0);
      assert.match(f.error.textContent, /Synthetic .* failure/);
      assert.deepEqual(f.recoveryElements, []);
      f.allowRetry();
      await f.submit();
      assert.equal(f.counts().writes, 1);
      assert.equal(f.counts().editorCloses, 1);
      assert.deepEqual(f.recoveryElements, []);
    });
  }

  test(`${kind}: successful creation keeps the existing destination and success wording`, async (context) => {
    const f = fixture(context, kind);
    await f.submit();
    assert.equal(f.counts().writes, 1);
    assert.equal(f.counts().editorCloses, 1);
    assert.deepEqual(f.recoveryElements, []);
    assert.equal(f.plugin.data.activeTab, kind === "proposal" ? "inbox" : "curriculum");
    assert.equal(f.plugin.data.selectedPath, f.file.path);
    assert.ok(Notice.messages.includes(kind === "proposal"
      ? "Unverified topic proposal created and linked to the imported subject."
      : "Canonical scaffold created with review_status: unverified."));
  });
}
