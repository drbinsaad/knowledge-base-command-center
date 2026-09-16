import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLibraryDisplayProfile, type LibraryDisplayProfile } from "../src/library-display-profile.ts";
import { LibrarySettingsModal } from "../src/library-settings-modal.ts";
import type { LibraryDefinition } from "../src/model.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";

function harness(libraryOverrides: Partial<LibraryDefinition> = {}) {
  const dom = createFakeDom();
  const state = {
    baseId: "base-a",
    epoch: 0,
    externalGeneration: 0,
    readOnly: false,
    legacyPermissionReads: 0,
    library: {
      id: "books", name: "Books", singularName: "Book", icon: "book-open", order: 0,
      sourceKind: null, archivedAt: null, ...libraryOverrides,
    } as LibraryDefinition | null,
    profile: normalizeLibraryDisplayProfile(null),
    displayWrites: [] as Array<LibraryDisplayProfile | null>,
    saveFailure: "",
    saveGate: null as Promise<void> | null,
  };
  const plugin = {
    app: {
      loadLocalStorage: () => {
        state.legacyPermissionReads += 1;
        return { version: 1, externalImagesAllowed: true };
      },
      saveLocalStorage: () => { throw new Error("Library settings must not write image permission"); },
    },
    data: {},
    getActiveKnowledgeBaseId: () => state.baseId,
    getDataEpoch: () => state.epoch,
    getExternalChangeGeneration: () => state.externalGeneration,
    isDataReadOnly: () => state.readOnly,
    getLibrary: () => state.library && { ...state.library },
    getLibraryDisplayProfile: () => normalizeLibraryDisplayProfile(state.profile),
    getEffectiveLibraryNoteProfile: () => ({ folder: "Books", mode: "empty", templatePath: "" }),
    setLibraryDisplayProfile: async (_id: string, profile: LibraryDisplayProfile | null) => {
      if (state.saveGate) await state.saveGate;
      if (state.saveFailure) throw new Error(state.saveFailure);
      state.displayWrites.push(profile && structuredClone(profile));
      state.profile = normalizeLibraryDisplayProfile(profile);
      state.epoch += 1;
    },
  };
  assert.ok(state.library);
  const modal = new LibrarySettingsModal(plugin as unknown as ConstructorParameters<typeof LibrarySettingsModal>[0], state.library);
  const root = dom.document.body.createDiv();
  const content = root.createDiv();
  modal.modalEl = asHtmlElement(root);
  modal.contentEl = asHtmlElement(content);
  modal.titleEl = asHtmlElement(root.createEl("h2"));
  const actions = modal as unknown as {
    saveDisplay(reset: boolean): Promise<void>;
    isCurrent(): boolean;
  };
  modal.onOpen();
  return { dom, modal, content, actions, state };
}

function button(content: FakeElement, name: string): FakeElement {
  const element = content.querySelectorAll("button").find((candidate) => candidate.getAttribute("aria-label") === name);
  assert.ok(element, `Missing ${name} button`);
  return element;
}

function input(content: FakeElement, name: string): FakeElement {
  const element = [...content.querySelectorAll("input"), ...content.querySelectorAll("select")].find((candidate) => candidate.getAttribute("aria-label") === name);
  assert.ok(element, `Missing ${name} input`);
  return element;
}

function change(content: FakeElement, name: string, value: string): void {
  const element = input(content, name);
  element.value = value;
  element.dispatch(element.tagName.toLowerCase() === "select" ? "change" : "input");
}

function displayStatus(content: FakeElement): FakeElement {
  const status = content.querySelector(".ent-cc-library-settings-status");
  assert.ok(status);
  return status;
}

test("Library settings keep explicit save actions outside the scrolling content", () => {
  const { content } = harness();
  for (const section of ["General", "Display", "Note creation", "Display"]) {
    button(content, section).click();
    const body = content.querySelector(".ent-cc-library-settings-scroll");
    const footer = content.querySelector(".ent-cc-library-settings-footer");
    assert.ok(body && footer);
    assert.equal(body.parentElement, content);
    assert.equal(footer.parentElement, content);
    assert.equal(body.contains(footer), false);
    assert.equal(content.querySelectorAll(".ent-cc-library-settings-footer").length, 1);
    assert.equal(footer.contains(button(content, "Close")), true);
    if (section === "Display") {
      assert.equal(footer.contains(button(content, "Save display")), true);
      assert.equal(footer.contains(button(content, "Reset display")), true);
      assert.equal(body.contains(input(content, "Visible properties")), true);
    }
  }
});

