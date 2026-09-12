import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import type { App } from "obsidian";
import {
  NoteOrganizerModal,
  buildNoteOrganizerSearchIndex,
  collectOrganizerDescendantPaths,
  noteOrganizerTreeItemOwnsEvent,
  queryNoteOrganizerSearchIndex,
  snapshotNoteOrganizerDraft,
  validateNoteOrganizerDraft,
  type NoteOrganizerDraft,
  type NoteOrganizerHost,
  type OrganizerBaseOption,
  type OrganizerPreparedPlan,
  type OrganizerVaultNode,
} from "../src/note-organizer-modal.ts";
import { MAX_NOTE_ORGANIZER_NOTES } from "../src/note-organizer.ts";
import { asHtmlElement, createFakeDom, type FakeElement, type FakeWindow } from "./support/fake-dom.ts";

const BASE: OrganizerBaseOption = {
  id: "base-ent",
  name: "ENT knowledge base",
  current: true,
  indexName: "Knowledge Index",
  indexHeadings: [{
    id: "pediatric",
    name: "Pediatric",
    subheadings: [{ id: "airway", name: "Airway" }],
  }],
  libraries: [{
    id: "sources",
    name: "Sources",
    headings: [{ id: "books", name: "Books", subheadings: [{ id: "textbooks", name: "Textbooks" }] }],
  }],
  collections: [{
    id: "board-review",
    name: "Board review",
    subheadings: [{ id: "congenital", name: "Congenital" }],
  }],
};

const SECOND_BASE: OrganizerBaseOption = {
  ...BASE,
  id: "base-research",
  name: "Research base",
  current: false,
};

function notes(count: number, prefix = "Knowledge Base/ENT"): OrganizerVaultNode[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "note" as const,
    name: `Topic ${index}`,
    path: `${prefix}/Topic ${String(index).padStart(5, "0")}.md`,
  }));
}

function prepared(rows = 1, token: unknown = { transaction: "opaque" }): OrganizerPreparedPlan {
  return {
    preparedToken: token,
    warnings: [],
    errors: [],
    summary: { noteCount: rows, baseCount: 1, changeCount: rows, unchangedCount: 0, skippedCount: 0 },
    reviewRows: Array.from({ length: rows }, (_, index) => ({
      path: `Knowledge Base/ENT/Topic ${String(index).padStart(5, "0")}.md`,
      noteTitle: `Topic ${index}`,
      baseId: BASE.id,
      baseName: BASE.name,
      outcome: "change" as const,
      before: { primary: "Not organized", collections: [] },
      after: { primary: "Knowledge Index / Pediatric / Airway", collections: ["Board review / Larynx / Congenital"] },
    })),
  };
}

interface HostHarness {
  host: NoteOrganizerHost;
  drafts: NoteOrganizerDraft[];
  appliedTokens: unknown[];
  setPrepared(value: OrganizerPreparedPlan): void;
  setApplyError(value: Error | null): void;
}

function hostHarness(vaultNodes: readonly OrganizerVaultNode[], bases: readonly OrganizerBaseOption[] = [BASE]): HostHarness {
  const drafts: NoteOrganizerDraft[] = [];
  const appliedTokens: unknown[] = [];
  let nextPrepared = prepared();
  let applyError: Error | null = null;
  return {
    host: {
      app: {} as App,
      getVaultSnapshot: () => vaultNodes,
      getBases: () => bases,
      prepare: async (draft) => {
        drafts.push(draft);
        return nextPrepared;
      },
      applyPrepared: async (token) => {
        appliedTokens.push(token);
        if (applyError) throw applyError;
        return { changedNotes: 1, changedBases: 1, changeCount: 1 };
      },
    },
    drafts,
    appliedTokens,
    setPrepared: (value) => { nextPrepared = value; },
    setApplyError: (value) => { applyError = value; },
  };
}

interface ModalHarness {
  modal: NoteOrganizerModal;
  modalRoot: FakeElement;
  content: FakeElement;
  window: FakeWindow;
  closed(): number;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

interface ControlledTimers {
  pending(): number;
  cleared(): number;
  runAll(): void;
}

function controlTimers(window: FakeWindow): ControlledTimers {
  let nextId = 1;
  let clearCount = 0;
  const callbacks = new Map<number, TimerHandler>();
  window.setTimeout = (callback: TimerHandler): number => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  window.clearTimeout = (id?: number): void => {
    if (id !== undefined && callbacks.delete(id)) clearCount += 1;
  };
  return {
    pending: () => callbacks.size,
    cleared: () => clearCount,
    runAll: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) {
        if (typeof callback === "function") callback();
      }
    },
  };
}

async function openModal(
  host: NoteOrganizerHost,
  preselectedPaths: readonly string[] = [],
  onClosed?: () => void,
  configureWindow?: (window: FakeWindow) => void,
  singleNote = false,
): Promise<ModalHarness> {
  const dom = createFakeDom();
  configureWindow?.(dom.window);
  const root = dom.document.body.createDiv();
  const title = root.createEl("h2");
  const content = root.createDiv();
  let closeCount = 0;
  const modal = new NoteOrganizerModal(host, { source: "files-menu", preselectedPaths, onClosed, singleNote });
  Object.assign(modal, {
    modalEl: asHtmlElement(root),
    titleEl: asHtmlElement(title),
    contentEl: asHtmlElement(content),
  });
  modal.close = () => {
    closeCount += 1;
    modal.onClose();
  };
  modal.onOpen();
  await settle();
  return { modal, modalRoot: root, content, window: dom.window, closed: () => closeCount };
}

function button(content: FakeElement, text: string): FakeElement {
  const found = content.querySelectorAll("button").find((candidate) => candidate.textContent === text);
  assert.ok(found, `missing button: ${text}`);
  return found;
}

function selectByLabel(content: FakeElement, label: string): FakeElement {
  const found = content.querySelectorAll("select").find((candidate) => candidate.getAttribute("aria-label") === label);
  assert.ok(found, `missing select: ${label}`);
  return found;
}

function changeSelect(content: FakeElement, label: string, value: string): void {
  const select = selectByLabel(content, label);
  select.value = value;
  select.dispatch("change");
}

async function openSingleNote(host: NoteOrganizerHost, path: string): Promise<ModalHarness> {
  return openModal(host, [path], undefined, undefined, true);
}

test("single-note entry starts at location with two stages and no vault tree or per-note overrides", async () => {
  const vaultNotes = notes(2);
  const harness = hostHarness(vaultNotes);
  const path = vaultNotes[0].path;
  const surface = await openSingleNote(harness.host, path);
  assert.equal(surface.modalRoot.querySelector("h2")?.textContent, "Organize this note");
  assert.equal(surface.modalRoot.classList.contains("is-single-note"), true);
  const steps = surface.content.querySelectorAll(".ent-cc-note-organizer-progress-step");
  assert.equal(steps.length, 2);
  assert.match(steps[0].textContent, /Choose location/u);
  assert.equal(steps[0].getAttribute("aria-current"), "step");
  assert.equal(surface.content.querySelector('[role="tree"]'), null);
  assert.equal(surface.content.querySelector(".ent-cc-note-organizer-overrides"), null);
  assert.equal(surface.content.querySelectorAll("button").some((item) => item.textContent === "Back to notes"), false);
  assert.equal(selectByLabel(surface.content, "Place in").value, "index");
  assert.equal(selectByLabel(surface.content, "Index heading").value, "pediatric");
  assert.equal(selectByLabel(surface.content, "Under heading or note").value, "");
  assert.equal(button(surface.content, "Review placement").disabled, false);
  button(surface.content, "Review placement").click();
  await settle();
  assert.deepEqual(harness.drafts[0].selectedPaths, [path]);
  assert.deepEqual(harness.drafts[0].overrides, []);
  assert.match(surface.content.querySelectorAll(".ent-cc-note-organizer-progress-step")[1].textContent, /Review/u);
  assert.equal(button(surface.content, "Save organization").disabled, false);
});

