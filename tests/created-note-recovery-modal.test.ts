import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { App } from "obsidian";
import { CreatedNoteRecoveryModal } from "../src/created-note-recovery-modal.ts";
import { Modal, Notice } from "./support/obsidian-stub.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(context: TestContext) {
  Notice.messages.length = 0;
  const dom = createFakeDom();
  const modalEl = dom.document.body.createDiv();
  let pending = deferred();
  let opens = 0;
  let organizes = 0;
  let writes = 0;
  let closes = 0;
  const app = { vault: { create: () => { writes += 1; }, modify: () => { writes += 1; } } };
  const modal = new CreatedNoteRecoveryModal(app as unknown as App, "Synthetic/Saved note.md",
    "Synthetic organization failure.", () => { opens += 1; return pending.promise; }, () => { organizes += 1; });
  modal.modalEl = asHtmlElement(modalEl);
  modal.titleEl = asHtmlElement(modalEl.createEl("h2"));
  modal.contentEl = asHtmlElement(modalEl.createDiv());
  context.mock.method(Modal.prototype, "close", () => { closes += 1; modalEl.remove(); });
  modal.onOpen();
  const open = modalEl.querySelectorAll("button").find((button) => button.textContent === "Open saved note");
  assert.ok(open, "exercise the rendered recovery action");
  return {
    open,
    get visible() { return dom.document.body.contains(modalEl); },
    get calls() { return { opens, organizes, writes, closes }; },
    resolve: () => pending.resolve(),
    reject: () => pending.reject(new Error("The saved note could not be opened.")),
    retry: () => { pending = deferred(); },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("Open saved note keeps recovery visible while opening, then uncovers the saved note", async (context) => {
  const f = fixture(context);
  f.open.click();
  await settle();
  assert.equal(f.visible, true, "do not dismiss before opening succeeds");
  assert.deepEqual(f.calls, { opens: 1, organizes: 0, writes: 0, closes: 0 });
  f.resolve();
  await settle();
  assert.equal(f.visible, false, "the recovery dialog must not cover the successfully opened note");
  assert.deepEqual(f.calls, { opens: 1, organizes: 0, writes: 0, closes: 1 });
  assert.deepEqual(Notice.messages, []);
});

test("a failed saved-note open reports the error and permits retry without recreating or reorganizing", async (context) => {
  const f = fixture(context);
  f.open.click();
  f.reject();
  await settle();
  assert.equal(f.visible, true);
  assert.deepEqual(f.calls, { opens: 1, organizes: 0, writes: 0, closes: 0 });
  assert.match(Notice.messages.join("\n"), /The saved note could not be opened\./u);
  assert.equal(f.open.disabled, false);
  f.retry();
  f.open.click();
  f.resolve();
  await settle();
  assert.equal(f.visible, false, "successful retry must uncover the saved note");
  assert.deepEqual(f.calls, { opens: 2, organizes: 0, writes: 0, closes: 1 });
});
