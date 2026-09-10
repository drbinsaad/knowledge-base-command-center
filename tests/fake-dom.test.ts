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

test("append reparents existing elements once and preserves insertion order", () => {
  const { document } = createFakeDom();
  const source = document.body.createDiv();
  const target = document.body.createDiv();
  const first = source.createEl("button", { text: "First" });
  const second = source.createEl("button", { text: "Second" });
  const existing = target.createEl("button", { text: "Existing" });

  target.append(first, second);
  assert.deepEqual(source.children, []);
  assert.deepEqual(target.children, [existing, first, second]);
  assert.equal(first.parentElement, target);
  assert.equal(source.contains(first), false);
  assert.equal(target.contains(first), true);
  source.empty();
  assert.equal(first.parentElement, target, "emptying the old parent cannot detach a moved node");

  assert.equal(target.appendChild(first), first);
  assert.deepEqual(target.children, [existing, second, first], "reinsertion moves instead of duplicating");
  assert.throws(() => first.appendChild(target), /cannot contain itself/u);
  assert.throws(() => target.appendChild(target), /cannot contain itself/u);
  assert.equal(first.parentElement, target, "invalid insertion leaves the original tree intact");
});