test("single-note mode requires exactly one preselection and never replaces the bulk flow", async () => {
  const vaultNotes = notes(2);
  for (const paths of [[], vaultNotes.map((note) => note.path)]) {
    const surface = await openModal(hostHarness(vaultNotes).host, paths, undefined, undefined, true);
    assert.equal(surface.modalRoot.classList.contains("is-single-note"), false);
    assert.equal(surface.content.querySelectorAll(".ent-cc-note-organizer-progress-step").length, 3);
    assert.ok(surface.content.querySelector('[role="tree"]'));
  }
});

test("single-note existing Index and Library placements prefill exact identities without preparing or applying", async () => {
  const path = notes(1)[0].path;
  const placements: NonNullable<OrganizerBaseOption["initialPrimary"]>[] = [
    { mode: "index", libraryId: null, headingId: "pediatric", subheadingId: "airway" },
    { mode: "library", libraryId: "sources", headingId: "books", subheadingId: "textbooks" },
  ];
  for (const initialPrimary of placements) {
    const base = { ...BASE, initialPrimary };
    const harness = hostHarness(notes(1), [base]);
    const surface = await openSingleNote(harness.host, path);
    assert.equal(selectByLabel(surface.content, "Place in").value, initialPrimary.mode);
    if (initialPrimary.mode === "index") {
      assert.equal(selectByLabel(surface.content, "Index heading").value, "pediatric");
      assert.equal(selectByLabel(surface.content, "Under heading or note").value, "airway");
    } else {
      assert.equal(selectByLabel(surface.content, "Library").value, "sources");
      assert.equal(selectByLabel(surface.content, "Heading").value, "books");
      assert.equal(selectByLabel(surface.content, "Subheading").value, "textbooks");
    }
    assert.deepEqual(harness.drafts, []);
    assert.deepEqual(harness.appliedTokens, []);
    button(surface.content, "Review placement").click();
    await settle();
    assert.deepEqual(harness.drafts[0].destinations[0].primary, initialPrimary);
  }
});

test("single-note heading and parent choice reach the exact review and Save returns its opaque token once", async () => {
  const path = notes(1)[0].path;
  const parentPath = "kbcc-placeholder:research-parent";
  const base: OrganizerBaseOption = {
    ...BASE,
    indexHeadings: [...BASE.indexHeadings, { id: "research", name: "Research", subheadings: [{ id: parentPath, name: "Evidence / Research parent (no note)" }] }],
  };
  const token = Object.freeze({ transaction: "exact-single-note-token" });
  const harness = hostHarness(notes(1), [base]);
  harness.setPrepared(prepared(1, token));
  const surface = await openSingleNote(harness.host, path);
  changeSelect(surface.content, "Under heading or note", "airway");
  changeSelect(surface.content, "Index heading", "research");
  assert.equal(selectByLabel(surface.content, "Under heading or note").value, "", "a new group cannot inherit the old parent");
  changeSelect(surface.content, "Under heading or note", parentPath);
  const choice = { mode: "index", libraryId: null, headingId: "research", subheadingId: parentPath };
  button(surface.content, "Review placement").click();
  await settle();
  assert.deepEqual(harness.drafts[0].destinations[0].primary, choice);
  assert.deepEqual(harness.drafts[0].selectedPaths, [path]);
  assert.deepEqual(harness.drafts[0].overrides, []);
  assert.match(surface.content.textContent, /Before.*After/isu);
  assert.match(surface.content.textContent, /Markdown files rewritten/u);
  button(surface.content, "Back to destinations").click();
  assert.equal(selectByLabel(surface.content, "Under heading or note").value, parentPath);
  button(surface.content, "Review placement").click();
  await settle();
  const pending = deferred<{ changedNotes: number; changedBases: number; changeCount: number }>();
  harness.host.applyPrepared = (received) => { harness.appliedTokens.push(received); return pending.promise; };
  button(surface.content, "Save organization").click();
  button(surface.content, "Applying…").click();
  assert.deepEqual(harness.appliedTokens, [token]);
  assert.equal(harness.appliedTokens[0], token);
  pending.resolve({ changedNotes: 1, changedBases: 1, changeCount: 1 });
  await settle();
  assert.equal(surface.closed(), 1);
});

test("single-note advanced options expose Collections and other bases without per-note overrides or losing location", async () => {
  const harness = hostHarness(notes(1), [BASE, SECOND_BASE]);
  const surface = await openSingleNote(harness.host, notes(1)[0].path);
  changeSelect(surface.content, "Under heading or note", "airway");
  assert.equal(button(surface.content, "Add knowledge base").hidden, true);
  assert.equal(surface.content.querySelectorAll("legend").some((item) => item.textContent === "Collections"), false);
  button(surface.content, "More options: Collections and other bases").click();
  assert.equal(button(surface.content, "Hide advanced options").getAttribute("aria-expanded"), "true");
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "advanced-options");
  assert.equal(button(surface.content, "Add knowledge base").hidden, false);
  changeSelect(surface.content, "Action", "add");
  button(surface.content, "Add target").click();
  changeSelect(surface.content, "Subheading", "congenital");
  button(surface.content, "Add knowledge base").click();
  await settle();
  assert.equal(surface.content.querySelectorAll(".ent-cc-note-organizer-destination-card").length, 2);
  assert.equal(selectByLabel(surface.content, "Under heading or note").value, "airway");
  assert.equal(surface.content.querySelector(".ent-cc-note-organizer-overrides"), null);
  button(surface.content, "Review placement").click();
  await settle();
  assert.equal(harness.drafts[0].destinations.length, 2);
  assert.deepEqual(harness.drafts[0].destinations[0].collections.targets, [{ headingId: "board-review", subheadingId: "congenital" }]);
  assert.equal(harness.drafts[0].destinations[0].primary.subheadingId, "airway");
  assert.deepEqual(harness.drafts[0].overrides, []);
});

test("single-note external refresh expires Save while retaining the chosen location and original note", async () => {
  const harness = hostHarness(notes(1));
  const path = notes(1)[0].path;
  const surface = await openSingleNote(harness.host, path);
  changeSelect(surface.content, "Under heading or note", "airway");
  button(surface.content, "Review placement").click();
  await settle();
  const original = structuredClone(harness.drafts[0]);
  await surface.modal.refreshAfterExternalChange();
  const save = button(surface.content, "Save organization");
  assert.equal(save.disabled, true);
  save.click();
  assert.deepEqual(harness.appliedTokens, []);
  button(surface.content, "Refresh review").click();
  await settle();
  assert.deepEqual(harness.drafts[1], original);
  assert.equal(button(surface.content, "Save organization").disabled, false);
});

test("single-note removed Index parent remains unavailable instead of silently becoming the heading root", async () => {
  let bases = [structuredClone(BASE)];
  const harness = hostHarness(notes(1));
  harness.host.getBases = () => bases;
  const surface = await openSingleNote(harness.host, notes(1)[0].path);
  changeSelect(surface.content, "Under heading or note", "airway");
  bases = [{ ...structuredClone(BASE), indexHeadings: [{ id: "pediatric", name: "Pediatric", subheadings: [] }] }];
  await surface.modal.refreshAfterExternalChange();
  assert.equal(selectByLabel(surface.content, "Under heading or note").value, "airway");
  assert.match(surface.content.textContent, /Unavailable — choose another destination/u);
  button(surface.content, "Review placement").click();
  await settle();
  assert.deepEqual(harness.drafts, []);
  assert.match(surface.content.textContent, /subheading is unavailable/u);
});

