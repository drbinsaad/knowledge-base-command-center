import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDom } from "./support/fake-dom";

test("removing focused DOM descendants clears focus and detaches parent links", () => {
  const { document } = createFakeDom();
  const container = document.body.createDiv();
  const button = container.createEl("button");
  button.focus();
  container.empty();
  assert.equal(document.activeElement, null);
  assert.equal(button.parentElement, null);
  assert.equal(document.body.contains(button), false);

  const nested = container.createDiv();
  const next = nested.createEl("button");
  next.focus();
  nested.remove();
  assert.equal(document.activeElement, null);
  assert.equal(nested.parentElement, null);
  assert.equal(document.body.contains(next), false);
});

test("emptying a focused container preserves its own focus and unrelated focus", () => {
  const { document } = createFakeDom();
  const container = document.body.createDiv();
  container.createEl("button");
  container.focus();
  container.empty();
  assert.equal(document.activeElement, container);
  const outside = document.body.createEl("button");
  outside.focus();
  container.createEl("button");
  container.empty();
  assert.equal(document.activeElement, outside);
});
