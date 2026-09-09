import assert from "node:assert/strict";
import test from "node:test";
import { captureViewFocus, restoreViewFocus, readableStatus, relativeUpdatedTime, recordAvailabilitySummary } from "../src/view-state.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

test("focus follows a stable identity through DOM replacement, including punctuation in vault names", () => {
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const key = 'folder:Research/"Quotes" [中文]';
  const first = root.createEl("button", { attr: { "data-kbcc-focus": key }, text: "Collapse topic" });
  first.focus();
  const captured = captureViewFocus(asHtmlElement(root));
  root.empty();
  const replacement = root.createEl("button", { attr: { "data-kbcc-focus": key }, text: "Expand topic" });
  assert.equal(restoreViewFocus(asHtmlElement(root), captured), true);
  assert.equal(dom.document.activeElement, replacement);
  root.empty();
  assert.equal(restoreViewFocus(asHtmlElement(root), captured), false);
  assert.equal(captureViewFocus(undefined), null);
});

test("focus restoration supports stable input IDs and accessible control names without claiming unfocused controls", () => {
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  for (const attr of [{ id: "search" }, { "aria-label": "Manage workspace" }]) {
    const old = root.createEl("input", { attr });
    old.focus();
    const captured = captureViewFocus(asHtmlElement(root));
    root.empty();
    const replacement = root.createEl("input", { attr });
    assert.equal(restoreViewFocus(asHtmlElement(root), captured), true);
    assert.equal(dom.document.activeElement, replacement);
  }
  dom.document.body.createEl("button").focus();
  assert.equal(captureViewFocus(asHtmlElement(root)), null);
  assert.equal(restoreViewFocus(asHtmlElement(root), null), false);
});

test("status and update labels are readable without inventing missing metadata", () => {
  assert.equal(readableStatus("source_traced"), "Source traced");
  assert.equal(readableStatus("human-reviewed"), "Human reviewed");
  assert.equal(readableStatus(""), "Not recorded");
  const now = Date.UTC(2026, 8, 9);
  assert.equal(relativeUpdatedTime(0, now), "Update time unavailable");
  assert.equal(relativeUpdatedTime(now, now), "Updated just now");
  assert.equal(relativeUpdatedTime(now - 60_000, now), "Updated 1 minute ago");
  assert.equal(relativeUpdatedTime(now - 120_000, now), "Updated 2 minutes ago");
  assert.equal(relativeUpdatedTime(now - 3_600_000, now), "Updated 1 hour ago");
  assert.equal(relativeUpdatedTime(now - 7_200_000, now), "Updated 2 hours ago");
  assert.equal(relativeUpdatedTime(now - 86_400_000, now), "Updated 1 day ago");
  assert.equal(relativeUpdatedTime(now - 172_800_000, now), "Updated 2 days ago");
});

test("availability counts never present unresolved outline entries as Markdown notes", () => {
  assert.equal(recordAvailabilitySummary([{}, { isPlaceholder: true }]), "2 entries · 1 linked note · 1 placeholder");
  assert.equal(recordAvailabilitySummary([{ isPlaceholder: true }]), "1 entry · 0 linked notes · 1 placeholder");
  assert.equal(recordAvailabilitySummary([]), "0 entries · 0 linked notes · 0 placeholders");
});