test("single-note base change loads fresh details before prefill and fences an older async response", async () => {
  const harness = hostHarness(notes(1), [BASE, SECOND_BASE]);
  const requests: string[][] = [];
  const pending = deferred<readonly OrganizerBaseOption[]>();
  let calls = 0;
  harness.host.getBases = (ids) => {
    requests.push([...(ids ?? [])]);
    calls += 1;
    if (calls === 2) return pending.promise;
    return [BASE, { ...SECOND_BASE, initialPrimary: { mode: "library", libraryId: "sources", headingId: "books", subheadingId: "textbooks" } }];
  };
  const surface = await openSingleNote(harness.host, notes(1)[0].path);
  changeSelect(surface.content, "Knowledge base", SECOND_BASE.id);
  assert.deepEqual(requests[1], [SECOND_BASE.id]);
  assert.match(surface.content.textContent, /Loading Markdown notes and KBCC destinations/u);
  assert.equal(surface.content.querySelectorAll("button").some((item) => item.textContent === "Review placement"), false);
  pending.resolve([BASE, { ...SECOND_BASE, initialPrimary: { mode: "library", libraryId: "sources", headingId: "books", subheadingId: "textbooks" } }]);
  await settle();
  assert.equal(selectByLabel(surface.content, "Knowledge base").value, SECOND_BASE.id);
  assert.equal(selectByLabel(surface.content, "Place in").value, "library");
  assert.equal(selectByLabel(surface.content, "Subheading").value, "textbooks");
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "field:shared-1-base");

  const old = deferred<readonly OrganizerBaseOption[]>();
  harness.host.getBases = () => old.promise;
  changeSelect(surface.content, "Knowledge base", BASE.id);
  harness.host.getBases = () => [{ ...BASE, name: "Fresh current base" }, SECOND_BASE];
  await surface.modal.refreshAfterExternalChange();
  old.resolve([{ ...BASE, name: "Stale current base", initialPrimary: { mode: "library", libraryId: "sources", headingId: "books", subheadingId: "textbooks" } }, SECOND_BASE]);
  await settle();
  assert.match(selectByLabel(surface.content, "Knowledge base").textContent, /Fresh current base/u);
  assert.doesNotMatch(surface.content.textContent, /Stale current base/u);
  assert.notEqual(selectByLabel(surface.content, "Place in").value, "library", "late details cannot overwrite the current draft");
  assert.deepEqual(harness.drafts, []);
  assert.deepEqual(harness.appliedTokens, []);
});

test("single-note unavailable original path never selects another note with the same name", async () => {
  const original = "Original/Same.md";
  const replacement: OrganizerVaultNode = { kind: "note", name: "Same", path: "Other/Same.md" };
  const harness = hostHarness([replacement]);
  const surface = await openSingleNote(harness.host, original);
  assert.match(surface.content.textContent, /This note is no longer available/u);
  assert.match(surface.content.textContent, /Original\/Same\.md/u);
  assert.equal(button(surface.content, "Review placement").disabled, true);
  button(surface.content, "Review placement").click();
  await settle();
  assert.deepEqual(harness.drafts, []);
  assert.deepEqual(harness.appliedTokens, []);
  assert.equal(surface.content.querySelector('[role="tree"]'), null);
});

test("single-note unchanged review offers Done without Apply and retains stale, error and read-only fences", async () => {
  for (const state of ["ready", "stale", "error", "read-only"] as const) {
    const harness = hostHarness(notes(1));
    const unchanged = prepared();
    unchanged.summary = { noteCount: 1, baseCount: 1, changeCount: 0, unchangedCount: 1, skippedCount: 0 };
    unchanged.reviewRows = unchanged.reviewRows.map((row) => ({ ...row, outcome: "unchanged", before: row.after }));
    if (state === "error") unchanged.errors = ["The selected destination is no longer available."];
    harness.setPrepared(unchanged);
    let readOnly = false;
    harness.host.isReadOnly = () => readOnly;
    const surface = await openSingleNote(harness.host, notes(1)[0].path);
    button(surface.content, "Review placement").click();
    await settle();
    if (state === "stale") await surface.modal.refreshAfterExternalChange();
    if (state === "read-only") {
      readOnly = true;
      button(surface.content, "Back to destinations").click();
      assert.equal(button(surface.content, "Review placement").disabled, true);
      readOnly = false;
      button(surface.content, "Review placement").click();
      await settle();
      readOnly = true;
      (surface.modal as unknown as { render(): void }).render();
    }
    const done = button(surface.content, "Done — no changes needed");
    assert.equal(done.disabled, state !== "ready");
    done.click();
    await settle();
    assert.deepEqual(harness.appliedTokens, [], "a no-change review never joins an Apply transaction");
    assert.equal(surface.closed(), state === "ready" ? 1 : 0);
    if (state === "ready") assert.equal((surface.modal as unknown as { discardConfirmed: boolean }).discardConfirmed, true, "Done must not open a discard confirmation for unchanged data");
  }
});

test("single-note removal after review disables Save and preserves the exact missing path without substitution", async () => {
  const original: OrganizerVaultNode = { kind: "note", name: "Same", path: "Original/Same.md" };
  const replacement: OrganizerVaultNode = { kind: "note", name: "Same", path: "Other/Same.md" };
  let snapshot: readonly OrganizerVaultNode[] = [original, replacement];
  const harness = hostHarness(snapshot);
  harness.host.getVaultSnapshot = () => snapshot;
  const surface = await openSingleNote(harness.host, original.path);
  button(surface.content, "Review placement").click();
  await settle();
  snapshot = [replacement];
  await surface.modal.refreshAfterExternalChange();
  assert.equal(button(surface.content, "Save organization").disabled, true);
  button(surface.content, "Save organization").click();
  assert.deepEqual(harness.appliedTokens, []);
  button(surface.content, "Back to destinations").click();
  assert.match(surface.content.textContent, /This note is no longer available/u);
  assert.match(surface.content.textContent, /Original\/Same\.md/u);
  assert.equal(button(surface.content, "Review placement").disabled, true);
  button(surface.content, "Review placement").click();
  await settle();
  assert.equal(harness.drafts.length, 1);
  assert.deepEqual(harness.drafts[0].selectedPaths, [original.path]);
});

test("Index parent search filters in place without changing the selected location or focused input", async () => {
  const path = notes(1)[0].path;
  const selectedPath = "Vault/Chosen.md";
  const locations = Array.from({ length: 20 }, (_, index) => ({ id: `Vault/Parent ${index}.md`, name: `Heading / Parent ${index}` }));
  locations.push({ id: selectedPath, name: "Heading / Chosen parent" });
  const initialPrimary: NonNullable<OrganizerBaseOption["initialPrimary"]> = { mode: "index", libraryId: null, headingId: "many", subheadingId: selectedPath };
  const base: OrganizerBaseOption = { ...BASE, indexHeadings: [{ id: "many", name: "Many parents", subheadings: locations }], initialPrimary };
  const harness = hostHarness(notes(1), [base]);
  const surface = await openSingleNote(harness.host, path);
  const search = surface.content.querySelectorAll("input").find((input) => input.getAttribute("aria-label") === "Find a heading or note");
  assert.ok(search);
  const select = selectByLabel(surface.content, "Under heading or note");
  search.focus();
  search.value = "PARENT 19";
  search.dispatch("input");
  assert.equal(surface.content.ownerDocument.activeElement, search);
  assert.equal(selectByLabel(surface.content, "Under heading or note"), select, "typing updates options without rebuilding controls");
  assert.equal(select.value, selectedPath);
  assert.deepEqual(select.querySelectorAll("option").map((option) => option.getAttribute("value")), ["", selectedPath, "Vault/Parent 19.md"]);
  assert.match(surface.content.textContent, /1 matching locations.*Your current selection is kept/u);
  search.value = "no location matches this";
  search.dispatch("input");
  assert.equal(select.querySelectorAll("option").length, 2);
  assert.equal(select.value, selectedPath, "empty results do not silently choose root");
  assert.deepEqual(harness.drafts, []);
  assert.deepEqual(harness.appliedTokens, []);
  button(surface.content, "Review placement").click();
  await settle();
  assert.deepEqual(harness.drafts[0].destinations[0].primary, initialPrimary);

  const small = await openSingleNote(hostHarness(notes(1), [{ ...base, initialPrimary: undefined, indexHeadings: [{ id: "small", name: "Small", subheadings: locations.slice(0, 12) }] }]).host, path);
  assert.equal(small.content.querySelectorAll("input").some((input) => input.getAttribute("aria-label") === "Find a heading or note"), false, "small lists retain the simple picker");
});

