import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type EntVaultCommandCenterPlugin from "../src/main.ts";
import { IndexManagerModal } from "../src/index-manager.ts";
import { TaxonomyHealthModal } from "../src/taxonomy-health-modal.ts";
import type { IndexDiagnostic } from "../src/model.ts";
import type { TaxonomyHealthFinding } from "../src/taxonomy-health.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";
import { Notice, TFile } from "./support/obsidian-stub.ts";

type OpenRoute = "index note" | "index diagnostic" | "taxonomy finding";
const routes: OpenRoute[] = ["index note", "index diagnostic", "taxonomy finding"];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function openingFixture(route: OpenRoute, missingFile = false) {
  Notice.messages.length = 0;
  const dom = createFakeDom();
  const modalEl = dom.document.body.createDiv();
  const contentEl = modalEl.createDiv();
  const file = new TFile("Synthetic/Example.md");
  const finding: TaxonomyHealthFinding = {
    id: "synthetic-finding", kind: "duplicate-name", severity: "warning",
    title: "Example", detail: "Synthetic finding", scope: "Index", path: file.path,
  };
  const opened: TFile[] = [];
  let activeBase = "base-a";
  let attempt = deferred();
  let closes = 0;
  const plugin = {
    app: { vault: { getAbstractFileByPath: () => missingFile ? null : file } },
    data: {},
    getActiveKnowledgeBaseId: () => activeBase,
    getDataEpoch: () => 1,
    getTaxonomyHealthFindings: () => [finding],
    isDataReadOnly: () => false,
    openFile: (target: TFile): Promise<void> => {
      opened.push(target);
      return attempt.promise;
    },
  };
  const host = plugin as unknown as EntVaultCommandCenterPlugin;
  const modal = route === "taxonomy finding" ? new TaxonomyHealthModal(host) : new IndexManagerModal(host);
  modal.modalEl = asHtmlElement(modalEl);
  modal.contentEl = asHtmlElement(contentEl);
  modal.close = () => {
    closes += 1;
    modalEl.remove();
  };

  if (route === "taxonomy finding") {
    const taxonomy = modal as unknown as {
      guardOpenedBase(): boolean;
      renderFinding(parent: HTMLElement, finding: TaxonomyHealthFinding): void;
    };
    assert.equal(taxonomy.guardOpenedBase(), true);
    taxonomy.renderFinding(asHtmlElement(contentEl), finding);
  } else {
    const manager = modal as unknown as {
      openedBaseId: string;
      openedDataEpoch: number;
      managerOpen: boolean;
      guardOpenedBase(): boolean;
      renderNoteRow(parent: HTMLElement, note: { path: string; title: string; meta: string }): void;
      renderDiagnostics(diagnostics: IndexDiagnostic[], parent: HTMLElement): void;
    };
    manager.openedBaseId = activeBase;
    manager.openedDataEpoch = 1;
    manager.managerOpen = true;
    assert.equal(manager.guardOpenedBase(), true);
    if (route === "index note") {
      manager.renderNoteRow(asHtmlElement(contentEl), { path: file.path, title: "Example", meta: "Synthetic note" });
    } else {
      manager.renderDiagnostics([
        { id: "synthetic-diagnostic", kind: "broken-parent", title: "Example", detail: "Synthetic finding", path: file.path },
      ], asHtmlElement(contentEl));
    }
  }

  const open = contentEl.querySelectorAll("button").find((button) => route === "taxonomy finding"
    ? button.textContent === "Open note"
    : button.getAttribute("aria-label") === "Open Example");
  return {
    file, opened, open, dom, contentEl,
    get closes() { return closes; },
    get visible() { return dom.document.body.contains(modalEl); },
    resolve: () => attempt.resolve(),
    reject: () => attempt.reject(new Error("The note could not be opened for this test.")),
    retry: () => { attempt = deferred(); },
    changeBase: () => { activeBase = "base-b"; },
  };
}

