import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IndexManagerModal } from "../src/index-manager.ts";
import { ConfirmModal } from "../src/modals.ts";
import type { VaultRecord } from "../src/model.ts";
import { Notice } from "./support/obsidian-stub.ts";
import { EntVaultCommandCenterView, resetAllVisualArrangementMessage } from "../src/view.ts";

// WF-12 (T6). Synthetic titles only. The dialogs must tell the truth about
// placement, sibling order and Undo; the model behaviour itself is unchanged
// (see "reset restores canonical parent and sibling ordering" in model.test.ts).

interface CapturedConfirm { title: string; message: string; confirmLabel: string }

function captureConfirms(run: () => void): CapturedConfirm[] {
  const captured: CapturedConfirm[] = [];
  const original = Object.getOwnPropertyDescriptor(ConfirmModal.prototype, "open");
  ConfirmModal.prototype.open = function captureOpen(this: ConfirmModal): void {
    const fields = this as unknown as { titleText: string; message: string; confirmLabel: string };
    captured.push({ title: fields.titleText, message: fields.message, confirmLabel: fields.confirmLabel });
  };
  try {
    run();
  } finally {
    if (original) Object.defineProperty(ConfirmModal.prototype, "open", original);
    else Reflect.deleteProperty(ConfirmModal.prototype, "open");
  }
  return captured;
}

function assertHonestPlacementCopy(text: string, label: string): void {
  assert.match(text, /visual placement/i, `${label}: names visual placement`);
  assert.match(text, /manual (sibling )?order|sibling order/i, `${label}: names manual/sibling order`);
  assert.match(text, /default order/i, `${label}: says remaining siblings can return to default order`);
  assert.match(text, /adding [^.]*back[^.]*does not (restore|bring back|recover)/i, `${label}: re-adding does not recover placement or order`);
  assert.match(text, /Undo restores the earlier organization while it is (still )?available/i, `${label}: Undo scope`);
  assert.doesNotMatch(text, /Undo (rewrites|restores) (your )?(Markdown|notes)/i, `${label}: no Markdown undo promise`);
}

test("WF-12 T6 removing one note explains placement, sibling order and Undo", () => {
  const view = Object.create(EntVaultCommandCenterView.prototype) as Record<string, unknown>;
  view.app = {};
  view.createOpenedBaseGuard = () => () => true;
  view.plugin = {
    isClinicalMode: () => false,
    data: { settings: { indexLabel: "Index", workspaceName: "Sample base" } },
  };
  const record = { title: "Sample note", path: "Sample/Sample note.md", kind: "topic", role: "canonical", portableIndexed: true } as unknown as VaultRecord;
  const confirms = captureConfirms(() => (view as unknown as { removeFromIndex(record: VaultRecord): void }).removeFromIndex(record));
  assert.equal(confirms.length, 1);
  assertHonestPlacementCopy(confirms[0].message, "removeFromIndex");
  assert.match(confirms[0].message, /Markdown file[^.]*will not change/i, "file safety statement kept");
});

test("WF-12 T6 removing selected notes from the index explains placement, sibling order and Undo", () => {
  const manager = Object.create(IndexManagerModal.prototype) as Record<string, unknown>;
  manager.app = {};
  manager.selected = new Set(["Sample/A.md", "Sample/B.md"]);
  const confirms = captureConfirms(() => (manager as unknown as { removeSelectedFromIndex(): void }).removeSelectedFromIndex());
  assert.equal(confirms.length, 1);
  assert.match(confirms[0].message, /^2 memberships will be removed\./);
  assertHonestPlacementCopy(confirms[0].message, "removeSelectedFromIndex");
});

test("WF-12 T6 removing a group explains placement, sibling order and Undo, with and without members", () => {
  const manager = Object.create(IndexManagerModal.prototype) as Record<string, unknown>;
  manager.app = {};
  manager.plugin = { data: { settings: { itemSingular: "subject", itemPlural: "subjects" } } };
  const members = [{ path: "Sample/A.md" }, { path: "Sample/B.md" }] as unknown as VaultRecord[];
  const remove = (group: string, rows: VaultRecord[]): CapturedConfirm[] =>
    captureConfirms(() => (manager as unknown as { removeGroup(group: string, rows: VaultRecord[]): void }).removeGroup(group, rows));
  const withMembers = remove("Sample group", members);
  assert.equal(withMembers.length, 1);
  assertHonestPlacementCopy(withMembers[0].message, "removeGroup with members");
  const empty = remove("Empty group", []);
  assert.equal(empty.length, 1);
  assertHonestPlacementCopy(empty[0].message, "removeGroup empty");
});

test("WF-12 T6 resetting all visual arrangement keeps its meaning and adds the order and Undo truth", () => {
  for (const clinical of [true, false]) {
    const message = resetAllVisualArrangementMessage(clinical);
    assert.match(message, clinical ? /canonical note metadata/ : /configured parent metadata and folder grouping/);
    assert.match(message, /Source notes will not be changed/);
    assert.match(message, /default order/i);
    assert.match(message, /Undo restores the earlier organization while it is (still )?available/i);
  }
});

test("WF-12 T6 resetting one note's placement says siblings can return to default order and how to recover", async () => {
  Notice.messages.length = 0;
  const view = Object.create(EntVaultCommandCenterView.prototype) as Record<string, unknown>;
  view.run = (action: () => Promise<unknown>) => action();
  view.plugin = {
    isClinicalMode: () => false,
    canVisuallyMoveAcrossGroups: () => false,
    data: { curriculumVisual: { parentByPath: {}, orderByContainer: {} }, indexGroupByPath: {} },
    mutate: async (_label: string, change: () => void) => { change(); },
  };
  const record = { title: "Sample note", path: "Sample/Sample note.md" } as unknown as VaultRecord;
  await (view as unknown as { resetCurriculumRecord(record: VaultRecord): Promise<void> | void }).resetCurriculumRecord(record);
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  const notice = Notice.messages.join(" ");
  assert.match(notice, /Source notes were not changed/);
  assert.match(notice, /default order|sibling order/i);
  assert.match(notice, /Undo/);
});

test("WF-12 T6 the model reset behaviour is exercised by the unchanged model test", () => {
  // The behaviour guard lives in tests/model.test.ts and is run alongside this file.
  const model = readFileSync(new URL("./model.test.ts", import.meta.url), "utf8");
  assert.ok(model.includes('reset restores canonical parent and sibling ordering'));
});