test("Index parent search caps large lists at 300 matches while retaining selected and unavailable destinations", async () => {
  const path = notes(1)[0].path;
  const locations = Array.from({ length: 500 }, (_, index) => ({ id: `Vault/Parent ${index}.md`, name: `Heading / Parent ${index}` }));
  for (const selectedPath of [locations[499].id, "Vault/Removed parent.md"]) {
    const missing = selectedPath === "Vault/Removed parent.md";
    const base: OrganizerBaseOption = {
      ...BASE,
      indexHeadings: [{ id: "many", name: "Many parents", subheadings: locations }],
      initialPrimary: { mode: "index", libraryId: null, headingId: "many", subheadingId: selectedPath },
    };
    const harness = hostHarness(notes(1), [base]);
    const surface = await openSingleNote(harness.host, path);
    const select = selectByLabel(surface.content, "Under heading or note");
    const options = select.querySelectorAll("option");
    assert.equal(options.length, 302, "only 300 matches plus root and the selected/unavailable destination are mounted");
    assert.equal(select.value, selectedPath);
    assert.match(surface.content.textContent, /500 matching locations.*Showing the first 300; narrow your search/u);
    const selected = options.find((option) => option.getAttribute("value") === selectedPath);
    assert.ok(selected);
    if (missing) {
      assert.equal(selected.getAttribute("disabled"), "");
      assert.equal(selected.textContent, "Unavailable — choose another destination");
    }
    const search = surface.content.querySelectorAll("input").find((input) => input.getAttribute("aria-label") === "Find a heading or note");
    assert.ok(search);
    search.value = "Parent 499";
    search.dispatch("input");
    assert.equal(select.value, selectedPath);
    assert.equal(select.querySelectorAll("option").length, missing ? 3 : 2);
    if (missing) {
      assert.equal(select.querySelectorAll("option").find((option) => option.getAttribute("value") === selectedPath)?.getAttribute("disabled"), "");
      button(surface.content, "Review placement").click();
      await settle();
      assert.deepEqual(harness.drafts, []);
      assert.match(surface.content.textContent, /subheading is unavailable/u);
    }
  }
});

test("a 250k-node search indexes once and queries in one bounded pass", () => {
  const children = notes(250_000, "Vault/Large");
  const root: OrganizerVaultNode = { kind: "folder", name: "Large", path: "Vault/Large", children };
  let indexVisits = 0;
  const indexStarted = performance.now();
  const index = buildNoteOrganizerSearchIndex([root], () => { indexVisits += 1; });
  const indexElapsed = performance.now() - indexStarted;
  assert.equal(indexVisits, 250_001, "each renderable node is normalized exactly once at snapshot load");
  assert.equal(index.indexedNodeCount, 250_001);
  assert.equal(index.searchableNoteCount, 250_000);

  let queryVisits = 0;
  const queryStarted = performance.now();
  const page = queryNoteOrganizerSearchIndex(index, "topic", 0, 300, () => { queryVisits += 1; });
  const queryElapsed = performance.now() - queryStarted;
  assert.equal(queryVisits, 250_000, "one debounced query inspects every indexed note once, without a second tree scan");
  assert.equal(page.scannedNotes, 250_000);
  assert.equal(page.rows.length, 300);
  assert.equal(page.total, 250_001);
  assert.ok(indexElapsed < 5_000, `250k-node index took ${indexElapsed.toFixed(1)}ms`);
  assert.ok(queryElapsed < 5_000, `250k-note query took ${queryElapsed.toFixed(1)}ms`);
});

test("search input debounces to the last value and close cancels pending work", async () => {
  let timers: ControlledTimers | null = null;
  const surface = await openModal(
    hostHarness([{ kind: "folder", name: "ENT", path: "ENT", children: notes(500) }]).host,
    [],
    undefined,
    (window) => { timers = controlTimers(window); },
  );
  const search = surface.content.querySelector(".ent-cc-note-organizer-search") as FakeElement;
  search.value = "t";
  search.dispatch("input");
  search.value = "to";
  search.dispatch("input");
  search.value = "topic";
  search.dispatch("input");
  assert.equal(timers?.pending(), 1, "new keystrokes cancel the preceding debounce");
  assert.equal(surface.content.querySelectorAll("[role=\"treeitem\"]").length, 1, "typing does not synchronously scan or repaint the tree");
  timers?.runAll();
  assert.equal(surface.content.querySelectorAll("[role=\"treeitem\"]").length, 300);

  const refreshedSearch = surface.content.querySelector(".ent-cc-note-organizer-search") as FakeElement;
  refreshedSearch.value = "different";
  refreshedSearch.dispatch("input");
  assert.equal(timers?.pending(), 1);
  surface.modal.dismissImmediately();
  assert.ok((timers?.cleared() ?? 0) >= 3, "superseded and close-time timers are cancelled");
  timers?.runAll();
  assert.equal(surface.content.children.length, 0, "a cancelled search cannot repaint after close");
});

test("a 50k-note vault keeps initial and expanded tree DOM bounded", async () => {
  const children = notes(50_000);
  const root: OrganizerVaultNode = { kind: "folder", name: "ENT", path: "Knowledge Base/ENT", children };
  const harness = hostHarness([root]);
  const surface = await openModal(harness.host);

  assert.equal(surface.content.querySelectorAll("[role=\"treeitem\"]").length, 1, "collapsed branches are lazy");
  assert.equal(surface.content.querySelectorAll(".ent-cc-note-organizer-selected-item").length, 0);

  const search = surface.content.querySelector(".ent-cc-note-organizer-search") as FakeElement;
  search.focus();
  search.value = "Topic";
  search.dispatch("input");
  assert.equal(
    surface.content.querySelectorAll("[role=\"treeitem\"]").length,
    NoteOrganizerModal.TREE_PAGE_SIZE,
    "an all-vault search materializes only one result page",
  );
  assert.ok(search.ownerDocument.activeElement?.hasClass("ent-cc-note-organizer-search"), "search focus survives bounded repaint");
  search.value = "";
  search.dispatch("input");

  surface.content.querySelector(".ent-cc-note-organizer-tree-toggle")?.click();
  assert.equal(
    surface.content.querySelectorAll("[role=\"treeitem\"]").length,
    NoteOrganizerModal.TREE_PAGE_SIZE,
    "an expanded branch paints at most one bounded page",
  );
  assert.match(surface.content.querySelector(".ent-cc-note-organizer-page-status")?.textContent ?? "", /50,001.*omitted/iu);

  const folderCheckbox = surface.content.querySelector(".ent-cc-note-organizer-tree-checkbox") as unknown as
    FakeElement & { checked: boolean };
  folderCheckbox.checked = true;
  folderCheckbox.dispatch("change");
  assert.equal(surface.content.querySelectorAll(".ent-cc-note-organizer-selected-item").length, 0);
  assert.match(surface.content.textContent, new RegExp(`at most ${MAX_NOTE_ORGANIZER_NOTES.toLocaleString()}`, "u"));
  assert.match(surface.content.textContent, /never links a folder/iu);
});