function nestedTaxonomyFixture(context: TestContext) {
  const fixture = openingFixture("index diagnostic");
  let childEl: FakeElement | undefined;
  let childCloses = 0;
  context.mock.method(TaxonomyHealthModal.prototype, "open", function (this: TaxonomyHealthModal) {
    childEl = fixture.dom.document.body.createDiv();
    this.modalEl = asHtmlElement(childEl);
    this.contentEl = asHtmlElement(childEl.createDiv());
    this.titleEl = asHtmlElement(childEl.createEl("h2"));
    this.close = () => { childCloses += 1; childEl?.remove(); };
    this.onOpen();
  });
  const launch = fixture.contentEl.querySelectorAll("button").find((button) => button.textContent === "Open taxonomy health…");
  assert.ok(launch);
  launch.click();
  assert.ok(childEl);
  const open = childEl.querySelectorAll("button").find((button) => button.textContent === "Open note");
  assert.ok(open);
  return {
    ...fixture,
    parent: fixture,
    open,
    get childVisible() { return Boolean(childEl && fixture.dom.document.body.contains(childEl)); },
    get childCloses() { return childCloses; },
  };
}

test("nested taxonomy opening dismisses both dialogs only after the note opens", async (context) => {
  const fixture = nestedTaxonomyFixture(context);
  fixture.open.click();
  await flushOpening();
  assert.equal(fixture.parent.visible, true);
  assert.equal(fixture.childVisible, true);
  fixture.resolve();
  await flushOpening();
  assert.equal(fixture.childVisible, false);
  assert.equal(fixture.parent.visible, false, "Index Manager must not keep covering the note");
  assert.equal(fixture.childCloses, 1);
  assert.equal(fixture.parent.closes, 1);
});

test("nested taxonomy opening keeps both dialogs after failure and allows retry", async (context) => {
  const fixture = nestedTaxonomyFixture(context);
  fixture.open.click();
  fixture.reject();
  await flushOpening();
  assert.equal(fixture.parent.visible, true);
  assert.equal(fixture.childVisible, true);
  assert.equal(fixture.parent.closes, 0);
  assert.equal(fixture.childCloses, 0);
  assert.match(Notice.messages.join("\n"), /The note could not be opened for this test\./u);
  fixture.retry();
  fixture.open.click();
  fixture.resolve();
  await flushOpening();
  assert.equal(fixture.childVisible, false);
  assert.equal(fixture.parent.visible, false);
});

test("nested taxonomy stale guard does not invoke successful-opening parent dismissal", async (context) => {
  const fixture = nestedTaxonomyFixture(context);
  fixture.changeBase();
  fixture.open.click();
  await flushOpening();
  assert.deepEqual(fixture.opened, []);
  assert.equal(fixture.childVisible, false);
  assert.equal(fixture.parent.visible, true);
  assert.equal(fixture.parent.closes, 0);
});

async function flushOpening(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

for (const route of routes) {
  test(`${route}: keep the dialog while opening, then uncover the note on success`, async () => {
    const fixture = openingFixture(route);
    assert.ok(fixture.open);
    fixture.open.click();
    assert.deepEqual(fixture.opened, [fixture.file]);
    await flushOpening();
    assert.equal(fixture.visible, true, "opening has not finished yet");
    assert.equal(fixture.closes, 0);
    fixture.resolve();
    await flushOpening();
    assert.equal(fixture.visible, false, "the successful note must not stay covered by the dialog");
    assert.equal(fixture.closes, 1);
    assert.deepEqual(Notice.messages, []);
  });

  test(`${route}: report an opening failure, retain the dialog, and allow retry`, async () => {
    const fixture = openingFixture(route);
    assert.ok(fixture.open);
    fixture.open.click();
    fixture.reject();
    await flushOpening();
    assert.equal(fixture.visible, true);
    assert.equal(fixture.closes, 0);
    assert.match(Notice.messages.join("\n"), /The note could not be opened for this test\./u);
    assert.equal(fixture.open.disabled, false);
    fixture.retry();
    fixture.open.click();
    assert.equal(fixture.opened.length, 2);
    fixture.resolve();
    await flushOpening();
    assert.equal(fixture.visible, false);
    assert.equal(fixture.closes, 1);
  });

  test(`${route}: use the existing stale-base guard before opening`, async () => {
    const fixture = openingFixture(route);
    assert.ok(fixture.open);
    fixture.changeBase();
    fixture.open.click();
    await flushOpening();
    assert.deepEqual(fixture.opened, []);
    assert.equal(fixture.visible, false, "the existing stale-base policy closes the obsolete dialog");
    assert.match(Notice.messages.join("\n"), /knowledge base changed/u);
  });

  test(`${route}: missing files have no opening action`, () => {
    const fixture = openingFixture(route, true);
    assert.equal(fixture.open, undefined);
    assert.deepEqual(fixture.opened, []);
    assert.equal(fixture.visible, true);
  });
}
