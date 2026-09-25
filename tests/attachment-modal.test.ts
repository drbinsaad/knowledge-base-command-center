import assert from "node:assert/strict";
import test from "node:test";
import { type App, Notice } from "obsidian";
import { AttachmentLinkInsertionError, MAX_ATTACHMENT_BYTES } from "../src/attachment";
import { AttachmentImportModal, type AttachmentBatchValue } from "../src/attachment-modal";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function modalHarness(onSubmit: (value: AttachmentBatchValue) => Promise<void>) {
  const dom = createFakeDom();
  const modal = new AttachmentImportModal({} as App, "Topic.md", {
    expectedBaseId: "synthetic-base",
    expectedDataEpoch: 0,
    storageMode: "ask",
    configuredFolder: "",
    marker: "<!-- kbcc:attachments -->",
    heading: "Attachments",
  }, [], "end", onSubmit);
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  const internal = modal as unknown as {
    selectedFiles: File[];
    requestedFolder: string;
    destinationSelected: boolean;
    submitButton: HTMLButtonElement | null;
    updateSubmit(): void;
    submit(): Promise<void>;
  };
  // Reflect the disabled attribute like a native HTML button does.
  const button = {
    disabled: false,
    label: "",
    setText(value: string): void { this.label = value; },
    setAttribute(name: string): void { if (name === "disabled") this.disabled = true; },
    removeAttribute(name: string): void { if (name === "disabled") this.disabled = false; },
  };
  internal.submitButton = button as unknown as HTMLButtonElement;
  internal.selectedFiles = [new File(["one"], "one.pdf"), new File(["two"], "two.pdf")];
  internal.destinationSelected = true;
  let closes = 0;
  modal.close = () => { closes += 1; modal.onClose(); };
  internal.updateSubmit();
  return { internal, button, closeCount: () => closes };
}

test("changing files or destination during attachment upload cannot submit another copy", async () => {
  const pending = deferred();
  const submissions: AttachmentBatchValue[] = [];
  const { internal, button, closeCount } = modalHarness(async (value) => {
    submissions.push(value);
    await pending.promise;
  });
  const first = internal.submit();
  let duplicate: Promise<void> | undefined;
  try {
    assert.equal(button.disabled, true);
    internal.requestedFolder = "Other";
    internal.updateSubmit();
    assert.equal(button.disabled, true, "a destination change cannot re-enable Attach during a copy");
    internal.selectedFiles = [new File(["changed"], "changed.pdf")];
    internal.updateSubmit();
    assert.equal(button.disabled, true, "a file selection change cannot re-enable Attach during a copy");
    duplicate = internal.submit();
    assert.equal(submissions.length, 1, "the in-flight operation is the only submission");
    assert.deepEqual(submissions[0]?.files.map((file) => file.name), ["one.pdf", "two.pdf"]);
    assert.equal(submissions[0]?.requestedFolder, "");
  } finally {
    pending.resolve();
    await first;
    await duplicate;
  }
  assert.equal(closeCount(), 1);
});

test("retryable attachment failure revalidates the changed selection before enabling retry", async () => {
  const pending = deferred();
  let submissions = 0;
  const { internal, button, closeCount } = modalHarness(async () => {
    submissions += 1;
    if (submissions === 1) await pending.promise;
  });
  const first = internal.submit();
  internal.selectedFiles = [{ name: "too-large.pdf", size: MAX_ATTACHMENT_BYTES + 1 } as File];
  internal.updateSubmit();
  pending.reject(new Error("Synthetic copy failure."));
  await first;
  assert.equal(closeCount(), 0, "a failed copy keeps the form available");
  assert.equal(button.disabled, true, "the now-invalid selection stays disabled after failure");
  await internal.submit();
  assert.equal(submissions, 1);

  internal.selectedFiles = [new File(["retry"], "retry.pdf")];
  internal.updateSubmit();
  assert.equal(button.disabled, false, "a valid replacement selection can retry");
  await internal.submit();
  assert.equal(submissions, 2);
  assert.equal(closeCount(), 1);
});

test("copied attachment insertion failure closes the form without allowing a duplicate retry", async () => {
  let submissions = 0;
  const { internal, closeCount } = modalHarness(async () => {
    submissions += 1;
    throw new AttachmentLinkInsertionError("The copied files need manual links.");
  });
  await internal.submit();
  assert.equal(closeCount(), 1);
  assert.equal(internal.submitButton, null);
  assert.deepEqual(internal.selectedFiles, []);
  assert.equal(Notice.messages.at(-1), "The copied files need manual links.");
  await internal.submit();
  assert.equal(submissions, 1);
});