test("folder selection is a descendant snapshot and tree selection exposes mixed state and keyboard order", async () => {
  const markdown = notes(2, "ENT/Pediatric");
  const nonMarkdown: OrganizerVaultNode = { kind: "note", name: "image.png", path: "ENT/Pediatric/image.png" };
  const folder: OrganizerVaultNode = {
    kind: "folder",
    name: "Pediatric",
    path: "ENT/Pediatric",
    children: [...markdown, nonMarkdown],
  };
  assert.deepEqual(collectOrganizerDescendantPaths(folder), markdown.map((note) => note.path));

  const surface = await openModal(hostHarness([folder]).host);
  surface.content.querySelector(".ent-cc-note-organizer-tree-toggle")?.click();
  const treeItems = surface.content.querySelectorAll("[role=\"treeitem\"]");
  assert.equal(treeItems.length, 3, "non-Markdown files never join the source tree");
  treeItems[0]?.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(treeItems[1]?.ownerDocument.activeElement, treeItems[1]);

  treeItems[1]?.dispatch("keydown", { key: " " });
  const rerenderedTreeItems = surface.content.querySelectorAll("[role=\"treeitem\"]");
  assert.equal(rerenderedTreeItems[1]?.ownerDocument.activeElement, rerenderedTreeItems[1]);
  assert.deepEqual(
    rerenderedTreeItems.map((item) => item.getAttribute("tabindex")),
    ["-1", "0", "-1"],
    "a rerender retains the roving tab stop on the restored tree row",
  );

  const checkboxes = surface.content.querySelectorAll(".ent-cc-note-organizer-tree-checkbox") as Array<FakeElement & { checked: boolean }>;
  const firstNote = checkboxes[1];
  assert.ok(firstNote);
  firstNote.checked = true;
  firstNote.dispatch("change");
  assert.equal(surface.content.querySelector("[role=\"treeitem\"]")?.getAttribute("aria-checked"), "mixed");
  assert.equal(
    (surface.content.querySelector(".ent-cc-note-organizer-tree-checkbox") as unknown as { indeterminate: boolean }).indeterminate,
    true,
  );
});

test("dialog semantics and the live region persist across modal rerenders", async () => {
  const folder: OrganizerVaultNode = {
    kind: "folder",
    name: "Pediatric",
    path: "ENT/Pediatric",
    children: notes(2, "ENT/Pediatric"),
  };
  const surface = await openModal(hostHarness([folder]).host);
  const titleId = surface.modalRoot.querySelector("h2")?.getAttribute("id");
  assert.ok(titleId);
  assert.equal(surface.modalRoot.getAttribute("role"), "dialog");
  assert.equal(surface.modalRoot.getAttribute("aria-modal"), "true");
  assert.equal(surface.modalRoot.getAttribute("aria-labelledby"), titleId);
  const describedBy = surface.modalRoot.getAttribute("aria-describedby");
  assert.ok(describedBy);
  assert.equal(surface.content.querySelector(`[id="${describedBy}"]`)?.getAttribute("role"), "note");
  assert.equal(surface.content.querySelector("[role=\"tabpanel\"]"), null);
  assert.equal(surface.content.querySelector("[role=\"region\"]")?.getAttribute("aria-labelledby")?.endsWith("-step-notes"), true);

  const live = surface.content.querySelector(".ent-cc-note-organizer-live");
  const renderRoot = surface.content.querySelector(".ent-cc-note-organizer-render-root");
  assert.ok(live);
  assert.ok(renderRoot);
  assert.equal(live.parentElement, surface.content, "the live region stays outside the aria-busy render subtree");
  assert.equal(renderRoot.getAttribute("aria-busy"), "false");

  surface.content.querySelector(".ent-cc-note-organizer-tree-toggle")?.click();
  assert.equal(surface.content.querySelector(".ent-cc-note-organizer-live"), live, "expansion retains the same live node");
  const folderCheckbox = surface.content.querySelector(".ent-cc-note-organizer-tree-checkbox") as FakeElement & { checked: boolean };
  folderCheckbox.checked = true;
  folderCheckbox.dispatch("change");
  assert.equal(surface.content.querySelector(".ent-cc-note-organizer-live"), live, "selection retains the same live node");
  assert.equal(live.textContent, "2 Markdown notes selected.");
});

test("disclosure, checkbox, and treeitem keyboard ownership stay separate", async () => {
  const folder: OrganizerVaultNode = {
    kind: "folder",
    name: "Pediatric",
    path: "ENT/Pediatric",
    children: notes(2, "ENT/Pediatric"),
  };
  const surface = await openModal(hostHarness([folder]).host);
  const initialTreeItem = surface.content.querySelector("[role=\"treeitem\"]") as FakeElement;
  const disclosure = surface.content.querySelector(".ent-cc-note-organizer-tree-toggle") as FakeElement;
  const checkbox = surface.content.querySelector(".ent-cc-note-organizer-tree-checkbox") as FakeElement & { checked: boolean };
  assert.equal(noteOrganizerTreeItemOwnsEvent(initialTreeItem as unknown as EventTarget, disclosure as unknown as EventTarget), false);
  assert.equal(noteOrganizerTreeItemOwnsEvent(initialTreeItem as unknown as EventTarget, checkbox as unknown as EventTarget), false);
  assert.equal(noteOrganizerTreeItemOwnsEvent(initialTreeItem as unknown as EventTarget, initialTreeItem as unknown as EventTarget), true);

  const disclosureKey = disclosure.dispatch("keydown", { key: "Enter" });
  assert.equal(disclosureKey.defaultPrevented, false, "a bubbled disclosure key remains owned by the button");
  const checkboxKey = checkbox.dispatch("keydown", { key: " " });
  assert.equal(checkboxKey.defaultPrevented, false, "a bubbled checkbox key remains owned by the native checkbox");
  assert.match(surface.content.textContent, /Selected notes \(0\)/u, "nested key events do not toggle the treeitem");

  disclosure.click();
  assert.match(surface.content.textContent, /Selected notes \(0\)/u, "disclosure expands without selecting descendants");
  const expandedCheckbox = surface.content.querySelector(".ent-cc-note-organizer-tree-checkbox") as FakeElement & { checked: boolean };
  expandedCheckbox.checked = true;
  expandedCheckbox.dispatch("change");
  assert.match(surface.content.textContent, /Selected notes \(2\)/u, "checkbox performs only its explicit selection action");
  const refreshedTreeItem = surface.content.querySelector("[role=\"treeitem\"]") as FakeElement;
  refreshedTreeItem.dispatch("keydown", { key: " " });
  assert.match(surface.content.textContent, /Selected notes \(0\)/u, "Space on the treeitem toggles its descendants once");
});

test("ArrowDown, ArrowUp, Home, and End cross 300-row tree pages", async () => {
  const folder: OrganizerVaultNode = {
    kind: "folder",
    name: "Pediatric",
    path: "ENT/Pediatric",
    children: notes(301, "ENT/Pediatric"),
  };
  const surface = await openModal(hostHarness([folder]).host);
  surface.content.querySelector(".ent-cc-note-organizer-tree-toggle")?.click();
  let rows = surface.content.querySelectorAll("[role=\"treeitem\"]");
  assert.equal(rows.length, 300);
  assert.equal(rows[0]?.getAttribute("aria-posinset"), "1");
  assert.equal(rows[0]?.getAttribute("aria-setsize"), "302");

  const lastOnFirstPage = rows.at(-1);
  assert.ok(lastOnFirstPage);
  lastOnFirstPage.focus();
  const down = lastOnFirstPage.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
  assert.equal(
    surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    "ENT/Pediatric/Topic 00299.md",
    "ArrowDown reaches the first row on page two",
  );
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("aria-posinset"), "301");

  const firstOnSecondPage = surface.content.ownerDocument.activeElement;
  assert.ok(firstOnSecondPage);
  firstOnSecondPage.dispatch("keydown", { key: "ArrowUp" });
  assert.equal(
    surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    "ENT/Pediatric/Topic 00298.md",
    "ArrowUp returns to the last row on page one",
  );

  surface.content.ownerDocument.activeElement?.dispatch("keydown", { key: "End" });
  assert.equal(
    surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    "ENT/Pediatric/Topic 00300.md",
    "End reaches the final row across pages",
  );
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("aria-posinset"), "302");

  surface.content.ownerDocument.activeElement?.dispatch("keydown", { key: "Home" });
  assert.equal(
    surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    folder.path,
    "Home returns to the first row across pages",
  );
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("aria-posinset"), "1");
});

