import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLibraryDisplayProfile, type LibraryDisplayProfile } from "../src/library-display-profile.ts";
import { LibrarySettingsModal } from "../src/library-settings-modal.ts";
import EntVaultCommandCenterPlugin from "../src/main.ts";
import { ConfirmModal } from "../src/modals.ts";
import type { LibraryDefinition } from "../src/model.ts";
import { EntVaultCommandCenterView } from "../src/view.ts";
import { asHtmlElement, createFakeDom, type FakeElement } from "./support/fake-dom.ts";

function harness(libraryOverrides: Partial<LibraryDefinition> = {}) {
  const dom = createFakeDom();
  const state = {
    baseId: "base-a",
    epoch: 0,
    externalGeneration: 0,
    readOnly: false,
    allowed: false,
    library: {
      id: "books", name: "Books", singularName: "Book", icon: "book-open", order: 0,
      sourceKind: null, archivedAt: null, ...libraryOverrides,
    } as LibraryDefinition | null,
    profile: normalizeLibraryDisplayProfile(null),
    displayWrites: [] as Array<LibraryDisplayProfile | null>,
    permissionWrites: [] as boolean[],
    permissionWriteError: "",
  };
  const plugin = {
    app: {},
    data: {},
    getActiveKnowledgeBaseId: () => state.baseId,
    getDataEpoch: () => state.epoch,
    getExternalChangeGeneration: () => state.externalGeneration,
    isDataReadOnly: () => state.readOnly,
    getLibrary: () => state.library && { ...state.library },
    getLibraryDisplayProfile: () => normalizeLibraryDisplayProfile(state.profile),
    getExternalLibraryImagesAllowed: () => state.allowed,
    getEffectiveLibraryNoteProfile: () => ({ folder: "Books", mode: "empty", templatePath: "" }),
    setLibraryDisplayProfile: async (_id: string, profile: LibraryDisplayProfile | null) => {
      state.displayWrites.push(profile && structuredClone(profile));
      state.profile = normalizeLibraryDisplayProfile(profile);
      state.epoch += 1;
    },
    setExternalLibraryImagesAllowed: async (allowed: boolean) => {
      state.permissionWrites.push(allowed);
      state.allowed = allowed;
      if (state.permissionWriteError) throw new Error(state.permissionWriteError);
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
    setImagesAllowed(allowed: boolean): Promise<void>;
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

test("card display edits update the preview in place and save every selected field without changing image permission", async () => {
  const { actions, content, dom, state } = harness();
  button(content, "Display").click();
  assert.equal(dom.document.activeElement, button(content, "Display"), "section changes retain keyboard focus");
  assert.equal(input(content, "Layout").value, "list");
  assert.equal(input(content, "Image property").value, "cover");
  assert.deepEqual(state.permissionWrites, []);
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
  assert.deepEqual(state.permissionWrites, []);
  assert.equal(state.allowed, false);
  assert.equal(actions.isCurrent(), true, "own saves rebaseline the editor");
});

test("visible property count is validated and reset restores defaults without granting external image permission", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  change(content, "Visible properties", "one,two,three,four,five,six,seven");
  await actions.saveDisplay(false);
  assert.deepEqual(state.displayWrites, []);
  assert.match(content.textContent, /Choose at most 6 visible properties/);
  await actions.saveDisplay(true);
  assert.deepEqual(state.displayWrites, [null]);
  assert.deepEqual(state.permissionWrites, []);
  assert.equal(input(content, "Layout").value, "list");
  assert.equal(input(content, "Visible properties").value, "author, reading_status");
});

for (const [name, drift] of [
  ["base switch", (state: ReturnType<typeof harness>["state"]) => { state.baseId = "base-b"; }],
  ["external revision", (state: ReturnType<typeof harness>["state"]) => { state.externalGeneration += 1; }],
  ["display profile change", (state: ReturnType<typeof harness>["state"]) => { state.profile.layout = "cards"; }],
  ["library deletion", (state: ReturnType<typeof harness>["state"]) => { state.library = null; }],
  ["permission change", (state: ReturnType<typeof harness>["state"]) => { state.allowed = true; }],
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

test("external images require the explicit warning confirmation, and privacy revocation remains available after a base switch", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  assert.match(content.textContent, /This permission applies to all libraries in this vault on this device/);
  assert.match(content.textContent, /Other vaults and devices keep their own permission/);
  assert.match(content.textContent, /External images are blocked in this vault on this device \(default\)/);
  let confirmation: { message: string; modalEl: HTMLElement; onConfirm(): Promise<void> } | undefined;
  const prior = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function (): void {
    confirmation = this as unknown as typeof confirmation;
  };
  try {
    button(content, "Allow external images…").click();
    assert.deepEqual(state.permissionWrites, []);
    assert.ok(confirmation);
    assert.equal(confirmation.modalEl.classList.contains("ent-cc-image-consent"), true);
    assert.match(confirmation.message, /IP address.*requested image URLs/);
    assert.match(confirmation.message, /all libraries in this vault on this device/);
    assert.match(confirmation.message, /Other vaults and devices keep their own permission/);
    await confirmation.onConfirm();
    assert.deepEqual(state.permissionWrites, [true]);
    assert.deepEqual(state.displayWrites, []);
    assert.match(content.textContent, /External images are allowed in this vault on this device\./);
    state.baseId = "base-b";
    await actions.setImagesAllowed(false);
    assert.deepEqual(state.permissionWrites, [true, false]);
    assert.equal(state.allowed, false);
    assert.deepEqual(state.displayWrites, []);
    assert.match(content.textContent, /External images are blocked in this vault on this device \(default\)/);
  } finally {
    if (prior) Object.defineProperty(ConfirmModal.prototype, "open", prior);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
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

test("a failed permission revocation shows that images are blocked for the session and keeps revocation reachable in read-only mode", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  await actions.setImagesAllowed(true);
  state.readOnly = true;
  button(content, "Display").click();
  assert.equal(button(content, "Block external images").disabled, false);
  state.permissionWriteError = "External covers are blocked for this session, but the permission could not be cleared.";
  await actions.setImagesAllowed(false);
  assert.equal(state.allowed, false);
  assert.match(content.textContent, /External images are blocked in this vault on this device/);
  assert.match(content.textContent, /permission could not be cleared/);
  assert.equal(button(content, "Allow external images…").disabled, true);
});

test("switching sections after the Library is deleted does not read another base's creation defaults", () => {
  const { content, state } = harness();
  state.library = null;
  assert.doesNotThrow(() => button(content, "Note creation").click());
  assert.match(content.textContent, /Reopen library settings to inspect/);
  assert.equal(content.textContent.includes("Destination: Books"), false);
});

test("privacy reset revokes cached consent and clears rendered covers even if local storage is unavailable", async () => {
  let cleared = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as EntVaultCommandCenterView;
  view.clearExternalLibraryImages = () => { cleared += 1; };
  const app = {
    workspace: { getLeavesOfType: () => [{ view }] },
    loadLocalStorage: () => ({ version: 1, externalImagesAllowed: true }),
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {} as never);
  assert.equal(plugin.getExternalLibraryImagesAllowed(), true);
  await assert.rejects(plugin.clearDeviceLocalData(), /device-local storage API is unavailable/);
  assert.equal(plugin.getExternalLibraryImagesAllowed(), false);
  assert.equal(cleared, 1);
});

test("re-enabling after a failed revocation still requires a fresh consent confirmation owned by the current base", async () => {
  const { actions, content, state } = harness();
  button(content, "Display").click();
  await actions.setImagesAllowed(true);
  state.permissionWriteError = "External covers are blocked for this session, but the permission could not be cleared.";
  await actions.setImagesAllowed(false);
  assert.equal(state.allowed, false);
  assert.equal(actions.isCurrent(), true, "the session revocation does not invalidate an otherwise current display draft");
  state.permissionWriteError = "";
  let confirmation: { onConfirm(): Promise<void> } | undefined;
  const prior = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function (): void { confirmation = this as unknown as typeof confirmation; };
  try {
    button(content, "Allow external images…").click();
    assert.ok(confirmation);
    assert.deepEqual(state.permissionWrites, [true, false]);
    state.baseId = "base-b";
    await confirmation.onConfirm();
    assert.deepEqual(state.permissionWrites, [true, false]);
    assert.equal(state.allowed, false);
    assert.match(content.textContent, /Close and reopen Library settings/);
  } finally {
    if (prior) Object.defineProperty(ConfirmModal.prototype, "open", prior);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
});
