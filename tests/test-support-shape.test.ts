import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, TestHarnessError, createTestFile, createTestFolder } from "./support/obsidian-stub.ts";

test("a fake file derives name, basename, extension and carries full stat", () => {
  const file = new TFile("Books/Deep/My.book.md");
  assert.equal(file.path, "Books/Deep/My.book.md");
  assert.equal(file.name, "My.book.md");
  assert.equal(file.basename, "My.book");
  assert.equal(file.extension, "md");
  assert.equal(file.parent, null);
  assert.deepEqual(file.stat, { ctime: 0, mtime: 0, size: 0 });
  assert.equal(new TFile("README").extension, "");
  assert.equal(new TFile("README").basename, "README");
});

test("name follows the path so the two cannot disagree", () => {
  const file = new TFile("A/one.md");
  file.path = "A/two.md";
  assert.equal(file.name, "two.md");
});

test("a fake folder keeps children and root detection", () => {
  const child = new TFile("Books/Book.md");
  const folder = new TFolder("Books", [child]);
  assert.deepEqual(folder.children, [child]);
  assert.equal(folder.isRoot(), false);
  assert.equal(new TFolder("").isRoot(), true);
  assert.equal(folder.name, "Books");
});

test("the factory sets parent, children and stat consistently", () => {
  const root = createTestFolder("");
  const books = createTestFolder("Books", { parent: root });
  const file = createTestFile("Books/Book.md", { parent: books, stat: { size: 12, mtime: 5 } });
  assert.equal(file.parent, books);
  assert.equal(books.parent, root);
  assert.deepEqual(books.children, [file]);
  assert.deepEqual(root.children, [books]);
  assert.deepEqual(file.stat, { ctime: 0, mtime: 5, size: 12 });
  assert.equal(createTestFolder("X", { children: [file] }).children[0], file);
  assert.equal(file.parent?.path, "X");
});

test("an unsupported host capability throws a named harness error", () => {
  const file = new TFile("Books/Book.md");
  assert.throws(() => file.vault, (error: unknown) => error instanceof TestHarnessError && error.name === "TestHarnessError" && /vault/.test(error.message));
});