test("ArrowLeft restores an off-page parent in normal and searched trees", async () => {
  const folder: OrganizerVaultNode = {
    kind: "folder",
    name: "Pediatric",
    path: "ENT/Pediatric",
    children: notes(301, "ENT/Pediatric"),
  };
  const ordinary = await openModal(hostHarness([folder]).host);
  ordinary.content.querySelector(".ent-cc-note-organizer-tree-toggle")?.click();
  button(ordinary.content, "Next").click();
  const ordinaryChild = ordinary.content.querySelector("[role=\"treeitem\"]") as FakeElement;
  assert.equal(ordinaryChild.getAttribute("aria-level"), "2");
  ordinaryChild.focus();
  ordinaryChild.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(
    ordinary.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    folder.path,
    "normal tree navigation returns to the parent page",
  );

  let timers: ControlledTimers | null = null;
  const searched = await openModal(
    hostHarness([folder]).host,
    [],
    undefined,
    (window) => { timers = controlTimers(window); },
  );
  const search = searched.content.querySelector(".ent-cc-note-organizer-search") as FakeElement;
  search.value = "topic";
  search.dispatch("input");
  timers?.runAll();
  button(searched.content, "Next").click();
  const searchedChild = searched.content.querySelector("[role=\"treeitem\"]") as FakeElement;
  assert.equal(searchedChild.getAttribute("aria-level"), "2");
  searchedChild.focus();
  searchedChild.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(
    searched.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    folder.path,
    "search-result tree navigation returns to the emitted parent page",
  );
});

test("ArrowRight reaches a child that begins the next normal or search page", async () => {
  const nested: OrganizerVaultNode = {
    kind: "folder",
    name: "Nested",
    path: "Vault/Nested",
    children: [{ kind: "note", name: "Topic child", path: "Vault/Nested/Topic child.md" }],
  };
  const root: OrganizerVaultNode = {
    kind: "folder",
    name: "Vault",
    path: "Vault",
    children: [...notes(298, "Vault"), nested],
  };
  const ordinary = await openModal(hostHarness([root]).host);
  ordinary.content.querySelector(".ent-cc-note-organizer-tree-toggle")?.click();
  const nestedToggle = ordinary.content.querySelectorAll(".ent-cc-note-organizer-tree-toggle").find((candidate) => (
    candidate.getAttribute("aria-label")?.includes("Nested")
  ));
  assert.ok(nestedToggle);
  nestedToggle.click();
  const nestedRow = ordinary.content.querySelector(`[data-organizer-node-path="${nested.path}"]`) as FakeElement;
  nestedRow.focus();
  nestedRow.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(
    ordinary.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    "Vault/Nested/Topic child.md",
    "normal tree navigation crosses the page boundary to the first child",
  );

  let timers: ControlledTimers | null = null;
  const searched = await openModal(
    hostHarness([root]).host,
    [],
    undefined,
    (window) => { timers = controlTimers(window); },
  );
  const search = searched.content.querySelector(".ent-cc-note-organizer-search") as FakeElement;
  search.value = "topic";
  search.dispatch("input");
  timers?.runAll();
  const searchedNested = searched.content.querySelector(`[data-organizer-node-path="${nested.path}"]`) as FakeElement;
  searchedNested.focus();
  searchedNested.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(
    searched.content.ownerDocument.activeElement?.getAttribute("data-organizer-node-path"),
    "Vault/Nested/Topic child.md",
    "search-result tree navigation crosses the page boundary to the first child",
  );
});

