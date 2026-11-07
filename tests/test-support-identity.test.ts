import assert from "node:assert/strict";
import test from "node:test";
import { Notice as LoaderNotice, TAbstractFile as LoaderAbstractFile, TFile as LoaderFile, TFolder as LoaderFolder } from "obsidian";
import { Notice, TAbstractFile, TFile, TFolder } from "./support/obsidian-stub.ts";

// Under the real test loader the module specifier "obsidian" is redirected to
// the stub. These tests prove the explicit support path is the very same
// module instance, so values imported either way are interchangeable.

test("module obsidian and the explicit stub path expose the same values", () => {
  assert.equal(LoaderFile, TFile);
  assert.equal(LoaderNotice, Notice);
  assert.equal(LoaderFolder, TFolder);
  assert.equal(LoaderAbstractFile, TAbstractFile);
});

test("instanceof works across both import routes", () => {
  const viaStub = new TFile("Books/Book.md");
  const viaLoader = new (LoaderFile as unknown as typeof TFile)("Books/Other.md");
  assert.ok(viaStub instanceof LoaderFile);
  assert.ok(viaLoader instanceof TFile);
  assert.ok(viaStub instanceof LoaderAbstractFile);
  assert.ok(new TFolder("Books") instanceof LoaderFolder);
});

test("the shared Notice recorder sees messages from both import routes", () => {
  Notice.messages.length = 0;
  new Notice("Via stub path");
  new LoaderNotice("Via obsidian specifier");
  assert.deepEqual(Notice.messages, ["Via stub path", "Via obsidian specifier"]);
  assert.deepEqual((LoaderNotice as unknown as typeof Notice).messages, Notice.messages);
});