test("display draft status changes in place and changes reverted to saved values are clean", () => {
  const { content, dom, state } = harness();
  button(content, "Display").click();
  const status = displayStatus(content);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.textContent, "No unsaved display changes");
  const property = input(content, "Image property");
  property.focus();
  change(content, "Image property", "book_cover");
  assert.equal(displayStatus(content), status, "typing does not replace the status or focused field");
  assert.equal(dom.document.activeElement, property);
  assert.equal(status.textContent, "Unsaved changes — save display to apply");
  assert.equal(status.hasClass("is-unsaved"), true);
  change(content, "Image property", "cover");
  change(content, "Visible properties", "author, reading_status, author");
  assert.equal(status.textContent, "No unsaved display changes", "formatting and duplicate names do not create a different profile");
  assert.equal(status.hasClass("is-unsaved"), false);
  assert.deepEqual(state.displayWrites, [], "editing and reverting never autosaves");
});

test("unsaved display choices survive section changes and remain explicitly saveable", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  change(content, "Image property", "book_cover");
  change(content, "Layout", "cards");
  for (const section of ["General", "Note creation"]) {
    button(content, section).click();
    assert.equal(displayStatus(content).hidden, false);
    assert.match(displayStatus(content).textContent, /Unsaved changes/);
    assert.equal(button(content, "Save display").disabled, false);
  }
  assert.deepEqual(state.displayWrites, []);
  await actions.saveDisplay(false);
  assert.equal(state.displayWrites.length, 1);
  button(content, "Display").click();
  assert.equal(input(content, "Image property").value, "book_cover");
  assert.equal(input(content, "Layout").value, "cards");
  assert.equal(displayStatus(content).textContent, "Display saved");
  assert.equal(displayStatus(content).hasClass("is-unsaved"), false);
  assert.equal(actions.isCurrent(), true);
});

test("failed display persistence keeps the dirty draft and successful retry rebaselines it", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  change(content, "Image property", "book_cover");
  state.saveFailure = "Synthetic display save failure";
  await actions.saveDisplay(false);
  assert.deepEqual(state.displayWrites, []);
  assert.equal(input(content, "Image property").value, "book_cover");
  assert.match(content.textContent, /Synthetic display save failure/);
  assert.match(displayStatus(content).textContent, /Unsaved changes/);
  assert.equal(button(content, "Save display").disabled, false);
  state.saveFailure = "";
  await actions.saveDisplay(false);
  assert.equal(state.displayWrites.length, 1);
  assert.equal(displayStatus(content).textContent, "Display saved");
});

test("a pending save disables mutations and exposes saving status without a second write", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  change(content, "Image property", "book_cover");
  let finishSave!: () => void;
  state.saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
  const save = actions.saveDisplay(false);
  assert.equal(button(content, "Saving…").disabled, true);
  assert.equal(input(content, "Image property").disabled, true);
  assert.equal(displayStatus(content).textContent, "Saving display…");
  await actions.saveDisplay(false);
  assert.deepEqual(state.displayWrites, []);
  finishSave();
  await save;
  assert.equal(state.displayWrites.length, 1);
  assert.equal(displayStatus(content).textContent, "Display saved");
});

test("Library settings has discoverable identity and creation controls, with protected built-in deletion explained", () => {
  const active = harness();
  assert.equal(button(active.content, "Rename…").disabled, false);
  assert.equal(button(active.content, "Archive…").disabled, false);
  assert.match(active.content.textContent, /Permanent deletion becomes available after archiving/);
  button(active.content, "Note creation").click();
  assert.match(active.content.textContent, /Destination: Books/);
  assert.equal(button(active.content, "Edit note creation defaults…").disabled, false);

  const archived = harness({ archivedAt: 1 });
  assert.equal(button(archived.content, "Rename…").disabled, false);
  assert.equal(button(archived.content, "Restore library").disabled, false);
  assert.equal(button(archived.content, "Delete permanently…").disabled, false);

  const builtIn = harness({ sourceKind: "procedure", archivedAt: 1 });
  assert.match(builtIn.content.textContent, /Permanent deletion is unavailable because its source classification is retained/);
  assert.equal(builtIn.content.querySelectorAll("button").some((element) => element.textContent === "Delete permanently…"), false);
});