test("custom bulk destinations hydrate their Index parents and retain them on refresh", async () => {
  const selected = notes(2);
  const harness = hostHarness(selected, [BASE, SECOND_BASE]);
  const requests: string[][] = [];
  harness.host.getBases = (ids) => {
    requests.push([...(ids ?? [])]);
    return [BASE, SECOND_BASE];
  };
  const surface = await openModal(harness.host, selected.map((note) => note.path));
  button(surface.content, "Choose destinations").click();
  const behavior = selectByLabel(surface.content, "Behavior for Topic 00000");
  behavior.value = "custom";
  behavior.dispatch("change");
  button(surface.content, "Add custom knowledge base").click();
  await settle();
  assert.deepEqual(new Set(requests.at(-1)), new Set([BASE.id, SECOND_BASE.id]));
  assert.match(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus") ?? "", /custom-.*-base$/u);
  await surface.modal.refreshAfterExternalChange();
  assert.deepEqual(new Set(requests.at(-1)), new Set([BASE.id, SECOND_BASE.id]), "a custom-only base keeps its parent options after Sync refresh");
});

test("draft validation preserves exact primary and collection heading targets", () => {
  const selected = new Set(["Knowledge Base/ENT/Laryngomalacia.md"]);
  const destination = {
    key: 7,
    baseId: BASE.id,
    primary: { mode: "library" as const, libraryId: "sources", headingId: "books", subheadingId: "textbooks" },
    collections: {
      mode: "add" as const,
      targets: [{ headingId: "board-review", subheadingId: "congenital" }],
    },
  };
  const draft = snapshotNoteOrganizerDraft("command", selected, [destination], new Map());
  assert.deepEqual(validateNoteOrganizerDraft(draft, [BASE]), []);
  assert.deepEqual(draft.destinations[0]?.primary, {
    mode: "library",
    libraryId: "sources",
    headingId: "books",
    subheadingId: "textbooks",
  });
  assert.deepEqual(draft.destinations[0]?.collections.targets, [{
    headingId: "board-review",
    subheadingId: "congenital",
  }]);
  const unplacedLibrary = {
    ...draft,
    destinations: [{
      ...draft.destinations[0],
      primary: { mode: "library" as const, libraryId: "sources", headingId: null, subheadingId: null },
    }],
  };
  assert.deepEqual(validateNoteOrganizerDraft(unplacedLibrary, [BASE]), [], "a Library may explicitly remain unplaced");

  const duplicate = { ...draft, destinations: [...draft.destinations, draft.destinations[0]] };
  assert.match(validateNoteOrganizerDraft(duplicate, [BASE]).join(" "), /each knowledge base can appear only once/iu);
  const incomplete = {
    ...draft,
    destinations: [{ ...draft.destinations[0], collections: { mode: "add" as const, targets: [] } }],
  };
  assert.match(validateNoteOrganizerDraft(incomplete, [BASE]).join(" "), /needs at least one exact target/iu);
});

test("per-note custom and skip overrides reach the authoritative preparation", async () => {
  const vaultNotes = notes(2);
  const paths = vaultNotes.map((note) => note.path);
  const harness = hostHarness(vaultNotes);
  const surface = await openModal(harness.host, paths);
  button(surface.content, "Choose destinations").click();

  const firstBehavior = selectByLabel(surface.content, "Behavior for Topic 00000");
  firstBehavior.value = "custom";
  firstBehavior.dispatch("change");
  const customLabel = surface.content.querySelector(".ent-cc-note-organizer-custom-label");
  assert.match(customLabel?.textContent ?? "", /Custom destinations for Topic 00000/u);
  assert.equal(customLabel?.getAttribute("dir"), "auto", "user-derived note names keep automatic text direction");
  assert.equal(firstBehavior.getAttribute("dir"), "auto", "user-derived select labels keep automatic text direction");

  const secondBehavior = selectByLabel(surface.content, "Behavior for Topic 00001");
  secondBehavior.value = "skip";
  secondBehavior.dispatch("change");
  button(surface.content, "Prepare review").click();
  await settle();

  assert.equal(harness.drafts.length, 1);
  assert.deepEqual(harness.drafts[0]?.overrides.map((override) => [override.path, override.mode]), [
    [paths[0], "custom"],
    [paths[1], "skip"],
  ]);
  assert.equal(harness.drafts[0]?.overrides[0]?.destinations.length, 1);
  assert.equal(harness.drafts[0]?.overrides[1]?.destinations.length, 0);
});

test("external changes preserve the selected-note draft and expire only its prepared review", async () => {
  const vaultNotes = notes(2);
  const harness = hostHarness(vaultNotes);
  const surface = await openModal(harness.host, vaultNotes.map((note) => note.path));
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();
  const originalDraft = structuredClone(harness.drafts[0]);
  await surface.modal.refreshAfterExternalChange();
  assert.equal(surface.closed(), 0);
  assert.match(surface.content.textContent, /Your selected notes and destination choices are kept/u);
  assert.equal(button(surface.content, "Apply organization").disabled, true);
  button(surface.content, "Refresh review").click();
  await settle();
  assert.deepEqual(harness.drafts[1], originalDraft);
  assert.equal(button(surface.content, "Apply organization").disabled, false);
});

test("removed Collection destinations remain unavailable instead of being silently replaced", async () => {
  const vaultNotes = notes(1);
  let bases = [structuredClone(BASE)];
  const harness = hostHarness(vaultNotes);
  harness.host.getBases = () => bases;
  const surface = await openModal(harness.host, [vaultNotes[0].path]);
  button(surface.content, "Choose destinations").click();
  const state = surface.modal as unknown as { destinations: Array<{ collections: { mode: string; targets: Array<{ headingId: string; subheadingId: string | null }> } }> };
  state.destinations[0].collections = { mode: "add", targets: [{ headingId: "board-review", subheadingId: "congenital" }] };
  bases = [{ ...structuredClone(BASE), collections: [{ id: "different", name: "Different", subheadings: [] }] }];
  await surface.modal.refreshAfterExternalChange();
  assert.deepEqual(state.destinations[0].collections.targets, [{ headingId: "board-review", subheadingId: "congenital" }]);
  assert.match(surface.content.textContent, /Unavailable — choose another destination/u);
  button(surface.content, "Prepare review").click();
  await settle();
  assert.equal(harness.drafts.length, 0, "invalid destinations never reach authoritative preparation");
  assert.match(surface.content.textContent, /choose an available Collection/u);
});

test("current-base text and full destination rerenders restore deterministic focus", async () => {
  const vaultNotes: OrganizerVaultNode[] = [
    { kind: "note", name: "Same", path: "A/Same.md" },
    { kind: "note", name: "Same", path: "B/Same.md" },
  ];
  const surface = await openModal(hostHarness(vaultNotes, [BASE, SECOND_BASE]).host, vaultNotes.map((note) => note.path));
  button(surface.content, "Choose destinations").click();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "stage-heading:destinations");
  assert.equal(surface.content.querySelector(".ent-cc-note-organizer-current-base")?.textContent, "Current");
  const baseSelect = selectByLabel(surface.content, "Knowledge base");
  assert.match(baseSelect.textContent, /ENT knowledge base — Current/u);

  button(surface.content, "Add knowledge base").click();
  await settle();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "field:shared-2-base");
  const destinationRemovers = surface.content.querySelectorAll("button").filter((candidate) => (
    candidate.getAttribute("aria-label") === "Remove this knowledge base destination"
  ));
  assert.equal(destinationRemovers.length, 2);
  destinationRemovers[1]?.click();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "add-base:shared");

  const duplicateModes = surface.content.querySelectorAll("select").filter((candidate) => candidate.getAttribute("aria-label") === "Behavior for Same");
  assert.equal(duplicateModes.length, 2);
  const firstMode = duplicateModes[0];
  assert.ok(firstMode);
  firstMode.focus();
  firstMode.value = "custom";
  firstMode.dispatch("change");
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "override-mode:A/Same.md");
  button(surface.content, "Close custom editor").click();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "custom-toggle:A/Same.md");

  button(surface.content, "Back to notes").click();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "stage-heading:notes");
});

test("prepare and review pagination move focus to a stable stage or page status", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  harness.setPrepared(prepared(301));
  const surface = await openModal(harness.host, [vaultNotes[0]?.path ?? ""]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "stage-heading:review");
  button(surface.content, "Next").click();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "pagination:review rows:status");
  assert.equal(button(surface.content, "Next").disabled, true, "focus is never assigned to a newly disabled page control");
  button(surface.content, "Back to destinations").click();
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "stage-heading:destinations");
});

test("Replace with zero Collection targets requires an explicit retained acknowledgement", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  const surface = await openModal(harness.host, [vaultNotes[0]?.path ?? ""]);
  button(surface.content, "Choose destinations").click();
  const collectionMode = surface.content.querySelectorAll("select").find((candidate) => (
    candidate.getAttribute("data-organizer-focus") === "field:shared-1-collections-mode"
  ));
  assert.ok(collectionMode);
  collectionMode.value = "replace";
  collectionMode.dispatch("change");
  assert.match(surface.content.textContent, /removes every Collection membership/u);

  button(surface.content, "Prepare review").click();
  assert.equal(harness.drafts.length, 0);
  assert.match(surface.content.textContent, /confirm that Replace with no targets clears every Collection membership/iu);
  const confirmation = surface.content.querySelectorAll("input").find((candidate) => (
    candidate.getAttribute("aria-label") === "Confirm clearing all collection memberships"
  )) as FakeElement & { checked: boolean } | undefined;
  assert.ok(confirmation);
  confirmation.checked = true;
  confirmation.dispatch("change");
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "clear-collections:shared:1");
  button(surface.content, "Prepare review").click();
  await settle();
  assert.equal(harness.drafts.length, 1);
  assert.equal(harness.drafts[0]?.destinations[0]?.collections.clearAllConfirmed, true);
  assert.deepEqual(harness.drafts[0]?.destinations[0]?.collections.targets, []);
});

