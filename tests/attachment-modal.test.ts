import assert from "node:assert/strict";
import test from "node:test";
import type { App } from "obsidian";
import { Notice } from "./support/obsidian-stub.ts";
import { AttachmentLinkInsertionError, MAX_ATTACHMENT_BYTES } from "../src/attachment";
import { AttachmentImportModal, attachmentDestinationSummary, type AttachmentBatchValue } from "../src/attachment-modal";
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
  }, [], "end", false, onSubmit);
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
  return { internal, button, dom, closeCount: () => closes };
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

test("copied attachment insertion failure keeps a terminal summary open and never allows a duplicate retry", async () => {
  let submissions = 0;
  const { internal, button, dom, closeCount } = modalHarness(async () => {
    submissions += 1;
    throw new AttachmentLinkInsertionError("The copied files need manual links.", ["Files/one.pdf", "Files/two.pdf"]);
  });
  await internal.submit();
  assert.equal(closeCount(), 0, "the recovery summary stays open until the user closes it");
  assert.equal(button.disabled, true, "this batch can no longer be submitted");
  const alert = dom.document.body.querySelector("[role=alert]");
  assert.match(alert?.textContent ?? "", /Files copied; links were not inserted/u);
  assert.match(alert?.textContent ?? "", /Files\/one\.pdf/u);
  assert.match(alert?.textContent ?? "", /Files\/two\.pdf/u);
  assert.equal(Notice.messages.at(-1), "The copied files need manual links.");
  internal.updateSubmit();
  assert.equal(button.disabled, true, "refreshing the form cannot re-enable the copied batch");
  await internal.submit();
  assert.equal(submissions, 1);
});

test("a failure before any copy stays inline and retryable, and clears when corrected", async () => {
  let submissions = 0;
  const { internal, button, dom } = modalHarness(async () => {
    submissions += 1;
    if (submissions === 1) throw new Error("Open this note in the Markdown editor to insert at the cursor.");
  });
  await internal.submit();
  const alert = dom.document.body.querySelector("[role=alert]");
  assert.match(alert?.textContent ?? "", /Open this note in the Markdown editor/u);
  assert.equal(button.disabled, false, "a pre-copy failure stays retryable");
  assert.equal(internal.selectedFiles.length, 2, "the draft files are preserved");
  await internal.submit();
  assert.equal(submissions, 2);
  assert.equal(alert?.textContent, "", "a new attempt clears the old alert");
});

test("the cursor choice falls back to End when the note does not own the editor", () => {
  const dom = createFakeDom();
  const policy = {
    expectedBaseId: "b", expectedDataEpoch: 0, storageMode: "fixed-folder" as const,
    configuredFolder: "Files", marker: "m", heading: "h",
  };
  const without = new AttachmentImportModal({} as App, "Topic.md", policy, [], "cursor", false, async () => {});
  const owning = new AttachmentImportModal({} as App, "Topic.md", policy, [], "cursor", true, async () => {});
  assert.equal((without as unknown as { insertionMode: string }).insertionMode, "end");
  assert.equal((owning as unknown as { insertionMode: string }).insertionMode, "cursor");
  assert.ok(dom);
});

test("destination text matches the four storage modes without promising a filename", () => {
  const base = { configuredFolder: "Assets/Uploads" };
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "fixed-folder" }, "Notes/Topic.md", "", true), /folder Assets\/Uploads/u);
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "note-subfolder" }, "Notes/Topic.md", "", true), /folder Notes\/Topic attachments/u);
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "ask" }, "Notes/Topic.md", "", false), /Choose a vault folder or the vault root/u);
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "ask" }, "Notes/Topic.md", "", true), /the vault root/u);
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "ask" }, "Notes/Topic.md", "Scans", true), /folder Scans/u);
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "obsidian" }, "Notes/Topic.md", "", true), /Obsidian chooses the folder/u);
  assert.match(attachmentDestinationSummary({ ...base, storageMode: "fixed-folder" }, "Notes/Topic.md", "", true), /number added/u);
});