test("card display edits update the preview in place and save every selected field without reading legacy image permission", async () => {
  const { actions, content, dom, state } = harness();
  button(content, "Display").click();
  assert.equal(dom.document.activeElement, button(content, "Display"), "section changes retain keyboard focus");
  assert.equal(input(content, "Layout").value, "list");
  assert.equal(input(content, "Image property").value, "cover");
  assert.equal(state.legacyPermissionReads, 0);
  change(content, "Layout", "cards");
  const cover = input(content, "Image property");
  cover.focus();
  change(content, "Image property", "book_cover");
  change(content, "Card size", "large");
  change(content, "Image proportions", "square");
  change(content, "Image fit", "cover");
  change(content, "Visible properties", "author, reading_status, year");
  assert.equal(dom.document.activeElement, cover, "editing a field keeps the same form element");
  assert.match(content.querySelector(".ent-cc-library-profile-summary-value")?.textContent ?? "", /large cards.*square.*book_cover.*author, reading_status, year/);
  await actions.saveDisplay(false);
  assert.deepEqual(state.displayWrites, [{
    layout: "cards", imageProperty: "book_cover", cardSize: "large", imageRatio: "square", imageFit: "cover", visibleProperties: ["author", "reading_status", "year"],
  }]);
  assert.equal(state.legacyPermissionReads, 0);
  assert.equal(actions.isCurrent(), true, "own saves rebaseline the editor");
});

test("visible property count is validated and reset restores defaults without reading legacy image permission", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  change(content, "Visible properties", "one,two,three,four,five,six,seven");
  await actions.saveDisplay(false);
  assert.deepEqual(state.displayWrites, []);
  assert.match(content.textContent, /Choose at most 6 visible properties/);
  assert.match(displayStatus(content).textContent, /Unsaved changes/);
  await actions.saveDisplay(true);
  assert.deepEqual(state.displayWrites, [null]);
  assert.equal(state.legacyPermissionReads, 0);
  assert.equal(input(content, "Layout").value, "list");
  assert.equal(input(content, "Visible properties").value, "author, reading_status");
  assert.equal(displayStatus(content).textContent, "Display saved");
});

for (const [name, drift] of [
  ["base switch", (state: ReturnType<typeof harness>["state"]) => { state.baseId = "base-b"; }],
  ["external revision", (state: ReturnType<typeof harness>["state"]) => { state.externalGeneration += 1; }],
  ["display profile change", (state: ReturnType<typeof harness>["state"]) => { state.profile.layout = "cards"; }],
  ["library deletion", (state: ReturnType<typeof harness>["state"]) => { state.library = null; }],
] as const) {
  test(`${name} fences a stale Library display draft`, async () => {
    const { actions, content, state } = harness();
    button(content, "Display").click();
    change(content, "Card size", "large");
    drift(state);
    await actions.saveDisplay(false);
    assert.deepEqual(state.displayWrites, []);
    assert.equal(button(content, "Save display").disabled, true);
    assert.match(content.textContent, /Close and reopen Library settings/);
  });
}

test("Library settings explains local-only covers and never offers an online-image enable or block control", async () => {
  const { actions, content, state } = harness();
  const assertLocalOnly = (): void => {
    assert.match(content.querySelector(".ent-cc-library-cover-info")?.textContent ?? "", /Covers use images stored in this vault\. Online images are not supported in this release\./);
    assert.equal(content.querySelectorAll("button").some((candidate) => /(?:allow|block).*(?:external|online).*image/iu.test(candidate.textContent)), false);
    assert.equal(content.querySelector(".ent-cc-library-image-permission"), null);
    assert.equal(state.legacyPermissionReads, 0, "a leftover permission value is never consulted");
  };
  button(content, "Display").click();
  assertLocalOnly();
  change(content, "Layout", "cards");
  await actions.saveDisplay(false);
  assertLocalOnly();
  await actions.saveDisplay(true);
  assertLocalOnly();
  state.readOnly = true;
  button(content, "General").click();
  button(content, "Display").click();
  assertLocalOnly();
});

test("read-only settings retain navigation, disable changes, and release viewport listeners on close", async () => {
  const { actions, content, dom, modal, state } = harness();
  state.readOnly = true;
  button(content, "Display").click();
  assert.equal(button(content, "Display").disabled, false);
  assert.equal(button(content, "Close").disabled, false);
  assert.equal(button(content, "Save display").disabled, true);
  assert.equal(input(content, "Image property").disabled, true);
  await actions.saveDisplay(false);
  assert.deepEqual(state.displayWrites, []);
  assert.equal(dom.window.visualViewport.listenerCount("resize"), 1);
  modal.onClose();
  assert.equal(dom.window.visualViewport.listenerCount("resize"), 0);
  assert.equal(dom.window.listenerCount("resize"), 0);
});

test("switching sections after the Library is deleted does not read another base's creation defaults", () => {
  const { content, state } = harness();
  state.library = null;
  assert.doesNotThrow(() => button(content, "Note creation").click());
  assert.match(content.textContent, /Reopen library settings to inspect/);
  assert.equal(content.textContent.includes("Destination: Books"), false);
});