test("review is bounded and Apply returns the exact opaque prepared token", async () => {
  const vaultNotes = notes(1);
  const path = vaultNotes[0]?.path ?? "";
  const token = { transaction: "must-remain-identical" };
  const harness = hostHarness(vaultNotes);
  harness.setPrepared(prepared(301, token));
  const surface = await openModal(harness.host, [path]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();

  assert.equal(surface.content.querySelectorAll(".ent-cc-note-organizer-review-row").length, NoteOrganizerModal.REVIEW_PAGE_SIZE);
  assert.match(surface.content.querySelector(".ent-cc-note-organizer-page-status")?.textContent ?? "", /301.*omitted/iu);
  assert.match(surface.content.textContent, /Before.*After/isu);
  assert.match(surface.content.textContent, /0 files moved.*0 files renamed.*0 Markdown files rewritten.*0 folder links changed/iu);

  button(surface.content, "Apply organization").click();
  await settle();
  assert.equal(harness.appliedTokens.length, 1);
  assert.equal(harness.appliedTokens[0], token, "the opaque host token is passed back by identity");
  assert.equal(surface.closed(), 1);
});

test("host-prepared blocking errors render actionable review feedback and cannot Apply", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  harness.setPrepared({
    ...prepared(),
    preparedToken: null,
    errors: ["The selected knowledge base was archived. Go back to destinations, choose an available base, and prepare the review again."],
  });
  const surface = await openModal(harness.host, [vaultNotes[0]?.path ?? ""]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();

  const alert = surface.content.querySelector("[role=\"alert\"]");
  assert.match(alert?.textContent ?? "", /archived.*Go back to destinations.*prepare the review again/iu);
  assert.match(surface.content.textContent, /Review exact organization changes/u);
  assert.ok(button(surface.content, "Back to destinations"), "the corrective navigation remains available");
  const apply = button(surface.content, "Apply organization");
  assert.equal(apply.disabled, true, "a host-prepared blocking error cannot become writable");
  apply.click();
  await settle();
  assert.deepEqual(harness.appliedTokens, []);
  assert.equal(surface.closed(), 0);
});

test("prepare exceptions stay on Destinations with an actionable error and no Apply surface", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  harness.host.prepare = async (draft) => {
    harness.drafts.push(draft);
    throw new Error("Synced knowledge-base data changed. Reopen the organizer after Sync finishes.");
  };
  const surface = await openModal(harness.host, [vaultNotes[0]?.path ?? ""]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();

  const alert = surface.content.querySelector("[role=\"alert\"]");
  assert.match(alert?.textContent ?? "", /Could not prepare the review.*Synced knowledge-base data changed.*Reopen the organizer/isu);
  assert.equal(surface.content.ownerDocument.activeElement, alert, "the actionable preparation error receives deterministic focus");
  assert.equal(surface.content.querySelectorAll("button").some((candidate) => candidate.textContent === "Apply organization"), false);
  assert.ok(button(surface.content, "Prepare review"), "the user can retry after resolving Sync");
  assert.deepEqual(harness.appliedTokens, []);
  assert.equal(surface.closed(), 0);
});

test("a stale Apply rejection stays on Review and invalidates the prepared token", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  harness.setApplyError(new Error("Knowledge-base state changed after review"));
  const surface = await openModal(harness.host, [vaultNotes[0]?.path ?? ""]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();
  button(surface.content, "Apply organization").click();
  await settle();

  assert.match(surface.content.textContent, /Nothing was applied.*state changed.*Refresh the review/isu);
  assert.ok(button(surface.content, "Refresh review"));
  assert.equal((button(surface.content, "Apply organization") as unknown as { disabled: boolean }).disabled, true);
  assert.equal(surface.closed(), 0);
});

test("an external change during preparation cannot enable the old review", async () => {
  const pending = deferred<OrganizerPreparedPlan>();
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  harness.host.prepare = () => pending.promise;
  const surface = await openModal(harness.host, [vaultNotes[0].path]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await surface.modal.refreshAfterExternalChange();
  pending.resolve(prepared());
  await settle();
  assert.equal(surface.closed(), 0);
  assert.match(surface.content.textContent, /data changed while preparing.*draft is kept/u);
  assert.equal(surface.content.querySelectorAll("button").some((item) => item.textContent === "Apply organization"), false);
});

test("forced dismissal during prepare suppresses every late render", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  const pending = deferred<OrganizerPreparedPlan>();
  harness.host.prepare = async (draft) => {
    harness.drafts.push(draft);
    return pending.promise;
  };
  let closedCallbacks = 0;
  const surface = await openModal(
    harness.host,
    [vaultNotes[0]?.path ?? ""],
    () => { closedCallbacks += 1; },
  );
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  surface.modal.dismissImmediately();
  assert.equal(surface.content.children.length, 0);
  pending.resolve(prepared());
  await settle();
  assert.equal(surface.content.children.length, 0);
  assert.equal(surface.closed(), 1);
  assert.equal(closedCallbacks, 1);
});

test("forced dismissal during Apply suppresses late success presentation and repaint", async () => {
  const vaultNotes = notes(1);
  const harness = hostHarness(vaultNotes);
  const pending = deferred<{ changedNotes: number; changedBases: number; changeCount: number }>();
  harness.host.applyPrepared = async (token) => {
    harness.appliedTokens.push(token);
    return pending.promise;
  };
  const surface = await openModal(harness.host, [vaultNotes[0]?.path ?? ""]);
  button(surface.content, "Choose destinations").click();
  button(surface.content, "Prepare review").click();
  await settle();
  button(surface.content, "Apply organization").click();
  surface.modal.dismissImmediately();
  pending.resolve({ changedNotes: 1, changedBases: 1, changeCount: 1 });
  await settle();
  assert.equal(surface.content.children.length, 0);
  assert.equal(surface.closed(), 1);
  assert.equal(harness.appliedTokens.length, 1);
});

test("closing a populated draft requires an explicit discard decision", async () => {
  const vaultNotes = notes(1);
  const surface = await openModal(hostHarness(vaultNotes).host, [vaultNotes[0]?.path ?? ""]);
  NoteOrganizerModal.prototype.close.call(surface.modal);
  assert.equal(surface.closed(), 0);
  assert.match(surface.content.textContent, /Discard this organizer draft with 1 selected note/iu);
  assert.equal(surface.content.ownerDocument.activeElement?.getAttribute("data-organizer-focus"), "discard-cancel");

  button(surface.content, "Keep organizing").click();
  assert.equal(surface.closed(), 0);
  assert.equal(surface.content.querySelector(".ent-cc-note-organizer-discard-confirmation"), null);

  NoteOrganizerModal.prototype.close.call(surface.modal);
  button(surface.content, "Discard and close").click();
  assert.equal(surface.closed(), 1);
});

test("onClosed releases a modal claim exactly once for cancel and repeated close signals", async () => {
  let closedCallbacks = 0;
  const surface = await openModal(hostHarness(notes(1)).host, [], () => { closedCallbacks += 1; });
  button(surface.content, "Cancel").click();
  assert.equal(closedCallbacks, 1);
  surface.modal.onClose();
  assert.equal(closedCallbacks, 1);
});

test("read-only mode explains why review and Apply are unavailable", async () => {
  const harness = hostHarness(notes(1));
  harness.host.isReadOnly = () => true;
  const path = "Knowledge Base/ENT/Topic 00000.md";
  const surface = await openModal(harness.host, [path]);
  assert.match(surface.content.textContent, /read-only.*review and Apply stay unavailable/isu);
  button(surface.content, "Choose destinations").click();
  assert.equal((button(surface.content, "Prepare review") as unknown as { disabled: boolean }).disabled, true);
  assert.equal(harness.drafts.length, 0);
});

test("organizer CSS remains isolated, touch-sized, responsive, and RTL-aware", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const marker = css.indexOf("/* Global note organizer");
  const endMarker = css.indexOf("/* End global note organizer", marker);
  assert.ok(marker >= 0);
  assert.ok(endMarker > marker);
  const organizerCss = css.slice(marker, endMarker);
  assert.match(organizerCss, /\.ent-cc-note-organizer-primary-button[\s\S]*?min-height:\s*44px/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-checkbox-target[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-current-base/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-clear-confirmation[\s\S]*?min-height:\s*44px/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-render-root[\s\S]*?flex-direction:\s*column/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-selected-item[\s\S]*?padding-block:\s*5px;[\s\S]*?padding-inline:\s*10px 4px;/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-discard-confirmation/u);
  assert.match(organizerCss, /@media \(max-width: 760px\), \(pointer: coarse\)/u);
  assert.match(organizerCss, /\.ent-cc-note-organizer-arrow:dir\(rtl\)/u);
  assert.doesNotMatch(organizerCss, /^\.(?!ent-cc-note-organizer-)[a-z]/gmu, "new top-level selectors stay organizer-prefixed");
});
